-- Run after discord-reminder-migration.sql. Always-on card, manual repost,
-- and delete/repost immediately before the optional 30-minute ping.
begin;
alter table cast_discord.connections alter column enabled set default true;

-- A separate safety stop survives settings changes after an ambiguous POST.
alter table cast_discord.connections add column if not exists card_uncertain boolean not null default false;
update cast_discord.connections set enabled = true
where not enabled and not card_uncertain and secret_id is not null
  and (last_status is null or last_status in ('Synced', 'Card reposted', 'Reminder sent'));

create or replace function cast_discord.repost(p_slug text, p_now timestamptz default now())
returns text language plpgsql set search_path = pg_catalog, public, extensions as $$
declare c cast_discord.connections; hook text; base jsonb; r jsonb; code integer; old_id text; new_id text;
begin
  if not pg_try_advisory_xact_lock(hashtext('cast-discord'), hashtext(p_slug)) then return 'Already syncing'; end if;
  select * into c from cast_discord.connections where slug = p_slug for update;
  if not found then return 'Disabled'; end if;
  if c.card_uncertain then return 'Card outcome uncertain; check Discord'; end if;
  if not c.enabled then return 'Disabled'; end if;
  if c.retry_after > p_now then return 'Waiting to retry'; end if;
  base := cast_discord.payload(c.slug, c.site_url, p_now);
  if base is null then return 'Schedule unavailable'; end if;
  select decrypted_secret into hook from vault.decrypted_secrets where id = c.secret_id;
  if hook is null or hook !~ '^https://discord[.]com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$' then
    update cast_discord.connections set enabled = false, last_status = 'Invalid or missing webhook secret' where slug = p_slug;
    return 'Invalid or missing webhook secret';
  end if;

  -- Delete BOTH known cards when upgrading from an interrupted old repost.
  -- Never create another card until every previous card is confirmed gone.
  for old_id in select distinct id from unnest(array[c.pending_delete_id, c.message_id]) id where id is not null loop
    r := cast_discord.webhook_call(hook, 'DELETE', '/messages/' || old_id);
    code := (r ->> 'status')::integer;
    if code between 200 and 299 or code = 404 then
      update cast_discord.connections set
        message_id = case when message_id = old_id then null else message_id end,
        pending_delete_id = case when pending_delete_id = old_id then null else pending_delete_id end,
        last_payload = null where slug = p_slug;
    else
      update cast_discord.connections set last_status = 'Old card cleanup HTTP ' || code,
        retry_after = p_now + interval '2 minutes' where slug = p_slug;
      return 'Cleanup pending';
    end if;
  end loop;

  r := cast_discord.webhook_call(hook, 'POST', '?wait=true',
    base || jsonb_build_object('allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)));
  code := (r ->> 'status')::integer;
  new_id := r -> 'data' ->> 'id';
  if code between 200 and 299 and new_id ~ '^[0-9]+$' then
    update cast_discord.connections set message_id = new_id, last_payload = base,
      last_success_at = p_now, last_status = 'Card reposted', retry_after = null where slug = p_slug;
    -- A manual repost in the due window also fulfils the automatic card post.
    insert into cast_discord.reminders(slug, session_id, start_at, kind, status, message_id)
      select p_slug, coalesce(x ->> 'id', ''), (x ->> 'startAt')::timestamptz, 'card', 'sent', new_id
      from public.cast_schedules s cross join lateral jsonb_array_elements(s.state -> 'sessions') x
      where s.slug = p_slug and nullif(x ->> 'endedAt', '') is null
        and (x ->> 'startAt')::timestamptz > p_now
        and (x ->> 'startAt')::timestamptz <= p_now + interval '10 hours'
      on conflict do nothing;
    return 'Card reposted';
  elsif code = 0 or code between 200 and 299 or code >= 500 then
    -- Timeouts, missing IDs and server errors may have created a card. Pause ALL
    -- creation paths until the existing Discord message has been reconciled.
    update cast_discord.connections set enabled = false, card_uncertain = true,
      last_status = 'Card outcome uncertain; check Discord', retry_after = null where slug = p_slug;
    return 'Card outcome uncertain; check Discord';
  else
    update cast_discord.connections set last_status = 'Card HTTP ' || code,
      retry_after = p_now + interval '2 minutes' where slug = p_slug;
    return 'Card HTTP ' || code;
  end if;
end $$;

create or replace function cast_discord.remind(p_slug text, p_now timestamptz default now())
returns text language plpgsql set search_path = pg_catalog, public, extensions as $$
declare
  c cast_discord.connections; s jsonb; actors jsonb; session jsonb; hook text;
  session_start timestamptz; sid text; local_day date; body jsonb; r jsonb; code integer;
  ids text[] := '{}'; names text[] := '{}'; content text; person record; new_id text;
  rec record; stage text;
begin
  if not pg_try_advisory_xact_lock(hashtext('cast-discord'), hashtext(p_slug)) then return 'Already syncing'; end if;
  select * into c from cast_discord.connections where slug = p_slug for update;
  if not found or not c.enabled then return 'Disabled'; end if;
  if c.card_uncertain then return 'Card outcome uncertain; check Discord'; end if;
  if c.retry_after > p_now then return 'Waiting to retry'; end if;

  select decrypted_secret into hook from vault.decrypted_secrets where id = c.secret_id;
  if hook is null or hook !~ '^https://discord[.]com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$' then
    update cast_discord.connections set enabled = false, last_status = 'Invalid or missing webhook secret' where slug = p_slug;
    return 'Invalid or missing webhook secret';
  end if;

  select state into s from public.cast_schedules where slug = p_slug;
  select state -> 'actors' into actors from public.cast_public_boards where slug = p_slug and initialized;
  if s is null or actors is null then return 'Schedule unavailable'; end if;

  -- Catch up after downtime; only future, unfinished sessions qualify.
  -- Ping takes priority inside 30 minutes so one fresh card and its ping
  -- are sent together under the same lock, even if the 10-hour run was missed.
  for rec in
    select x from jsonb_array_elements(s -> 'sessions') x
    where nullif(x ->> 'endedAt', '') is null
      and (x ->> 'startAt')::timestamptz > p_now
      and (x ->> 'startAt')::timestamptz <= p_now + interval '10 hours'
    order by (x ->> 'startAt')::timestamptz
  loop
    session := rec.x;
    session_start := (session ->> 'startAt')::timestamptz;
    sid := coalesce(session ->> 'id', '');
    if c.reminder_enabled and session_start <= p_now + interval '30 minutes' and not exists (
      select 1 from cast_discord.reminders where slug = p_slug and session_id = sid
        and reminders.start_at = session_start and kind = 'ping') then
      stage := 'ping'; exit;
    elsif not exists (select 1 from cast_discord.reminders where slug = p_slug and session_id = sid
        and reminders.start_at = session_start and kind = 'card') then
      stage := 'card'; exit;
    end if;
  end loop;
  if stage is null then return 'No reminder due'; end if;

  if stage = 'card' then return cast_discord.repost(p_slug, p_now); end if;

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
    insert into cast_discord.reminders(slug, session_id, start_at, kind, status) values (p_slug, sid, session_start, 'ping', 'skipped');
    if not exists (select 1 from cast_discord.reminders where slug = p_slug and session_id = sid
      and start_at = session_start and kind = 'card') then
      return cast_discord.repost(p_slug, p_now);
    end if;
    return 'Nobody to remind';
  end if;

  content := format('⏰ Danganronpa starts <t:%s:R>', extract(epoch from session_start)::bigint);
  if cardinality(ids) > 0 then
    content := content || E'\n' || (select string_agg('<@' || i || '>', ' ') from unnest(ids) i);
  end if;
  if cardinality(names) > 0 then content := content || E'\nAlso playing: ' || left(array_to_string(names, ', '), 400); end if;
  -- Only the listed users can be pinged. Everyone/role pings stay impossible.
  body := jsonb_build_object('content', content,
    'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb, 'users', to_jsonb(ids)));

  -- Keep the ping directly below the fresh card. If deletion or creation fails,
  -- no ping is sent. All paths share the same advisory/row lock.
  content := cast_discord.repost(p_slug, p_now);
  if content <> 'Card reposted' then return content; end if;

  r := cast_discord.webhook_call(hook, 'POST', '?wait=true', body);
  code := (r ->> 'status')::integer;
  if code between 200 and 299 then
    new_id := r -> 'data' ->> 'id';
    insert into cast_discord.reminders(slug, session_id, start_at, kind, status, message_id) values (p_slug, sid, session_start, 'ping', 'sent', new_id);
    update cast_discord.connections set last_success_at = p_now, last_status = 'Reminder sent', retry_after = null where slug = p_slug;
    return 'Reminder sent';
  elsif code = 0 or code >= 500 then
    -- Unknown outcome: Discord may have delivered it. Do not retry and risk a second ping.
    insert into cast_discord.reminders(slug, session_id, start_at, kind, status) values (p_slug, sid, session_start, 'ping', 'uncertain');
    update cast_discord.connections set last_status = 'Reminder outcome uncertain; check Discord' where slug = p_slug;
    return 'Reminder uncertain';
  else
    update cast_discord.connections set last_status = 'Reminder HTTP ' || code,
      retry_after = p_now + interval '2 minutes' where slug = p_slug;
    return 'Reminder HTTP ' || code;
  end if;
end $$;


create or replace function cast_discord.sync(p_slug text)
returns text language plpgsql set search_path=pg_catalog,public,extensions as $$
declare c cast_discord.connections; hook text; body jsonb; response extensions.http_response; creating boolean;
begin
  if not pg_try_advisory_xact_lock(hashtext('cast-discord'),hashtext(p_slug)) then return 'Already syncing'; end if;
  select * into c from cast_discord.connections where slug=p_slug for update;
  if not found or not c.enabled then return 'Disabled'; end if;
  if c.card_uncertain then return 'Card outcome uncertain; check Discord'; end if;
  if c.retry_after>now() then return 'Waiting to retry'; end if;
  if c.message_id is null or c.pending_delete_id is not null then return cast_discord.repost(p_slug); end if;
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

-- Keep the old settings signature for cached clients, but p_card no longer
-- switches card delivery off or bypasses a safety pause.
create or replace function public.cast_get_discord_settings(p_slug text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare c cast_discord.connections;
begin
  if not public.cast_is_host(p_slug) then raise exception 'Host access required.'; end if;
  select * into c from cast_discord.connections where slug = p_slug;
  return jsonb_build_object('configured', found and c.secret_id is not null,
    'card', coalesce(c.enabled and not c.card_uncertain, false),
    'reminder', coalesce(c.reminder_enabled, false), 'repost_supported', true, 'status', c.last_status);
end $$;

create or replace function public.cast_set_discord_settings(p_slug text, p_card boolean, p_reminder boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not public.cast_is_host(p_slug) then raise exception 'Host access required.'; end if;
  if p_reminder is null then raise exception 'Choose on or off.'; end if;
  if not exists (select 1 from cast_discord.connections where slug = p_slug and secret_id is not null) then
    raise exception 'Discord is not connected yet.';
  end if;
  update cast_discord.connections set reminder_enabled = p_reminder where slug = p_slug;
  return public.cast_get_discord_settings(p_slug);
end $$;

create or replace function public.cast_repost_discord_card(p_slug text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result text;
begin
  if not public.cast_is_host(p_slug) then raise exception 'Host access required.'; end if;
  result := cast_discord.repost(p_slug);
  -- Do not raise after HTTP calls: database state must survive partial success.
  return jsonb_build_object('ok', result = 'Card reposted', 'status', result);
end $$;

revoke all on all functions in schema cast_discord from public, anon, authenticated;
revoke all on function public.cast_get_discord_settings(text), public.cast_set_discord_settings(text, boolean, boolean),
  public.cast_repost_discord_card(text) from public, anon, authenticated;
grant execute on function public.cast_get_discord_settings(text), public.cast_set_discord_settings(text, boolean, boolean),
  public.cast_repost_discord_card(text) to authenticated;

-- Card delivery runs whether or not the host has enabled the ping.
select cron.schedule('cast-discord-reminder', '* * * * *',
  $job$select cast_discord.remind(slug) from cast_discord.connections where enabled;$job$);
notify pgrst, 'reload schema';
commit;
