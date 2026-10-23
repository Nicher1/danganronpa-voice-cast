-- One automatically updated Discord message; no credentials in public tables.
-- Run as postgres after shared-scheduling-migration.sql.
begin;
create schema if not exists extensions;
create extension if not exists http with schema extensions;
create schema if not exists cast_discord;
revoke all on schema cast_discord from public, anon, authenticated;

create table if not exists cast_discord.connections (
  slug text primary key references public.cast_schedules(slug) on delete cascade,
  secret_id uuid not null,
  site_url text not null default 'https://nicher1.github.io/danganronpa-voice-cast/',
  message_id text,
  enabled boolean not null default false,
  last_payload jsonb,
  last_success_at timestamptz,
  last_status text,
  retry_after timestamptz
);
revoke all on cast_discord.connections from public, anon, authenticated;

create or replace function cast_discord.safe_name(value text)
returns text language sql immutable set search_path=pg_catalog as $$
  select left(replace(regexp_replace(coalesce(value,'Voice actor'),'[\\*_~`<>|\[\]\r\n]','','g'),'@','＠'),60)
$$;

create or replace function cast_discord.payload(p_slug text,p_site_url text,p_now timestamptz default now())
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare
  s jsonb; actors jsonb; session jsonb; start_at timestamptz; base_at timestamptz;
  dates date[]; d date; week_start date; today date:=(p_now at time zone 'Europe/Copenhagen')::date;
  fields jsonb:='[]'; details text; attendees integer; late integer; vote_link text;
  title text; description text; row record; offset_min integer; line text; option_no integer:=0;
begin
  select state into s from public.cast_schedules where slug=p_slug;
  select state->'actors' into actors from public.cast_public_boards where slug=p_slug and initialized;
  if s is null or actors is null then return null; end if;
  select x into session from jsonb_array_elements(s->'sessions') x
    where nullif(x->>'endedAt','') is null
      and (x->>'startAt')::timestamptz+interval '10 hours'>p_now
    order by (x->>'startAt')::timestamptz limit 1;
  if session is not null then
    start_at:=(session->>'startAt')::timestamptz;
    dates:=array[(start_at at time zone 'Europe/Copenhagen')::date];
    title:=case when start_at<=p_now then 'Danganronpa is underway' else 'Next Danganronpa session' end;
    description:=format('<t:%s:F> · <t:%s:R>',extract(epoch from start_at)::bigint,extract(epoch from start_at)::bigint);
  else
    select max((x->>'startAt')::timestamptz) into start_at from jsonb_array_elements(s->'sessions') x
      where (x->>'startAt')::timestamptz<=p_now;
    week_start:=date_trunc('week',coalesce(start_at at time zone 'Europe/Copenhagen',today::timestamp))::date+7;
    -- If the last session was weeks ago, keep the poll in a future week.
    week_start:=greatest(week_start,date_trunc('week',today::timestamp)::date);
    select array_agg(day order by day) into dates from (
      select week_start+i as day from generate_series(0,6) i
    ) days where day>=today and extract(isodow from day)<>2;
    title:='Choose our next Danganronpa day';
    description:='Vote using your existing voice actor. All times below use your local timezone.';
  end if;
  foreach d in array dates loop
    option_no:=option_no+1;
    base_at:=public.cast_schedule_instant(d::text,coalesce(s->'times'->>d::text,'19:00'));
    if session is null then start_at:=base_at; end if;
    attendees:=0;late:=0;details:='';
    for row in
      select a->>'name' as name,coalesce((v.value->>'offset')::integer,0) as offset_minutes
      from jsonb_each(coalesce(s->'votes'->d::text,'{}')) v
      join jsonb_array_elements(actors) a on a->>'id'=v.key
      where v.value->>'available'='true'
      order by a->>'name'
    loop
      attendees:=attendees+1;
      offset_min:=round(extract(epoch from (base_at+row.offset_minutes*interval '1 minute'-start_at))/60)::integer;
      if offset_min>0 then late:=late+1; end if;
      line:=cast_discord.safe_name(row.name)||' — '||case
        when offset_min=0 then 'on time'
        when offset_min>0 then offset_min||' min late'
        else abs(offset_min)||' min early' end;
      if offset_min<>0 then line:=line||format(' (<t:%s:t>)',extract(epoch from (base_at+row.offset_minutes*interval '1 minute'))::bigint); end if;
      if length(details)+length(line)<720 then details:=details||line||E'\n'; end if;
    end loop;
    if attendees=0 then details:='No availability confirmed yet.';
    elsif attendees>array_length(string_to_array(rtrim(details,E'\n'),E'\n'),1) then details:=details||'More names on the voting page.'; end if;
    vote_link:=p_site_url||'?mode=player&scheduleDate='||d::text||'#schedule';
    fields:=fields||jsonb_build_array(jsonb_build_object(
      'name',case when session is null then 'Option '||option_no||' · ' else '' end||attendees||' can play · '||late||' late',
      'value',case when session is null then format('<t:%s:F>%s',extract(epoch from start_at)::bigint,E'\n') else '' end
        ||details||E'\n[Vote / update availability]('||vote_link||')',
      'inline',false));
  end loop;
  return jsonb_build_object('allowed_mentions',jsonb_build_object('parse','[]'::jsonb),'embeds',jsonb_build_array(jsonb_build_object(
    'title',title,'url',p_site_url||'?mode=player#schedule','color',15934847,
    'description',description,'fields',fields,
    'footer',jsonb_build_object('text','Attendance updates automatically, usually within a minute. Click a voting link to reply.'))));
