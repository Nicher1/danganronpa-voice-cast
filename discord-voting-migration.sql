-- Run after discord-actor-links-migration.sql and discord-schedule-migration.sql.
-- Installs inactive app support; does not replace or disable the existing card.
begin;
create table if not exists cast_discord.apps (
  slug text primary key references public.cast_schedules(slug) on delete cascade,
  application_id text not null check(application_id ~ '^[0-9]{17,20}$'),
  guild_id text not null check(guild_id ~ '^[0-9]{17,20}$'),
  channel_id text not null check(channel_id ~ '^[0-9]{17,20}$'),
  token_secret_id uuid not null,
  site_url text not null default 'https://nicher1.github.io/danganronpa-voice-cast/',
  message_id text,
  enabled boolean not null default false,
  last_payload jsonb, last_success_at timestamptz, last_status text, retry_after timestamptz
);
create table if not exists cast_discord.panels (
  id uuid primary key default gen_random_uuid(),
  slug text not null references cast_discord.apps(slug) on delete cascade,
  discord_id text not null, day text not null, choice_key text not null,
  expires_at timestamptz not null default now()+interval '30 minutes'
);
create table if not exists cast_discord.interactions (
  interaction_id text primary key,
  slug text not null references cast_discord.apps(slug) on delete cascade,
  request jsonb not null, response jsonb not null,
  created_at timestamptz not null default now()
);
revoke all on cast_discord.apps,cast_discord.panels,cast_discord.interactions from public,anon,authenticated;
alter table cast_discord.apps enable row level security;
alter table cast_discord.panels enable row level security;
alter table cast_discord.interactions enable row level security;

-- Uses the same active/next session and planning week as the existing card.
create or replace function cast_discord.choices(p_slug text,p_now timestamptz default now())
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare s jsonb; session jsonb; start_at timestamptz; today date:=(p_now at time zone 'Europe/Copenhagen')::date;
  week_start date; d date; dates date[]; result jsonb:='[]';
begin
  select state into s from public.cast_schedules where slug=p_slug;
  if s is null then return result; end if;
  select x into session from jsonb_array_elements(s->'sessions') x
    where nullif(x->>'endedAt','') is null and (x->>'startAt')::timestamptz+interval '10 hours'>p_now
    order by (x->>'startAt')::timestamptz limit 1;
  if session is not null then
    start_at:=(session->>'startAt')::timestamptz;
    dates:=array[(start_at at time zone 'Europe/Copenhagen')::date];
  else
    select max((x->>'startAt')::timestamptz) into start_at from jsonb_array_elements(s->'sessions') x where (x->>'startAt')::timestamptz<=p_now;
    week_start:=greatest(date_trunc('week',coalesce(start_at at time zone 'Europe/Copenhagen',today::timestamp))::date+7,date_trunc('week',today::timestamp)::date);
    select array_agg(day order by day) into dates from (select week_start+i as day from generate_series(0,6) i) days where day>=today and extract(isodow from day)<>2;
  end if;
  foreach d in array dates loop
    if session is null then
      start_at:=public.cast_schedule_instant(d::text,coalesce(s->'times'->>d::text,'19:00'));
      if start_at<=p_now then continue; end if;
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('date',d,'startAt',start_at,'epoch',extract(epoch from start_at)::bigint,
      'label',to_char(d,'Dy DD Mon YYYY'),'scheduled',session is not null,
      'key',substr(md5(d::text||'/'||extract(epoch from start_at)::bigint||'/'||coalesce(session->>'id','poll')),1,16)));
  end loop;
  return result;
end $$;

create or replace function cast_discord.buttons(prefix text)
returns jsonb language sql immutable set search_path=pg_catalog as $$
 select jsonb_build_array(jsonb_build_object('type',1,'components',jsonb_build_array(
   jsonb_build_object('type',2,'style',3,'label','Can attend','custom_id',prefix||':yes'),
   jsonb_build_object('type',2,'style',4,'label','Cannot play that day','custom_id',prefix||':no'),
   jsonb_build_object('type',2,'style',2,'label','−15 min','custom_id',prefix||':earlier'),
   jsonb_build_object('type',2,'style',2,'label','+15 min','custom_id',prefix||':later'),
   jsonb_build_object('type',2,'style',2,'label','On time','custom_id',prefix||':ontime')
 )))
