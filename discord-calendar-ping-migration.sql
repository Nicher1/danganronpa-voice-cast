-- Run after discord-likely-days-migration.sql.
-- 1. The card of a confirmed session gets an "Add to Google Calendar" link.
-- 2. The host can ping the group by hand: the card moves to the bottom, then the players who
--    voted yes are pinged underneath it, exactly like the automatic 30-minute reminder.
--    A manual ping never counts as the automatic one, and has a 2 minute cooldown.
-- Safe to run more than once.
begin;

alter table cast_discord.connections add column if not exists last_manual_ping_at timestamptz;

create or replace function cast_discord.payload(p_slug text,p_site_url text,p_now timestamptz default now())
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare
  s jsonb; actors jsonb; session jsonb; start_at timestamptz; base_at timestamptz;
  dates date[]; d date; week_start date; today date:=(p_now at time zone 'Europe/Copenhagen')::date;
  likely_dates date[]:='{}';
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
    -- Google Calendar wants UTC times. Sessions usually last about three hours.
    description:=description||E'\n[Add to Google Calendar](https://calendar.google.com/calendar/render?action=TEMPLATE&text=Danganronpa+session&dates='
      ||to_char(start_at at time zone 'UTC','YYYYMMDD"T"HH24MISS"Z"')||'/'
      ||to_char((start_at+interval '3 hours') at time zone 'UTC','YYYYMMDD"T"HH24MISS"Z"')
      ||'&details='||replace(replace(p_site_url,':','%3A'),'/','%2F')||')';
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
    -- Match the website forecast: actual voters, latest arrival, three-vote minimum,
    -- and no arbitrary selection when more than three dates share the lead.
    with candidates as (
      select candidate as date, count(*) as count,
        public.cast_schedule_instant(candidate::text,coalesce(s->'times'->>candidate::text,'19:00'))
          + max(coalesce((v.value->>'offset')::integer,0))*interval '1 minute' as arrival
      from unnest(dates) candidate
      cross join lateral jsonb_each(coalesce(s->'votes'->candidate::text,'{}')) v
      where v.value->>'available'='true'
        and exists(select 1 from jsonb_array_elements(actors) a where a->>'id'=v.key)
      group by candidate
      having count(*)>=3
    ), future as (
      select * from candidates where arrival>p_now
    ), leaders as (
      select date from future where count=(select max(count) from future)
    )
    select coalesce(array_agg(date order by date),'{}'::date[]) into likely_dates
      from leaders having count(*)<=3;
    if cardinality(likely_dates)>0 then
      description:=description||E'\nBold dates are likely days, not confirmed sessions.';
    end if;
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
      'value',case when session is null then format('%s<t:%s:F>%s%s',case when d=any(likely_dates) then '**' else '' end,extract(epoch from start_at)::bigint,case when d=any(likely_dates) then '**' else '' end,E'\n') else '' end
        ||details||E'\n[Vote / update availability]('||vote_link||')',
      'inline',false));
  end loop;
  return jsonb_build_object('allowed_mentions',jsonb_build_object('parse','[]'::jsonb),'embeds',jsonb_build_array(jsonb_build_object(
    'title',title,'url',p_site_url||'?mode=player#schedule','color',15934847,
    'description',description,'fields',fields,
    'footer',jsonb_build_object('text','Attendance updates automatically, usually within a minute. Click a voting link to reply.'))));
end $$;

create or replace function cast_discord.ping_now(p_slug text, p_now timestamptz default now())
returns text language plpgsql set search_path = pg_catalog, public, extensions as $$
declare
  c cast_discord.connections; s jsonb; actors jsonb; session jsonb; hook text;
  session_start timestamptz; local_day date; body jsonb; r jsonb; code integer;
  ids text[] := '{}'; names text[] := '{}'; content text; person record; result text;