end $$;

create or replace function cast_discord.sync(p_slug text)
returns text language plpgsql set search_path=pg_catalog,public,extensions as $$
declare c cast_discord.connections; hook text; body jsonb; response extensions.http_response; creating boolean;
begin
  if not pg_try_advisory_xact_lock(hashtext('cast-discord'),hashtext(p_slug)) then return 'Already syncing'; end if;
  select * into c from cast_discord.connections where slug=p_slug for update;
  if not found or not c.enabled then return 'Disabled'; end if;
  if c.retry_after>now() then return 'Waiting to retry'; end if;
  body:=cast_discord.payload(c.slug,c.site_url);
  if body is null then return 'Schedule unavailable'; end if;
  if body=c.last_payload then return 'Unchanged'; end if;
  select decrypted_secret into hook from vault.decrypted_secrets where id=c.secret_id;
  if hook is null or hook !~ '^https://discord[.]com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$' then
    update cast_discord.connections set enabled=false,last_status='Invalid or missing webhook secret' where slug=p_slug;
    return 'Invalid or missing webhook secret';
  end if;
  creating:=c.message_id is null;
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','3000');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','8000');
  begin
    select * into response from extensions.http((
      case when creating then 'POST' else 'PATCH' end,
      hook||case when creating then '?wait=true' else '/messages/'||c.message_id end,
      array[extensions.http_header('Content-Type','application/json')],
      'application/json',body::text)::extensions.http_request);
  exception when others then
    -- Do not log SQLERRM: HTTP errors may contain the private webhook URL.
    update cast_discord.connections set enabled=not creating,
      last_status=case when creating then 'Creation outcome uncertain; check Discord before retrying' else 'Network failure; will retry' end,
      retry_after=now()+interval '1 minute' where slug=p_slug;
    return 'Network failure';
  end;
  if response.status between 200 and 299 then
    update cast_discord.connections set
      message_id=coalesce(c.message_id,response.content::jsonb->>'id'),last_payload=body,
      last_success_at=now(),last_status='Synced',retry_after=null where slug=p_slug;
    return 'Synced';
  elsif response.status=429 then
    update cast_discord.connections set last_status='Rate limited; will retry',retry_after=now()+interval '2 minutes' where slug=p_slug;
  else
    update cast_discord.connections set enabled=not creating and response.status not in (401,403,404),
      last_status='Discord HTTP '||response.status,retry_after=now()+interval '2 minutes' where slug=p_slug;
  end if;
  return 'Discord HTTP '||response.status;
end $$;
revoke all on all functions in schema cast_discord from public, anon, authenticated;
-- Runs as the database owner, independently of anyone having the website open.
select cron.schedule('cast-discord-schedule','* * * * *',
  $job$select cast_discord.sync(slug) from cast_discord.connections where enabled;$job$);
commit;
