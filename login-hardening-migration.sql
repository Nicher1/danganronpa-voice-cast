-- login-hardening-migration.sql
-- 1. cast_register_actor may only register brand-new actor ids (stops actor takeover).
-- 2. Host and actor logins lock for 15 minutes after 10 failed attempts.
-- 3. New password hashes use bcrypt cost 10 (was 6); legacy sha256 hashes upgrade on login.
--    (cast_register_actor, cast_set_actor_password and cast_initialize_board.)
-- Wrong passwords now return false instead of raising, so the failed attempt is saved.
-- The client (supabase-sync.js) must already throw on a false result before you run this.
-- Safe to run more than once.

begin;

create table if not exists public.cast_login_failures (
  board_slug text not null,
  target text not null,
  user_id uuid not null,
  failed_at timestamptz not null default now()
);
create index if not exists cast_login_failures_recent
  on public.cast_login_failures (board_slug, target, failed_at);
alter table public.cast_login_failures enable row level security;
revoke all on public.cast_login_failures from public, anon, authenticated;

create or replace function public.cast_check_login_lockout(p_slug text, p_target text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.cast_login_failures
      where board_slug = p_slug and target = p_target
        and failed_at > now() - interval '15 minutes') >= 10 then
    raise exception 'Too many failed attempts. Try again in 15 minutes.';
  end if;
end;
$$;

create or replace function public.cast_record_login_failure(p_slug text, p_target text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.cast_login_failures where failed_at < now() - interval '1 day';
  insert into public.cast_login_failures (board_slug, target, user_id)
  values (p_slug, p_target, auth.uid());
end;
$$;

revoke all on function public.cast_check_login_lockout(text, text) from public, anon, authenticated;
revoke all on function public.cast_record_login_failure(text, text) from public, anon, authenticated;

create or replace function public.cast_login_host(p_slug text, p_password text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  stored_hash text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  perform public.cast_check_login_lockout(p_slug, 'host');
  select host_password_hash into stored_hash
  from public.cast_board_secrets where board_slug = p_slug;
  if stored_hash is null or extensions.crypt(coalesce(p_password, ''), stored_hash) <> stored_hash then
    perform public.cast_record_login_failure(p_slug, 'host');
    return false;
  end if;
  insert into public.cast_host_sessions (board_slug, user_id)
  values (p_slug, auth.uid()) on conflict do nothing;
  return true;
end;
$$;

create or replace function public.cast_claim_actor(p_slug text, p_actor_id text, p_password text default '')
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  board_state jsonb;
  stored_hash text;
  stored_scheme text;
  password_ok boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select state into board_state from public.cast_boards where slug = p_slug and initialized;
  if board_state is null or not exists (
    select 1
    from jsonb_array_elements(coalesce(board_state -> 'actors', '[]'::jsonb)) as item(actor)
    where item.actor ->> 'id' = p_actor_id
  ) then raise exception 'Actor not found'; end if;

  select password_hash, scheme into stored_hash, stored_scheme
  from public.cast_actor_passwords
  where board_slug = p_slug and actor_id = p_actor_id;

  if stored_hash is not null then
    perform public.cast_check_login_lockout(p_slug, 'actor:' || p_actor_id);
    password_ok := case stored_scheme
      when 'sha256' then encode(extensions.digest(coalesce(p_password, ''), 'sha256'), 'hex') = stored_hash
      else extensions.crypt(coalesce(p_password, ''), stored_hash) = stored_hash
    end;
    if not password_ok then
      perform public.cast_record_login_failure(p_slug, 'actor:' || p_actor_id);
      return false;
    end if;
    if stored_scheme = 'sha256' then
      update public.cast_actor_passwords
      set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), scheme = 'bcrypt'
      where board_slug = p_slug and actor_id = p_actor_id;
    end if;
  end if;

  insert into public.cast_actor_sessions (board_slug, actor_id, user_id)
  values (p_slug, p_actor_id, auth.uid()) on conflict do nothing;
  return true;
end;
$$;

create or replace function public.cast_register_actor(p_slug text, p_actor_id text, p_password text default '')
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce(p_actor_id, '') = '' then raise exception 'Actor id is required'; end if;
  if not exists (select 1 from public.cast_boards where slug = p_slug and initialized) then
    raise exception 'Shared board is not initialized';
  end if;
  -- Only brand-new ids may be registered. Existing actors must log in with cast_claim_actor.
  if exists (
       select 1
       from public.cast_boards b
       cross join lateral jsonb_array_elements(coalesce(b.state -> 'actors', '[]'::jsonb)) as item(actor)
       where b.slug = p_slug and item.actor ->> 'id' = p_actor_id
     )
     or exists (select 1 from public.cast_actor_passwords
                where board_slug = p_slug and actor_id = p_actor_id)
     or exists (select 1 from public.cast_actor_sessions
                where board_slug = p_slug and actor_id = p_actor_id and user_id <> auth.uid())
  then
    raise exception 'Actor already exists';
  end if;

  if coalesce(p_password, '') <> '' then
    insert into public.cast_actor_passwords (board_slug, actor_id, password_hash, scheme)
    values (p_slug, p_actor_id, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), 'bcrypt');
  end if;

  insert into public.cast_actor_sessions (board_slug, actor_id, user_id)
  values (p_slug, p_actor_id, auth.uid()) on conflict do nothing;
  return true;