begin
  if not pg_try_advisory_xact_lock(hashtext('cast-discord'), hashtext(p_slug)) then return 'Already syncing'; end if;
  select * into c from cast_discord.connections where slug = p_slug for update;
  if not found or not c.enabled then return 'Disabled'; end if;
  if c.card_uncertain then return 'Card outcome uncertain; check Discord'; end if;
  if c.retry_after > p_now then return 'Waiting to retry'; end if;
  if c.last_manual_ping_at > p_now - interval '2 minutes' then return 'Wait 2 minutes between pings'; end if;

  select decrypted_secret into hook from vault.decrypted_secrets where id = c.secret_id;
  if hook is null or hook !~ '^https://discord[.]com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$' then
    update cast_discord.connections set enabled = false, last_status = 'Invalid or missing webhook secret' where slug = p_slug;
    return 'Invalid or missing webhook secret';
  end if;

  select state into s from public.cast_schedules where slug = p_slug;
  select state -> 'actors' into actors from public.cast_public_boards where slug = p_slug and initialized;
  if s is null or actors is null then return 'Schedule unavailable'; end if;

  -- The same session the card shows: unfinished, and not more than 10 hours past its start.
  select x into session from jsonb_array_elements(s -> 'sessions') x
    where nullif(x ->> 'endedAt', '') is null
      and (x ->> 'startAt')::timestamptz + interval '10 hours' > p_now
    order by (x ->> 'startAt')::timestamptz limit 1;
  if session is null then return 'No confirmed session to ping'; end if;
  session_start := (session ->> 'startAt')::timestamptz;
  local_day := (session_start at time zone 'Europe/Copenhagen')::date;

  for person in
    select a ->> 'name' as name, l.discord_id
    from jsonb_each(coalesce(s -> 'votes' -> local_day::text, '{}')) v
    join jsonb_array_elements(actors) a on a ->> 'id' = v.key
    left join cast_discord.actor_links l on l.slug = p_slug and l.actor_id = v.key
    where v.value ->> 'available' = 'true'
    order by a ->> 'name'
  loop
    if person.discord_id is not null then ids := ids || person.discord_id;
    else names := names || cast_discord.safe_name(person.name); end if;
  end loop;
  if cardinality(ids) + cardinality(names) = 0 then return 'Nobody has said yes for this session'; end if;

  content := format('⏰ Danganronpa %s <t:%s:R>', case when session_start <= p_now then 'is underway, started' else 'starts' end,
    extract(epoch from session_start)::bigint);
  if cardinality(ids) > 0 then
    content := content || E'\n' || (select string_agg('<@' || i || '>', ' ') from unnest(ids) i);
  end if;
  if cardinality(names) > 0 then content := content || E'\nAlso playing: ' || left(array_to_string(names, ', '), 400); end if;
  -- Only the listed users can be pinged. Everyone/role pings stay impossible.
  body := jsonb_build_object('content', content,
    'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', to_jsonb(ids)));

  -- Keep the ping directly below the fresh card, like the automatic reminder.
  result := cast_discord.repost(p_slug, p_now);
  if result <> 'Card reposted' then return result; end if;

  r := cast_discord.webhook_call(hook, 'POST', '?wait=true', body);
  code := (r ->> 'status')::integer;
  -- The cooldown starts even when the outcome is unknown, so a retry cannot double-ping.
  update cast_discord.connections set last_manual_ping_at = p_now where slug = p_slug;
  if code between 200 and 299 then
    update cast_discord.connections set last_success_at = p_now, last_status = 'Group pinged by host' where slug = p_slug;
    return 'Group pinged (' || (cardinality(ids) + cardinality(names)) || ')';
  elsif code = 0 or code >= 500 then
    update cast_discord.connections set last_status = 'Ping outcome uncertain; check Discord' where slug = p_slug;
    return 'Ping outcome uncertain; check Discord';
  else
    update cast_discord.connections set last_status = 'Ping HTTP ' || code where slug = p_slug;
    return 'Ping HTTP ' || code;
  end if;
end $$;

create or replace function public.cast_ping_discord_group(p_slug text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result text;
begin
  if not public.cast_is_host(p_slug) then raise exception 'Host access required.'; end if;
  result := cast_discord.ping_now(p_slug);
  -- Do not raise after HTTP calls: database state must survive partial success.
  return jsonb_build_object('ok', result like 'Group pinged%', 'status', result);
end $$;

revoke all on function cast_discord.ping_now(text, timestamptz) from public, anon, authenticated;
revoke all on function public.cast_ping_discord_group(text) from public, anon, authenticated;
grant execute on function public.cast_ping_discord_group(text) to authenticated;
notify pgrst, 'reload schema';
commit;
