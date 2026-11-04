-- 30-minute session reminder (webhook only, no bot). Run AFTER discord-schedule-migration.sql
-- and discord-actor-links-migration.sql. Nothing is sent until a connection is enabled.
--
-- Once per session start time, 30 minutes before the start, this posts ONE fresh schedule card
-- whose text pings only the players who voted "available" for that day AND have a linked Discord
-- ID. The previous card is then deleted, so the card ends up at the bottom of the channel.
-- Webhooks cannot pin messages; pinning would need a bot.
begin;
alter table cast_discord.connections add column if not exists pending_delete_id text;

create table if not exists cast_discord.reminders (
  slug text not null references cast_discord.connections(slug) on delete cascade,
  session_id text not null,
  start_at timestamptz not null,
  -- sent: posted. uncertain: the POST may have reached Discord, so it is never retried (no double ping).
  -- skipped: nobody had said they could play.
  status text not null check (status in ('sent','uncertain','skipped')),
  message_id text,
  recorded_at timestamptz not null default now(),
  primary key (slug, session_id, start_at)
);
revoke all on cast_discord.reminders from public, anon, authenticated;
alter table cast_discord.reminders enable row level security;

-- Returns {status, content}. Never returns the secret-bearing URL or raw error text.
create or replace function cast_discord.webhook_call(p_hook text, p_method text, p_suffix text, p_body jsonb default null)
returns jsonb language plpgsql set search_path = pg_catalog, public, extensions as $$
declare r extensions.http_response; data jsonb;
begin
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '3000');
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '8000');
  select * into r from extensions.http((p_method::extensions.http_method, p_hook || p_suffix,
    array[extensions.http_header('Content-Type', 'application/json')], 'application/json',
    p_body::text)::extensions.http_request);
  begin data := nullif(r.content, '')::jsonb; exception when others then data := null; end;
  return jsonb_build_object('status', r.status, 'data', data);
exception when others then
  return jsonb_build_object('status', 0);
end $$;

create or replace function cast_discord.remind(p_slug text, p_now timestamptz default now())
returns text language plpgsql set search_path = pg_catalog, public, extensions as $$
declare
  c cast_discord.connections; s jsonb; actors jsonb; session jsonb; hook text;
  session_start timestamptz; sid text; local_day date; base jsonb; body jsonb; r jsonb; code integer;
  ids text[] := '{}'; names text[] := '{}'; content text; person record; new_id text;
begin
  if not pg_try_advisory_xact_lock(hashtext('cast-discord'), hashtext(p_slug)) then return 'Already syncing'; end if;
  select * into c from cast_discord.connections where slug = p_slug for update;
  if not found or not c.enabled then return 'Disabled'; end if;
  if c.retry_after > p_now then return 'Waiting to retry'; end if;

  select decrypted_secret into hook from vault.decrypted_secrets where id = c.secret_id;
  if hook is null or hook !~ '^https://discord[.]com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$' then
    update cast_discord.connections set enabled = false, last_status = 'Invalid or missing webhook secret' where slug = p_slug;
    return 'Invalid or missing webhook secret';
  end if;

  -- Finish deleting the previous card first. A 404 means it is already gone.
  if c.pending_delete_id is not null then
    r := cast_discord.webhook_call(hook, 'DELETE', '/messages/' || c.pending_delete_id);
    code := (r ->> 'status')::integer;
    if code between 200 and 299 or code = 404 then
      update cast_discord.connections set pending_delete_id = null where slug = p_slug;
      c.pending_delete_id := null;
    else
      update cast_discord.connections set last_status = 'Old card cleanup HTTP ' || code,
        retry_after = p_now + interval '2 minutes' where slug = p_slug;
      return 'Cleanup pending';
    end if;
  end if;

  select state into s from public.cast_schedules where slug = p_slug;
  select state -> 'actors' into actors from public.cast_public_boards where slug = p_slug and initialized;
  if s is null or actors is null then return 'Schedule unavailable'; end if;

  -- Only a session that has not started, and starts within 30 minutes. A late-created or
  -- rescheduled session inside the window gets one reminder immediately; a missed window gets none.
  select x into session from jsonb_array_elements(s -> 'sessions') x
    where nullif(x ->> 'endedAt', '') is null
      and (x ->> 'startAt')::timestamptz > p_now
      and (x ->> 'startAt')::timestamptz <= p_now + interval '30 minutes'
    order by (x ->> 'startAt')::timestamptz limit 1;
  if session is null then return 'No reminder due'; end if;
  session_start := (session ->> 'startAt')::timestamptz;
  sid := coalesce(session ->> 'id', '');
  if exists (select 1 from cast_discord.reminders where slug = p_slug and session_id = sid and reminders.start_at = session_start) then
    return 'Already reminded';
  end if;

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

  if cardinality(ids) + cardinality(names) = 0 then
    insert into cast_discord.reminders(slug, session_id, start_at, status) values (p_slug, sid, session_start, 'skipped');
    return 'Nobody to remind';
  end if;

  base := cast_discord.payload(c.slug, c.site_url, p_now);
  if base is null then return 'Schedule unavailable'; end if;
  content := format('⏰ Danganronpa starts <t:%s:R>', extract(epoch from session_start)::bigint);
  if cardinality(ids) > 0 then
    content := content || E'\n' || (select string_agg('<@' || i || '>', ' ') from unnest(ids) i);
  end if;
  if cardinality(names) > 0 then content := content || E'\nAlso playing: ' || left(array_to_string(names, ', '), 400); end if;
  -- Only the listed users can be pinged. Everyone/role pings stay impossible.
  body := base || jsonb_build_object('content', content,
    'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', to_jsonb(ids)));

  r := cast_discord.webhook_call(hook, 'POST', '?wait=true', body);
  code := (r ->> 'status')::integer;
  if code between 200 and 299 then
    new_id := r -> 'data' ->> 'id';
    insert into cast_discord.reminders(slug, session_id, start_at, status, message_id) values (p_slug, sid, session_start, 'sent', new_id);
    update cast_discord.connections set message_id = coalesce(new_id, message_id), last_payload = base,
      last_success_at = p_now, last_status = 'Reminder sent', retry_after = null,
      pending_delete_id = case when c.message_id is distinct from new_id then c.message_id end
      where slug = p_slug;
    if c.message_id is not null and c.message_id is distinct from new_id then
      r := cast_discord.webhook_call(hook, 'DELETE', '/messages/' || c.message_id);
      code := (r ->> 'status')::integer;
      if code between 200 and 299 or code = 404 then
        update cast_discord.connections set pending_delete_id = null where slug = p_slug;
      end if;
    end if;
    return 'Reminder sent';
  elsif code = 0 then
    -- Unknown outcome: Discord may have delivered it. Do not retry and risk a second ping.
    insert into cast_discord.reminders(slug, session_id, start_at, status) values (p_slug, sid, session_start, 'uncertain');
    update cast_discord.connections set last_status = 'Reminder outcome uncertain; check Discord' where slug = p_slug;
    return 'Reminder uncertain';
  else
    update cast_discord.connections set last_status = 'Reminder HTTP ' || code,
      retry_after = p_now + interval '2 minutes' where slug = p_slug;
    return 'Reminder HTTP ' || code;
  end if;
end $$;

revoke all on all functions in schema cast_discord from public, anon, authenticated;
-- Every minute; it does nothing unless a session starts within the next 30 minutes.
select cron.schedule('cast-discord-reminder', '* * * * *',
  $job$select cast_discord.remind(slug) from cast_discord.connections where enabled;$job$);
commit;
