-- Additive migration: does not replace cast boards, assignments or predictions.
-- Apply once to the existing project, then shared-scheduling-cron.sql.
begin;

create table if not exists public.cast_schedules (
  slug text primary key references public.cast_boards(slug) on delete cascade,
  state jsonb not null default '{"version":1,"hostActorId":"b252e57d-7370-4c59-a898-fd381593cb33","sessions":[],"votes":{},"times":{},"notices":[],"records":{}}',
  revision bigint not null default 1,
  last_request_id uuid,
  updated_at timestamptz not null default now()
);
create table if not exists public.cast_schedule_requests (
  slug text not null references public.cast_schedules(slug) on delete cascade,
  user_id uuid not null,
  request_id uuid not null,
  action text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (slug,user_id,request_id)
);
alter table public.cast_schedules enable row level security;
alter table public.cast_schedule_requests enable row level security;
revoke all on public.cast_schedules, public.cast_schedule_requests from public, anon, authenticated;
grant select on public.cast_schedules to anon, authenticated;
grant select,insert,update,delete on public.cast_schedules, public.cast_schedule_requests to service_role;
drop policy if exists "Public shared schedule" on public.cast_schedules;
create policy "Public shared schedule" on public.cast_schedules for select to anon,authenticated
  using (exists(select 1 from public.cast_public_boards b where b.slug=cast_schedules.slug and b.initialized));

insert into public.cast_schedules(slug,state)
select slug, '{"version":1,"hostActorId":"b252e57d-7370-4c59-a898-fd381593cb33","sessions":[{"id":"session-2026-10-21","startAt":"2026-10-21T17:45:00.000Z","endedAt":null,"breaks":[],"source":"host"}],"votes":{},"times":{"2026-10-21":"19:45"},"notices":[],"records":{}}'::jsonb
from public.cast_boards where slug='danganronpa-main' and initialized
on conflict(slug) do nothing;

-- Match the browser's Copenhagen conversion, including the FIRST autumn 02:30.
create or replace function public.cast_schedule_instant(p_date text,p_time text)
returns timestamptz language plpgsql stable set search_path=public as $$
declare civil timestamp; result timestamptz;
begin
  if p_date is null or p_time is null or p_date !~ '^\d{4}-\d{2}-\d{2}$' or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Choose a valid date and time.';
  end if;
  civil := (p_date || ' ' || p_time)::timestamp;
  select min(candidate) into result
  from (select (civil at time zone 'UTC')+make_interval(mins=>n) candidate from generate_series(-180,180,15) n) candidates
  where to_char(candidate at time zone 'Europe/Copenhagen','YYYY-MM-DD HH24:MI')=p_date||' '||p_time;
  if result is null then raise exception 'That time does not exist in Denmark because the clocks change.'; end if;
  return result;
end $$;

create or replace function public.cast_schedule_rebase(p_state jsonb,p_date text,p_time text)
returns jsonb language plpgsql stable set search_path=public as $$
declare difference integer; entry record; s jsonb:=p_state;
begin
  difference:=extract(epoch from (public.cast_schedule_instant(p_date,coalesce(s->'times'->>p_date,'19:00'))-public.cast_schedule_instant(p_date,p_time)))/60;
  for entry in select * from jsonb_each(coalesce(s->'votes'->p_date,'{}')) loop
    s:=jsonb_set(s,array['votes',p_date,entry.key,'offset'],to_jsonb(coalesce((entry.value->>'offset')::integer,0)+difference));
  end loop;
  return jsonb_set(s,array['times',p_date],to_jsonb(p_time),true);
end $$;