$$;

-- Each private panel carries its own selected date; another member cannot change it.
create or replace function cast_discord.day_buttons(p_choices jsonb,p_panel uuid default null,p_selected text default null)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare result jsonb:='[]'; buttons jsonb:='[]'; choice jsonb;
begin
  for choice in select value from jsonb_array_elements(p_choices) loop
    buttons:=buttons||jsonb_build_array(jsonb_build_object('type',2,'style',case when choice->>'date'=p_selected then 1 else 2 end,
      'label',to_char((choice->>'date')::date,'FMDay DD Mon'),
      'custom_id',case when p_panel is null then 'cast:v:' else 'cast:s:'||p_panel||':' end||(choice->>'date')||':'||(choice->>'key')||case when p_panel is null then ':view' else '' end));
    if jsonb_array_length(buttons)=3 then
      result:=result||jsonb_build_array(jsonb_build_object('type',1,'components',buttons));buttons:='[]';
    end if;
  end loop;
  if jsonb_array_length(buttons)>0 then result:=result||jsonb_build_array(jsonb_build_object('type',1,'components',buttons));end if;
  return result;
end $$;

create or replace function cast_discord.bot_payload(p_slug text,p_site_url text,p_now timestamptz default now())
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare body jsonb:=cast_discord.payload(p_slug,p_site_url,p_now); choices jsonb:=cast_discord.choices(p_slug,p_now);
  option jsonb; options jsonb:='[]'; components jsonb:='[]';
begin
  if body is null then return null; end if;
  if jsonb_array_length(choices)=1 and (choices->0->>'scheduled')::boolean then
    option:=choices->0;
    components:=cast_discord.buttons('cast:v:'||(option->>'date')||':'||(option->>'key'));
  elsif jsonb_array_length(choices)>0 then
    components:=cast_discord.day_buttons(choices);
  end if;
  components:=components||jsonb_build_array(jsonb_build_object('type',1,'components',jsonb_build_array(jsonb_build_object(
    'type',2,'style',5,'label','Open website schedule','url',p_site_url||'?mode=player#schedule'))));
  body:=jsonb_set(body,'{embeds,0,footer,text}','"Choose a day, then set attendance and arrival in your private controls. Each day is saved separately. Day labels follow the Danish calendar; timestamps show your local time."');
  return body||jsonb_build_object('components',components);
end $$;

