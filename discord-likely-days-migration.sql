-- Bold likely poll dates in the existing Discord card.
-- Run after discord-card-repost-migration.sql. Changes formatting only; no send call.
begin;
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

commit;