-- Private helper. Caller must hold the schedule row lock. No client-supplied clock.
create or replace function public.cast_schedule_reconcile(p_slug text,p_state jsonb,p_now timestamptz)
returns jsonb language plpgsql set search_path=public as $$
declare s jsonb:=p_state; week date; best record; old_record integer; adjusted timestamptz; actor_ids jsonb;
begin
  select coalesce(jsonb_agg(a->>'id'),'[]') into actor_ids from public.cast_boards b,
    lateral jsonb_array_elements(b.state->'actors') a where b.slug=p_slug;
  for week in select distinct date_trunc('week',key::date)::date from jsonb_each(s->'votes') loop
    select d.key as day,count(*)::integer as count,
      public.cast_schedule_instant(d.key,coalesce(s->'times'->>d.key,'19:00')) as start_at,
      (ceil(sum(coalesce((v.value->>'offset')::numeric,0))/(count(*)+1)/15)*15)::integer as adjustment
    into best
    from jsonb_each(s->'votes') d, lateral jsonb_each(d.value) v
    where d.key::date between week and week+6 and extract(isodow from d.key::date)<>2
      and (v.value->>'available')::boolean and actor_ids ? v.key
      and public.cast_schedule_instant(d.key,coalesce(s->'times'->>d.key,'19:00'))>p_now
    group by d.key
    having count(*)>=3 and bool_or(v.key=s->>'hostActorId')
    order by count(*) desc,d.key limit 1;
    if not found then continue; end if;
    old_record:=coalesce((s->'records'->>week::text)::integer,0);
    if best.count>old_record then
      s:=jsonb_set(s,array['records',week::text],to_jsonb(best.count));
      s:=jsonb_set(s,'{notices}',(s->'notices')||jsonb_build_array(jsonb_build_object(
        'id',week::text||'-'||best.count,'week',week,'date',best.day,'count',best.count,
        'createdAt',p_now,'status','Email not connected')));
    end if;
    adjusted:=best.start_at+make_interval(mins=>best.adjustment);
    if adjusted>p_now and p_now>=adjusted-interval '48 hours'
      and not coalesce((s->'autoSelectionDisabled'->>week::text)::boolean,false) and not exists(
      select 1 from jsonb_array_elements(s->'sessions') x
      where date_trunc('week',(x->>'startAt')::timestamptz at time zone 'Europe/Copenhagen')::date=week
    ) then
      s:=public.cast_schedule_rebase(s,best.day,to_char(adjusted at time zone 'Europe/Copenhagen','HH24:MI'));
      s:=jsonb_set(s,'{sessions}',(s->'sessions')||jsonb_build_array(jsonb_build_object(
        'id','auto-'||best.day,'startAt',adjusted,'endedAt',null,'breaks','[]'::jsonb,'source','poll')));
    end if;
  end loop;
  return s;
end $$;