-- Called only by the server after verifying Discord's Ed25519 request signature.
-- No bot token, interaction token or website password is stored in request logs.
create or replace function public.cast_discord_interaction(p_event jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare app cast_discord.apps; prior cast_discord.interactions; panel cast_discord.panels;
  actor text; actor_name text; custom text:=p_event->>'custom_id'; parts text[];
  d text; choice_key text; action text; choice jsonb; s jsonb; vote jsonb; response jsonb; panel_id uuid;
  baseline integer; offset_value integer; available boolean; moment timestamptz:=statement_timestamp();
begin
  if p_event is null or jsonb_typeof(p_event)<>'object' or octet_length(p_event::text)>8192 or coalesce(p_event->>'interaction_id','') !~ '^[0-9]{17,20}$' or coalesce(p_event->>'discord_id','') !~ '^[0-9]{17,20}$' then
    raise exception 'Invalid interaction.';
  end if;
  select * into app from cast_discord.apps where enabled and application_id=p_event->>'application_id' and guild_id=p_event->>'guild_id' and channel_id=p_event->>'channel_id';
  if not found then raise exception 'This schedule is not connected to this Discord channel.'; end if;
  -- Consistent lock order: board -> schedule. Host link edits also lock the board.
  perform 1 from public.cast_boards where slug=app.slug for share;
  select state into s from public.cast_schedules where slug=app.slug for update;
  select * into prior from cast_discord.interactions where interaction_id=p_event->>'interaction_id';
  if found then
    if prior.request<>p_event then raise exception 'Interaction ID already used.'; end if;
    return prior.response;
  end if;
  select a->>'id',a->>'name' into actor,actor_name from cast_discord.actor_links l
    join public.cast_boards b on b.slug=l.slug cross join lateral jsonb_array_elements(b.state->'actors') a
    where l.slug=app.slug and l.discord_id=p_event->>'discord_id' and a->>'id'=l.actor_id;
  if actor is null then raise exception 'Your Discord account is not linked yet. Ask the host to add your Discord user ID to your voice actor profile.'; end if;
  parts:=string_to_array(custom,':');
  if custom='cast:choose' then
    if p_event->>'message_id' is distinct from app.message_id or jsonb_typeof(p_event->'values') is distinct from 'array' then raise exception 'Open the current pinned schedule message.'; end if;
    if jsonb_array_length(p_event->'values')<>1 then raise exception 'Choose one day.'; end if;
    d:=split_part(p_event->'values'->>0,'|',1);choice_key:=split_part(p_event->'values'->>0,'|',2);
    action:='view';
  elsif parts[1]='cast' and parts[2]='v' and array_length(parts,1)=5 then
    if p_event->>'message_id' is distinct from app.message_id then raise exception 'Open the current pinned schedule message.'; end if;
    d:=parts[3];choice_key:=parts[4];action:=parts[5];
  elsif parts[1]='cast' and ((parts[2]='p' and array_length(parts,1)=4) or (parts[2]='s' and array_length(parts,1)=5)) then
    if parts[3] !~ '^[0-9a-f-]{36}$' then raise exception 'Open the current pinned schedule message.'; end if;
    select * into panel from cast_discord.panels where id=parts[3]::uuid and slug=app.slug and discord_id=p_event->>'discord_id' and expires_at>moment;
    if not found then raise exception 'These controls expired. Choose your day again from the pinned schedule.'; end if;
    if parts[2]='s' then d:=parts[4];choice_key:=parts[5];action:='view';
    else d:=panel.day;choice_key:=panel.choice_key;action:=parts[4];end if;
  else raise exception 'Unknown schedule button.';
  end if;
  select value into choice from jsonb_array_elements(cast_discord.choices(app.slug,moment)) where value->>'date'=d and value->>'key'=choice_key;
  if choice is null then raise exception 'The schedule changed or this date has finished. Use the latest pinned schedule.'; end if;
  baseline:=extract(epoch from ((choice->>'startAt')::timestamptz-public.cast_schedule_instant(d,coalesce(s->'times'->>d,'19:00'))))/60;
  vote:=s->'votes'->d->actor;
  offset_value:=coalesce((vote->>'offset')::integer,baseline);
  available:=coalesce((vote->>'available')::boolean,false);
  if action='yes' then available:=true;
  elsif action='no' then available:=false;
  elsif action='earlier' then available:=true;offset_value:=offset_value-15;
  elsif action='later' then available:=true;offset_value:=offset_value+15;
  elsif action='ontime' then available:=true;offset_value:=baseline;
  elsif action<>'view' then raise exception 'Unknown schedule button.';
  end if;
  if abs(offset_value)>1440 or offset_value%15<>0 then raise exception 'Arrival adjustments must stay within 24 hours.'; end if;
  if action<>'view' then
    if not (s->'votes' ? d) then s:=jsonb_set(s,array['votes',d],'{}'); end if;
    s:=jsonb_set(s,array['votes',d,actor],jsonb_build_object('available',available,'offset',offset_value));
    s:=public.cast_schedule_reconcile(app.slug,s,moment);
    update public.cast_schedules set state=s,revision=revision+1,last_request_id=gen_random_uuid(),updated_at=moment where slug=app.slug;
  end if;
  -- Reconciliation can select a session and rebase offsets, so read the result.
  select value into choice from jsonb_array_elements(cast_discord.choices(app.slug,moment)) where value->>'date'=d;
  if choice is null then
    response:=jsonb_build_object('content','Your reply was saved. The schedule has now changed; open the pinned card for the latest dates.','components','[]'::jsonb);
  else
    baseline:=extract(epoch from ((choice->>'startAt')::timestamptz-public.cast_schedule_instant(d,coalesce(s->'times'->>d,'19:00'))))/60;
    vote:=s->'votes'->d->actor; offset_value:=coalesce((vote->>'offset')::integer,baseline)-baseline;
    insert into cast_discord.panels(slug,discord_id,day,choice_key) values(app.slug,p_event->>'discord_id',d,choice->>'key') returning id into panel_id;
    response:=jsonb_build_object('content',cast_discord.safe_name(actor_name)||' · '||format('<t:%s:F>',choice->>'epoch')||E'\n'||
      case when vote is null then 'No reply yet.' when not (vote->>'available')::boolean then 'Cannot attend.'
        else 'Can attend · '||case when offset_value=0 then 'on time.' when offset_value>0 then offset_value||' minutes late.' else abs(offset_value)||' minutes early.' end end||
      case when action='view' then E'\nChoose your attendance below.' else E'\nSaved to your voice actor on the website.' end,
      'components',cast_discord.buttons('cast:p:'||panel_id)||cast_discord.day_buttons(cast_discord.choices(app.slug,moment),panel_id,d));
  end if;
  response:=response||jsonb_build_object('allowed_mentions',jsonb_build_object('parse','[]'::jsonb));
  insert into cast_discord.interactions(interaction_id,slug,request,response) values(p_event->>'interaction_id',app.slug,p_event,response);
  return response;
end $$;

create or replace function cast_discord.sync_bot(p_slug text)
returns text language plpgsql set search_path=pg_catalog,public,extensions as $$
declare app cast_discord.apps; token text; body jsonb; response extensions.http_response; creating boolean;
begin
  if not pg_try_advisory_xact_lock(hashtext('cast-discord-bot'),hashtext(p_slug)) then return 'Already syncing'; end if;
  select * into app from cast_discord.apps where slug=p_slug for update;
  if not found or not app.enabled then return 'Disabled'; end if;
  if app.retry_after>now() then return 'Waiting to retry'; end if;
  body:=cast_discord.bot_payload(app.slug,app.site_url);
  if body is null then return 'Schedule unavailable'; end if;
  if body=app.last_payload then return 'Unchanged'; end if;
  select decrypted_secret into token from vault.decrypted_secrets where id=app.token_secret_id;
  if token is null or length(token)<20 then
    update cast_discord.apps set enabled=false,last_status='Bot token missing' where slug=p_slug;return 'Bot token missing';
  end if;
  creating:=app.message_id is null;
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS','3000');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','8000');
  begin
    select * into response from extensions.http((case when creating then 'POST' else 'PATCH' end,
      'https://discord.com/api/v10/channels/'||app.channel_id||'/messages'||case when creating then '' else '/'||app.message_id end,
      array[extensions.http_header('Authorization','Bot '||token)],'application/json',body::text)::extensions.http_request);
  exception when others then
    update cast_discord.apps set enabled=not creating,last_status=case when creating then 'Creation outcome uncertain; check Discord before retrying' else 'Network failure; will retry' end,retry_after=now()+interval '1 minute' where slug=p_slug;
    return 'Network failure';
  end;
  if response.status between 200 and 299 and (not creating or response.content::jsonb->>'id' ~ '^[0-9]{17,20}$') then
    update cast_discord.apps set message_id=coalesce(app.message_id,response.content::jsonb->>'id'),last_payload=body,last_success_at=now(),last_status='Synced',retry_after=null where slug=p_slug;
    return 'Synced';
  end if;
  update cast_discord.apps set enabled=not creating and response.status not in(401,403,404),last_status='Discord HTTP '||response.status,retry_after=now()+interval '2 minutes' where slug=p_slug;
  return 'Discord HTTP '||response.status;
end $$;

create or replace function public.cast_discord_refresh(p_application_id text,p_guild_id text,p_channel_id text)
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare slug text;
begin
  select a.slug into slug from cast_discord.apps a where a.enabled and a.application_id=p_application_id and a.guild_id=p_guild_id and a.channel_id=p_channel_id;
  if slug is null then return 'Not connected'; end if;
  return cast_discord.sync_bot(slug);
end $$;

revoke all on all functions in schema cast_discord from public,anon,authenticated;
revoke all on function public.cast_discord_interaction(jsonb),public.cast_discord_refresh(text,text,text) from public,anon,authenticated;
grant execute on function public.cast_discord_interaction(jsonb),public.cast_discord_refresh(text,text,text) to service_role;
select cron.schedule('cast-discord-voting','* * * * *',$job$select cast_discord.sync_bot(slug) from cast_discord.apps where enabled;$job$);
select cron.schedule('cast-discord-voting-cleanup','13 * * * *',$job$delete from cast_discord.panels where expires_at<now(); delete from cast_discord.interactions where created_at<now()-interval '30 days';$job$);
notify pgrst,'reload schema';
commit;