end;
$$;

create or replace function public.cast_initialize_board(
  p_slug text,
  p_setup_code text,
  p_host_password text,
  p_initial_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  board_row public.cast_boards%rowtype;
  secret_row public.cast_board_secrets%rowtype;
  clean_state jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(coalesce(p_host_password, '')) < 6 then
    raise exception 'Host password must contain at least 6 characters';
  end if;

  select * into board_row from public.cast_boards where slug = p_slug for update;
  if not found then raise exception 'Shared board is not configured'; end if;
  if board_row.initialized then raise exception 'Shared board is already initialized'; end if;

  select * into secret_row from public.cast_board_secrets where board_slug = p_slug for update;
  if secret_row.setup_code_hash is null or
     encode(extensions.digest(coalesce(p_setup_code, ''), 'sha256'), 'hex') <> secret_row.setup_code_hash then
    raise exception 'Incorrect one-time setup code';
  end if;

  insert into public.cast_actor_passwords (board_slug, actor_id, password_hash, scheme)
  select p_slug, item.actor ->> 'id', item.actor ->> 'passwordHash', 'sha256'
  from jsonb_array_elements(coalesce(p_initial_state -> 'actors', '[]'::jsonb)) as item(actor)
  where coalesce(item.actor ->> 'id', '') <> ''
    and coalesce(item.actor ->> 'passwordHash', '') <> ''
  on conflict (board_slug, actor_id) do update
    set password_hash = excluded.password_hash, scheme = excluded.scheme;

  clean_state := public.cast_state_with_password_flags(p_slug, p_initial_state);

  update public.cast_boards
  set state = clean_state,
      initialized = true,
      revision = revision + 1,
      updated_at = now()
  where slug = p_slug
  returning * into board_row;

  update public.cast_public_boards
  set state = public.cast_state_for_public(board_row.state),
      initialized = true,
      revision = board_row.revision,
      updated_at = board_row.updated_at
  where slug = p_slug;

  update public.cast_board_secrets
  set setup_code_hash = null,
      host_password_hash = extensions.crypt(p_host_password, extensions.gen_salt('bf', 10))
  where board_slug = p_slug;

  insert into public.cast_host_sessions (board_slug, user_id)
  values (p_slug, auth.uid())
  on conflict do nothing;

  return jsonb_build_object('state', board_row.state, 'revision', board_row.revision);
end;
$$;

create or replace function public.cast_set_actor_password(p_slug text, p_actor_id text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  allowed boolean;
  is_host boolean;
  board_row public.cast_boards%rowtype;
  public_state jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  is_host := public.cast_is_host(p_slug);
  allowed := is_host or exists (
    select 1 from public.cast_actor_sessions cas
    where cas.board_slug = p_slug and cas.actor_id = p_actor_id and cas.user_id = auth.uid()
  );
  if not allowed then raise exception 'You do not control this actor'; end if;

  if coalesce(p_password, '') = '' then
    delete from public.cast_actor_passwords where board_slug = p_slug and actor_id = p_actor_id;
  else
    insert into public.cast_actor_passwords (board_slug, actor_id, password_hash, scheme)
    values (p_slug, p_actor_id, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), 'bcrypt')
    on conflict (board_slug, actor_id) do update
      set password_hash = excluded.password_hash, scheme = excluded.scheme;
  end if;

  update public.cast_boards
  set state = public.cast_state_with_password_flags(p_slug, state),
      revision = revision + 1,
      updated_at = now()
  where slug = p_slug
  returning * into board_row;

  public_state := public.cast_state_for_public(board_row.state);
  update public.cast_public_boards
  set state = public_state,
      revision = board_row.revision,
      initialized = board_row.initialized,
      updated_at = board_row.updated_at
  where slug = p_slug;

  return jsonb_build_object(
    'state', case when is_host then board_row.state else public_state end,
    'revision', board_row.revision
  );
end;
$$;

revoke all on function public.cast_login_host(text, text) from public, anon, authenticated;
revoke all on function public.cast_claim_actor(text, text, text) from public, anon, authenticated;
revoke all on function public.cast_register_actor(text, text, text) from public, anon, authenticated;
revoke all on function public.cast_initialize_board(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.cast_set_actor_password(text, text, text) from public, anon, authenticated;
grant execute on function public.cast_login_host(text, text) to authenticated;
grant execute on function public.cast_claim_actor(text, text, text) to authenticated;
grant execute on function public.cast_register_actor(text, text, text) to authenticated;
grant execute on function public.cast_initialize_board(text, text, text, jsonb) to authenticated;
grant execute on function public.cast_set_actor_password(text, text, text) to authenticated;

commit;