create or replace function public.cast_schedule_action(p_slug text,p_action text,p_payload jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare row public.cast_schedules; s jsonb; host boolean; actor text; d text; t text;
  existing jsonb; idx integer; offset_value integer; start_at timestamptz;
  moment timestamptz:=statement_timestamp(); today date; item record; breaks jsonb;
  duplicate public.cast_schedule_requests;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>4096 then raise exception 'Invalid scheduling request.'; end if;
  host:=public.cast_is_host(p_slug);
  if p_action='vote' then
    actor:=p_payload->>'actorId';
    if actor is null or not (host or exists(select 1 from public.cast_actor_sessions a where a.board_slug=p_slug and a.actor_id=actor and a.user_id=auth.uid())) then
      raise exception 'You can only change your own availability.';
    end if;
    if not exists(select 1 from public.cast_boards b, lateral jsonb_array_elements(b.state->'actors') a where b.slug=p_slug and a->>'id'=actor) then raise exception 'Voice actor not found.'; end if;
  elsif p_action in ('schedule','cancel','end','break','resume') then
    if not host then raise exception 'Host access required.'; end if;
  else raise exception 'Unknown scheduling action.';
  end if;
  select * into row from public.cast_schedules where slug=p_slug for update;
  if not found then raise exception 'Shared scheduling has not been installed for this board.'; end if;
  select * into duplicate from public.cast_schedule_requests where slug=p_slug and user_id=auth.uid() and request_id=p_request_id;
  if found then
    if duplicate.action<>p_action or duplicate.payload<>p_payload then raise exception 'Request ID already used.'; end if;
    return to_jsonb(row);
  end if;
  s:=row.state; today:=(moment at time zone 'Europe/Copenhagen')::date;
  if p_action in ('vote','schedule') then
    d:=p_payload->>'date';
    if d is null or d !~ '^\d{4}-\d{2}-\d{2}$' or d::date<today or d::date>today+730 then raise exception 'Choose today or a date within the next two years.'; end if;
    if extract(isodow from d::date)=2 then raise exception 'Tuesday is unavailable.'; end if;
  end if;
  if p_action='vote' then
    if jsonb_typeof(p_payload->'available') is distinct from 'boolean' then raise exception 'Availability must be true or false.'; end if;
    offset_value:=coalesce((s->'votes'->d->actor->>'offset')::integer,0);
    if p_payload ? 'delta' then
      if p_payload->>'delta' not in ('-15','15') then raise exception 'Use 15-minute steps.'; end if;
      offset_value:=offset_value+(p_payload->>'delta')::integer;
    elsif p_payload ? 'offset' then
      offset_value:=(p_payload->>'offset')::integer;
    end if;
    if offset_value is null or offset_value%15<>0 or abs(offset_value)>1440 then raise exception 'Invalid availability offset.'; end if;
    if not (s->'votes' ? d) then s:=jsonb_set(s,array['votes',d],'{}'); end if;
    s:=jsonb_set(s,array['votes',d,actor],jsonb_build_object('available',p_payload->'available','offset',offset_value));
  elsif p_action='schedule' then
    t:=p_payload->>'time'; start_at:=public.cast_schedule_instant(d,t);
    if extract(minute from start_at)::integer%15<>0 then raise exception 'Use 15-minute steps.'; end if;
    if nullif(p_payload->>'id','') is not null then
      select value,(ordinality-1)::integer into existing,idx from jsonb_array_elements(s->'sessions') with ordinality where value->>'id'=p_payload->>'id';
      if not found or (existing->>'startAt')::timestamptz<=moment then raise exception 'Only future sessions can be adjusted.'; end if;
      if p_payload->>'expectedStartAt' is null or (existing->>'startAt')::timestamptz<>(p_payload->>'expectedStartAt')::timestamptz then raise exception 'This session changed. Refresh and try again.'; end if;
    end if;
    if exists(select 1 from jsonb_array_elements(s->'sessions') x where (x->>'startAt')::timestamptz=start_at and (existing is null or x->>'id'<>existing->>'id')) then raise exception 'A session is already scheduled at that time.'; end if;
    s:=public.cast_schedule_rebase(s,d,t);
    if existing is null then
      s:=jsonb_set(s,'{sessions}',(s->'sessions')||jsonb_build_array(jsonb_build_object('id',p_request_id,'startAt',start_at,'endedAt',null,'breaks','[]'::jsonb,'source','host')));
    else
      s:=jsonb_set(s,array['sessions',idx::text],existing||jsonb_build_object('startAt',start_at,'source','host'));
    end if;
  elsif p_action='cancel' then
    select value,(ordinality-1)::integer into existing,idx from jsonb_array_elements(s->'sessions') with ordinality where value->>'id'=p_payload->>'id';
    if not found or (existing->>'startAt')::timestamptz<=moment then raise exception 'Only future sessions can be removed.'; end if;
    if p_payload->>'expectedStartAt' is null or (existing->>'startAt')::timestamptz<>(p_payload->>'expectedStartAt')::timestamptz then raise exception 'This session changed. Refresh and try again.'; end if;
    s:=jsonb_set(s,'{sessions}',(s->'sessions')-idx);
    -- Removing a chosen date must not immediately recreate it from its votes.
    s:=jsonb_set(s,'{autoSelectionDisabled}',coalesce(s->'autoSelectionDisabled','{}')||jsonb_build_object(
      date_trunc('week',(existing->>'startAt')::timestamptz at time zone 'Europe/Copenhagen')::date::text,true));
  else
    select value,(ordinality-1)::integer into existing,idx from jsonb_array_elements(s->'sessions') with ordinality
      where (value->>'startAt')::timestamptz<=moment order by (value->>'startAt')::timestamptz desc limit 1;
    if not found or least((existing->>'startAt')::timestamptz+interval '10 hours',coalesce((existing->>'endedAt')::timestamptz,'infinity'::timestamptz))<=moment then raise exception 'There is no current session.'; end if;
    if p_payload->>'id' is distinct from existing->>'id' then raise exception 'The current session changed. Refresh and try again.'; end if;
    breaks:=existing->'breaks';
    if p_action='break' then
      if not exists(select 1 from jsonb_array_elements(breaks) b where b->>'endAt' is null) then
        breaks:=breaks||jsonb_build_array(jsonb_build_object('startAt',moment,'endAt',null));
      end if;
    else
      select coalesce(jsonb_agg(case when b->>'endAt' is null then b||jsonb_build_object('endAt',moment) else b end),'[]') into breaks from jsonb_array_elements(breaks) b;
      if p_action='end' then existing:=existing||jsonb_build_object('endedAt',moment); end if;
    end if;
    s:=jsonb_set(s,array['sessions',idx::text],existing||jsonb_build_object('breaks',breaks));
  end if;
  s:=public.cast_schedule_reconcile(p_slug,s,moment);
  insert into public.cast_schedule_requests(slug,user_id,request_id,action,payload) values(p_slug,auth.uid(),p_request_id,p_action,p_payload);
  update public.cast_schedules set state=s,revision=revision+1,last_request_id=p_request_id,updated_at=moment where slug=p_slug returning * into row;
  return to_jsonb(row);
end $$;

create or replace function public.cast_schedule_tick()
returns integer language plpgsql security definer set search_path=public as $$
declare row record; s jsonb; changes integer:=0;
begin
  for row in select * from public.cast_schedules order by slug for update skip locked loop
    s:=public.cast_schedule_reconcile(row.slug,row.state,statement_timestamp());
    if s<>row.state then
      update public.cast_schedules set state=s,revision=revision+1,updated_at=statement_timestamp() where slug=row.slug;
      changes:=changes+1;
    end if;
  end loop;
  delete from public.cast_schedule_requests where created_at<now()-interval '30 days';
  return changes;
end $$;

revoke all on function public.cast_schedule_instant(text,text), public.cast_schedule_rebase(jsonb,text,text), public.cast_schedule_reconcile(text,jsonb,timestamptz), public.cast_schedule_action(text,text,jsonb,uuid), public.cast_schedule_tick() from public,anon,authenticated;
grant execute on function public.cast_schedule_action(text,text,jsonb,uuid) to authenticated;
grant execute on function public.cast_schedule_tick() to service_role;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='cast_schedules') then
    alter publication supabase_realtime add table public.cast_schedules;
  end if;
end $$;
notify pgrst, 'reload schema';
commit;
