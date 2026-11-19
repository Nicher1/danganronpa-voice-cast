-- Danganronpa Voice Cast shared-state backend.
-- Run this once in the Supabase SQL editor for project srdyjehnvsmscmeuhcvh.
-- The one-time setup code itself is intentionally not stored in this repository.

begin;

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.cast_boards (
  slug text primary key,
  state jsonb,
  revision bigint not null default 0,
  initialized boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.cast_public_boards (
  slug text primary key references public.cast_boards(slug) on delete cascade,
  state jsonb,
  revision bigint not null default 0,
  initialized boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.cast_board_secrets (
  board_slug text primary key references public.cast_boards(slug) on delete cascade,
  setup_code_hash text,
  host_password_hash text
);

create table if not exists public.cast_host_sessions (
  board_slug text not null references public.cast_boards(slug) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (board_slug, user_id)
);

create table if not exists public.cast_actor_passwords (
  board_slug text not null references public.cast_boards(slug) on delete cascade,
  actor_id text not null,
  password_hash text not null,
  scheme text not null default 'bcrypt' check (scheme in ('bcrypt', 'sha256')),
  primary key (board_slug, actor_id)
);

create table if not exists public.cast_actor_sessions (
  board_slug text not null references public.cast_boards(slug) on delete cascade,
  actor_id text not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (board_slug, actor_id, user_id)
);

create table if not exists public.cast_presence_sessions (
  board_slug text not null references public.cast_boards(slug) on delete cascade,
  session_id text not null,
  actor_id text not null,
  user_id uuid not null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (board_slug, session_id)
);

create index if not exists cast_presence_sessions_recent_idx
on public.cast_presence_sessions (board_slug, started_at desc);

create table if not exists public.cast_login_failures (
  board_slug text not null,
  target text not null,
  user_id uuid not null,
  failed_at timestamptz not null default now()
);
create index if not exists cast_login_failures_recent
  on public.cast_login_failures (board_slug, target, failed_at);

insert into public.cast_boards (slug)
values ('danganronpa-main')
on conflict (slug) do nothing;

insert into public.cast_public_boards (slug)
values ('danganronpa-main')
on conflict (slug) do nothing;

insert into public.cast_board_secrets (board_slug, setup_code_hash)
values ('danganronpa-main', '0619c1d87f7d99024c714ec8daf4651f8594dbec4ef2b85ee0271323f47b4097')
on conflict (board_slug) do nothing;

alter table public.cast_boards enable row level security;
alter table public.cast_public_boards enable row level security;
alter table public.cast_board_secrets enable row level security;
alter table public.cast_host_sessions enable row level security;
alter table public.cast_actor_passwords enable row level security;
alter table public.cast_actor_sessions enable row level security;
alter table public.cast_presence_sessions enable row level security;
alter table public.cast_login_failures enable row level security;

drop policy if exists "cast public boards are readable" on public.cast_public_boards;
create policy "cast public boards are readable"
on public.cast_public_boards for select
to anon, authenticated
using (true);

grant select on public.cast_boards to authenticated;
grant select on public.cast_public_boards to anon, authenticated;
revoke all on public.cast_board_secrets from anon, authenticated;
revoke all on public.cast_host_sessions from anon, authenticated;
revoke all on public.cast_actor_passwords from anon, authenticated;
revoke all on public.cast_actor_sessions from anon, authenticated;
revoke all on public.cast_presence_sessions from anon, authenticated;
revoke all on public.cast_login_failures from anon, authenticated;

create or replace function public.cast_state_with_password_flags(p_slug text, p_state jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_set(
    coalesce(p_state, '{}'::jsonb),
    '{actors}',
    coalesce(
      (
        select jsonb_agg(
          (item.actor - 'passwordHash' - 'hasPassword') ||
          jsonb_build_object(
            'hasPassword',
            exists (
              select 1
              from public.cast_actor_passwords cap
              where cap.board_slug = p_slug
                and cap.actor_id = item.actor ->> 'id'
            )
          )
          order by item.ordinality
        )
        from jsonb_array_elements(coalesce(p_state -> 'actors', '[]'::jsonb))
          with ordinality as item(actor, ordinality)
      ),
      '[]'::jsonb
    ),
    true
  );
$$;

create or replace function public.cast_state_for_public(p_state jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_set(
    coalesce(p_state, '{}'::jsonb) - 'secretSettings',
    '{roles}',
    coalesce(
      (
        select jsonb_agg(item.role order by item.ordinality)
        from jsonb_array_elements(coalesce(p_state -> 'roles', '[]'::jsonb))
          with ordinality as item(role, ordinality)
        where not (
          coalesce((item.role ->> 'hiddenSpoiler')::boolean, false)
          and not coalesce((item.role ->> 'revealed')::boolean, false)
        )
      ),
      '[]'::jsonb
    ),
    true
  );
$$;

create or replace function public.cast_is_host(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.cast_host_sessions chs
    where chs.board_slug = p_slug and chs.user_id = auth.uid()
  );
$$;

create or replace function public.cast_controls_actor(p_slug text, p_actor_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.cast_is_host(p_slug) or (
    auth.uid() is not null and exists (
      select 1 from public.cast_actor_sessions cas
      where cas.board_slug = p_slug
        and cas.actor_id = p_actor_id
        and cas.user_id = auth.uid()
    )
  );
$$;

create or replace function public.cast_keep_alive(p_slug text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.cast_is_host(p_slug) then raise exception 'Host access required'; end if;
  if not exists (select 1 from public.cast_boards where slug = p_slug and initialized) then
    raise exception 'Shared board is not initialized';
  end if;
  return clock_timestamp();
end;
$$;

create or replace function public.cast_presence_start(
  p_slug text,
  p_actor_id text,
  p_session_id text
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  started timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if coalesce(p_session_id, '') = '' then raise exception 'Session id is required'; end if;
  if not public.cast_controls_actor(p_slug, p_actor_id) then
    raise exception 'You do not control this actor';
  end if;

  delete from public.cast_presence_sessions
  where board_slug = p_slug and last_seen_at < now() - interval '30 days';

  insert into public.cast_presence_sessions (
    board_slug, session_id, actor_id, user_id, started_at, last_seen_at, ended_at
  ) values (
    p_slug, p_session_id, p_actor_id, auth.uid(), now(), now(), null
  )
  on conflict (board_slug, session_id) do update
  set last_seen_at = now(), ended_at = null
  where cast_presence_sessions.actor_id = excluded.actor_id
    and cast_presence_sessions.user_id = excluded.user_id
  returning started_at into started;

  if started is null then raise exception 'Presence session conflict'; end if;
  return started;
end;
$$;

create or replace function public.cast_presence_touch(
  p_slug text,
  p_actor_id text,
  p_session_id text,
  p_ended boolean default false
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  touched timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;

  update public.cast_presence_sessions
  set last_seen_at = now(),
      ended_at = case when p_ended then now() else ended_at end
  where board_slug = p_slug
    and session_id = p_session_id
    and actor_id = p_actor_id
    and user_id = auth.uid()
  returning last_seen_at into touched;

  if touched is null then raise exception 'Presence session not found'; end if;
  return touched;
end;
$$;

create or replace function public.cast_presence_activity(p_slug text, p_days integer default 7)
returns table (
  session_id text,
  actor_id text,
  started_at timestamptz,
  last_seen_at timestamptz,
  ended_at timestamptz,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.cast_is_host(p_slug) then raise exception 'Host access required'; end if;

  return query
  select
    cps.session_id,
    cps.actor_id,
    cps.started_at,
    cps.last_seen_at,
    cps.ended_at,
    cps.ended_at is null and cps.last_seen_at > now() - interval '90 seconds'
  from public.cast_presence_sessions cps
  where cps.board_slug = p_slug
    and cps.started_at >= now() - least(greatest(coalesce(p_days, 7), 1), 14) * interval '1 day'
  order by cps.started_at desc;
end;
$$;

drop policy if exists "cast board hosts can read full state" on public.cast_boards;
create policy "cast board hosts can read full state"
on public.cast_boards for select
to authenticated
using (public.cast_is_host(slug));

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

create or replace function public.cast_save_board(p_slug text, p_state jsonb, p_expected_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed boolean;
  is_host boolean;
  board_row public.cast_boards%rowtype;
  merged_state jsonb;
  merged_predictions jsonb;
  current_game text;
  current_chapter_number text;
  current_chapter text;
  trial_ongoing boolean;
  chapter_result jsonb;
  incoming_prediction record;
  incoming_entry jsonb;
  existing_entry jsonb;
  merged_entry jsonb;
  public_state jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  is_host := public.cast_is_host(p_slug);
  allowed := is_host or exists (
    select 1 from public.cast_actor_sessions cas
    where cas.board_slug = p_slug and cas.user_id = auth.uid()
  );
  if not allowed then raise exception 'Log in as the host or an actor before editing'; end if;

  select * into board_row
  from public.cast_boards
  where slug = p_slug and initialized
  for update;

  if not found or board_row.revision <> p_expected_revision then
    raise exception 'REVISION_CONFLICT';
  end if;

  if is_host then
    merged_state := p_state;
  else
    merged_predictions := coalesce(board_row.state -> 'predictions', '{}'::jsonb);
    current_game := coalesce(p_state ->> 'clientGameId', 'dr1');
    -- Any game on the board is valid (DR 2x2 and Slayhem were missing from the old fixed list).
    if board_row.state #> array['settings', 'games', current_game] is null then current_game := 'dr1'; end if;
    current_chapter_number := coalesce(
      board_row.state #>> array['settings', 'games', current_game, 'voiceChapter'],
      board_row.state #>> '{settings,voiceChapter}',
      '1'
    );
    current_chapter := case
      when board_row.state #> '{settings,games}' is null then current_chapter_number
      else current_game || ':' || current_chapter_number
    end;
    trial_ongoing := coalesce(
      (board_row.state #>> array['settings', 'games', current_game, 'trialEnteredByChapter', current_chapter_number])::boolean,
      (board_row.state #>> array['settings', 'games', current_game, 'trialByChapter', current_chapter_number])::boolean,
      (board_row.state #>> array['settings', 'games', current_game, 'voiceInTrial'])::boolean,
      (board_row.state #>> array['settings', 'trialEnteredByChapter', current_chapter])::boolean,
      (board_row.state #>> array['settings', 'trialByChapter', current_chapter])::boolean,
      (board_row.state #>> '{settings,voiceInTrial}')::boolean,
      false
    );
    chapter_result := coalesce(board_row.state -> 'chapterResults' -> current_chapter, '{}'::jsonb);

    for incoming_prediction in
      select item.key, item.value
      from jsonb_each(coalesce(p_state -> 'predictions', '{}'::jsonb)) as item(key, value)
      where exists (
        select 1
        from public.cast_actor_sessions cas
        where cas.board_slug = p_slug
          and cas.actor_id = item.key
          and cas.user_id = auth.uid()
      )
    loop
      incoming_entry := incoming_prediction.value -> current_chapter;
      existing_entry := coalesce(merged_predictions -> incoming_prediction.key -> current_chapter, '{}'::jsonb);

      -- Only the current chapter may be edited, and never after its snapshot was
      -- locked. A resolved token is frozen even before the Trial begins.
      if incoming_entry is not null
         and not trial_ongoing
         and not coalesce((existing_entry ->> 'locked')::boolean, false) then
        merged_entry := jsonb_build_object(
          'victimRoleId', case
            when coalesce(chapter_result ->> 'victimRoleId', '') <> '' then coalesce(existing_entry ->> 'victimRoleId', '')
            else coalesce(incoming_entry ->> 'victimRoleId', '')
          end,
          'blackenedRoleId', case
            when coalesce(chapter_result ->> 'blackenedRoleId', '') <> '' then coalesce(existing_entry ->> 'blackenedRoleId', '')
            else coalesce(incoming_entry ->> 'blackenedRoleId', '')
          end,
          'mastermindRoleId', case
            when coalesce(chapter_result ->> 'mastermindRoleId', '') <> '' then coalesce(existing_entry ->> 'mastermindRoleId', '')
            else coalesce(incoming_entry ->> 'mastermindRoleId', '')
          end,
          'locked', false
        );
        merged_predictions := jsonb_set(
          merged_predictions,
          array[incoming_prediction.key],
          coalesce(merged_predictions -> incoming_prediction.key, '{}'::jsonb) || jsonb_build_object(current_chapter, merged_entry),
          true
        );
      end if;
    end loop;

    -- Start from the stored board. Only what the app lets a player change is copied from p_state.
    merged_state := public.cast_merge_player_save(p_slug, board_row.state, p_state);
    merged_state := jsonb_set(merged_state, '{predictions}', merged_predictions, true);
    if octet_length(merged_state::text) > 5000000
       and octet_length(merged_state::text) > octet_length(coalesce(board_row.state, '{}'::jsonb)::text) then
      raise exception 'The board is too large to save';
    end if;
  end if;

  merged_state := public.cast_state_with_password_flags(p_slug, merged_state - 'clientGameId');

  update public.cast_boards
  set state = merged_state,
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

create or replace function public.cast_merge_player_save(p_slug text, p_server jsonb, p_incoming jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
-- A player save starts from the stored board. Only the changes the app lets a player make are
-- copied from the incoming state: their own actor, claiming or releasing characters for their
-- own actor, and their own practice recordings. Predictions are merged by cast_save_board.
declare
  my_actor_ids text[];
  server_roles jsonb := coalesce(p_server -> 'roles', '[]'::jsonb);
  server_actors jsonb := coalesce(p_server -> 'actors', '[]'::jsonb);
  incoming_roles jsonb := case when jsonb_typeof(p_incoming -> 'roles') = 'array' then p_incoming -> 'roles' else '[]'::jsonb end;
  incoming_actors jsonb := case when jsonb_typeof(p_incoming -> 'actors') = 'array' then p_incoming -> 'actors' else '[]'::jsonb end;
  merged_roles jsonb := '[]'::jsonb;
  merged_actors jsonb := '[]'::jsonb;
  spent_tokens text[] := '{}';
  role_item jsonb;
  role_index bigint;
  incoming_role jsonb;
  actor_item jsonb;
  incoming_actor jsonb;
  old_owner text;
  new_owner text;
  game_id text;
  game_settings jsonb;
  game_active boolean;
  old_actor jsonb;
  new_actor jsonb;
  move_allowed boolean;
  max_per_actor integer;
  owned_count integer;
  own_entries jsonb;
  field_name text;
begin
  select coalesce(array_agg(cas.actor_id), '{}') into my_actor_ids
  from public.cast_actor_sessions cas
  where cas.board_slug = p_slug and cas.user_id = auth.uid();

  for role_item, role_index in
    select item.value, item.ordinality from jsonb_array_elements(server_roles) with ordinality as item(value, ordinality)
  loop
    select item.value into incoming_role
    from jsonb_array_elements(incoming_roles) as item(value)
    where jsonb_typeof(item.value) = 'object' and item.value ->> 'id' = role_item ->> 'id'
    limit 1;

    -- Missing roles are never deleted, and unrevealed spoiler roles are host-only.
    if incoming_role is null or (
      coalesce((role_item ->> 'hiddenSpoiler')::boolean, false)
      and not coalesce((role_item ->> 'revealed')::boolean, false)
    ) then
      merged_roles := merged_roles || jsonb_build_array(role_item);
      continue;
    end if;

    -- Practice data: keep other actors' entries, take this player's entries from the save.
    foreach field_name in array array['personalRecordings', 'practiceLineHistory'] loop
      own_entries := coalesce((
        select jsonb_agg(own.value order by own.ordinality)
        from (
          select item.value, item.ordinality
          from jsonb_array_elements(case when jsonb_typeof(incoming_role -> field_name) = 'array' then incoming_role -> field_name else '[]'::jsonb end)
            with ordinality as item(value, ordinality)
          where jsonb_typeof(item.value) = 'object' and item.value ->> 'actorId' = any(my_actor_ids)
            and length(item.value::text) <= 4000
          order by item.ordinality
          limit case field_name when 'personalRecordings' then 20 else 500 end
        ) as own
      ), '[]'::jsonb);
      role_item := jsonb_set(role_item, array[field_name], coalesce((
        select jsonb_agg(item.value order by item.ordinality)
        from jsonb_array_elements(case when jsonb_typeof(role_item -> field_name) = 'array' then role_item -> field_name else '[]'::jsonb end)
          with ordinality as item(value, ordinality)
        where not coalesce(item.value ->> 'actorId' = any(my_actor_ids), false)
      ), '[]'::jsonb) || own_entries, true);
    end loop;

    -- Ownership: the same moves the app allows a player (see moveRole in index.html).
    old_owner := nullif(role_item ->> 'ownerId', '');
    new_owner := nullif(incoming_role ->> 'ownerId', '');
    if new_owner is distinct from old_owner
       and not coalesce((role_item ->> 'dead')::boolean, false)
       and not coalesce((role_item ->> 'predictionOnly')::boolean, false) then
      game_id := role_item ->> 'gameId';
      game_settings := coalesce(p_server #> array['settings', 'games', coalesce(game_id, '')], '{}'::jsonb);
      game_active := coalesce((game_settings ->> 'gameActive')::boolean, false);
      old_actor := null;
      new_actor := null;
      select item.value into old_actor from jsonb_array_elements(server_actors) as item(value)
      where item.value ->> 'id' = old_owner limit 1;
      select item.value into new_actor from jsonb_array_elements(server_actors) as item(value)
      where item.value ->> 'id' = new_owner limit 1;

      if new_owner is null then
        move_allowed := old_owner = any(my_actor_ids);
      elsif new_owner = any(my_actor_ids) and new_actor is not null then
        if old_owner is null or old_actor is null or old_owner = any(my_actor_ids) then
          move_allowed := true;
        else
          move_allowed := coalesce(old_actor #>> array['lockedRoleIds', coalesce(game_id, '')], '') is distinct from (role_item ->> 'id')
            and (not game_active or (
              coalesce((new_actor ->> 'replacementToken')::boolean, false)
              and not new_owner = any(spent_tokens)
            ));
          if move_allowed and game_active then spent_tokens := spent_tokens || new_owner; end if;
        end if;

        if move_allowed and (role_item ->> 'name') is distinct from 'Narrator'
           and jsonb_typeof(game_settings -> 'maxPerActor') = 'number' then
          max_per_actor := floor((game_settings ->> 'maxPerActor')::numeric)::integer;
          select count(*) into owned_count
          from (
            select item.value from jsonb_array_elements(merged_roles) as item(value)
            union all
            select item.value from jsonb_array_elements(server_roles) with ordinality as item(value, ordinality)
            where item.ordinality > role_index
          ) as owned(value)
          where owned.value ->> 'ownerId' = new_owner
            and owned.value ->> 'gameId' is not distinct from game_id
            and not coalesce((owned.value ->> 'dead')::boolean, false)
            and (owned.value ->> 'name') is distinct from 'Narrator';
          if owned_count >= max_per_actor then
            move_allowed := false;
            if game_active then spent_tokens := array_remove(spent_tokens, new_owner); end if;
          end if;
        end if;
      else
        move_allowed := false;
      end if;

      if move_allowed then
        role_item := jsonb_set(role_item, '{ownerId}', coalesce(to_jsonb(new_owner), 'null'::jsonb), true);
      end if;
    end if;

    merged_roles := merged_roles || jsonb_build_array(role_item);
  end loop;

  -- Actors: a player may edit only actors they control; nobody is deleted or renamed by others.
  for actor_item in select item.value from jsonb_array_elements(server_actors) as item(value) loop
    if actor_item ->> 'id' = any(my_actor_ids) then
      select item.value into incoming_actor from jsonb_array_elements(incoming_actors) as item(value)
      where jsonb_typeof(item.value) = 'object' and item.value ->> 'id' = actor_item ->> 'id'
      limit 1;
      if incoming_actor is not null then
        if jsonb_typeof(incoming_actor -> 'name') = 'string' and length(btrim(incoming_actor ->> 'name')) between 1 and 80 then
          actor_item := actor_item || jsonb_build_object('name', btrim(incoming_actor ->> 'name'));
        end if;
        if jsonb_typeof(incoming_actor -> 'history') = 'array' then
          actor_item := actor_item || jsonb_build_object('history', coalesce((
            select jsonb_agg(entry.value order by entry.ordinality)
            from (
              select item.value, item.ordinality
              from jsonb_array_elements(incoming_actor -> 'history') with ordinality as item(value, ordinality)
              where jsonb_typeof(item.value) = 'string' and length(item.value #>> '{}') between 1 and 120
              order by item.ordinality
              limit 200
            ) as entry
          ), '[]'::jsonb));
        end if;
        if jsonb_typeof(incoming_actor -> 'lockedRoleIds') = 'object' and length((incoming_actor -> 'lockedRoleIds')::text) <= 2000 then
          actor_item := actor_item || jsonb_build_object('lockedRoleIds', incoming_actor -> 'lockedRoleIds');
        end if;
        if jsonb_typeof(incoming_actor -> 'lockedAtByGame') = 'object' and length((incoming_actor -> 'lockedAtByGame')::text) <= 2000 then
          actor_item := actor_item || jsonb_build_object('lockedAtByGame', incoming_actor -> 'lockedAtByGame');
        end if;
        -- A player can spend their replacement token but never grant one.
        if incoming_actor -> 'replacementToken' = 'false'::jsonb then
          actor_item := actor_item || jsonb_build_object('replacementToken', false);
        end if;
      end if;
    end if;
    if actor_item ->> 'id' = any(spent_tokens) then
      actor_item := actor_item || jsonb_build_object('replacementToken', false);
    end if;
    merged_actors := merged_actors || jsonb_build_array(actor_item);
  end loop;

  -- New actors: only ids this user registered with cast_register_actor.
  for incoming_actor in select item.value from jsonb_array_elements(incoming_actors) as item(value) loop
    if jsonb_typeof(incoming_actor) = 'object'
       and incoming_actor ->> 'id' = any(my_actor_ids)
       and not exists (select 1 from jsonb_array_elements(merged_actors) as item(value) where item.value ->> 'id' = incoming_actor ->> 'id')
       and jsonb_typeof(incoming_actor -> 'name') = 'string'
       and length(btrim(incoming_actor ->> 'name')) between 1 and 80 then
      merged_actors := merged_actors || jsonb_build_array(jsonb_build_object(
        'id', incoming_actor ->> 'id',
        'name', btrim(incoming_actor ->> 'name'),
        'hasPassword', false,
        'lockedRoleIds', case when jsonb_typeof(incoming_actor -> 'lockedRoleIds') = 'object' and length((incoming_actor -> 'lockedRoleIds')::text) <= 2000
                              then incoming_actor -> 'lockedRoleIds' else '{}'::jsonb end,
        'lockedAtByGame', '{}'::jsonb,
        'replacementToken', false,
        'history', '[]'::jsonb,
        'deathCount', 0
      ));
    end if;
  end loop;

  return jsonb_set(jsonb_set(coalesce(p_server, '{}'::jsonb), '{roles}', merged_roles, true), '{actors}', merged_actors, true);
end;
$$;

revoke all on function public.cast_state_with_password_flags(text, jsonb) from public, anon, authenticated;
revoke all on function public.cast_state_for_public(jsonb) from public, anon, authenticated;
revoke all on function public.cast_is_host(text) from public, anon, authenticated;
revoke all on function public.cast_controls_actor(text, text) from public, anon, authenticated;
revoke all on function public.cast_keep_alive(text) from public, anon, authenticated;
revoke all on function public.cast_presence_start(text, text, text) from public, anon, authenticated;
revoke all on function public.cast_presence_touch(text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.cast_presence_activity(text, integer) from public, anon, authenticated;
revoke all on function public.cast_initialize_board(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.cast_login_host(text, text) from public, anon, authenticated;
revoke all on function public.cast_check_login_lockout(text, text) from public, anon, authenticated;
revoke all on function public.cast_record_login_failure(text, text) from public, anon, authenticated;
revoke all on function public.cast_claim_actor(text, text, text) from public, anon, authenticated;
revoke all on function public.cast_register_actor(text, text, text) from public, anon, authenticated;
revoke all on function public.cast_set_actor_password(text, text, text) from public, anon, authenticated;
revoke all on function public.cast_save_board(text, jsonb, bigint) from public, anon, authenticated;
revoke all on function public.cast_merge_player_save(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.cast_is_host(text) to authenticated;
grant execute on function public.cast_controls_actor(text, text) to authenticated;
grant execute on function public.cast_keep_alive(text) to authenticated;
grant execute on function public.cast_presence_start(text, text, text) to authenticated;
grant execute on function public.cast_presence_touch(text, text, text, boolean) to authenticated;
grant execute on function public.cast_presence_activity(text, integer) to authenticated;
grant execute on function public.cast_initialize_board(text, text, text, jsonb) to authenticated;
grant execute on function public.cast_login_host(text, text) to authenticated;
grant execute on function public.cast_claim_actor(text, text, text) to authenticated;
grant execute on function public.cast_register_actor(text, text, text) to authenticated;
grant execute on function public.cast_set_actor_password(text, text, text) to authenticated;
grant execute on function public.cast_save_board(text, jsonb, bigint) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cast_boards'
  ) then
    alter publication supabase_realtime add table public.cast_boards;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'cast_public_boards'
  ) then
    alter publication supabase_realtime add table public.cast_public_boards;
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice-clips',
  'voice-clips',
  true,
  5242880,
  array['audio/mpeg','audio/ogg','audio/wav','audio/webm','audio/mp4']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "voice clips host upload" on storage.objects;
create policy "voice clips host upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'voice-clips'
  and public.cast_is_host((storage.foldername(name))[1])
);

drop policy if exists "voice clips host update" on storage.objects;
create policy "voice clips host update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'voice-clips'
  and public.cast_is_host((storage.foldername(name))[1])
)
with check (
  bucket_id = 'voice-clips'
  and public.cast_is_host((storage.foldername(name))[1])
);

drop policy if exists "voice clips host delete" on storage.objects;
create policy "voice clips host delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'voice-clips'
  and public.cast_is_host((storage.foldername(name))[1])
);

drop policy if exists "personal voice actor upload" on storage.objects;
create policy "personal voice actor upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'voice-clips'
  and (storage.foldername(name))[2] = 'personal'
  and public.cast_controls_actor(
    (storage.foldername(name))[1],
    (storage.foldername(name))[3]
  )
);

drop policy if exists "personal voice actor delete" on storage.objects;
create policy "personal voice actor delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'voice-clips'
  and (storage.foldername(name))[2] = 'personal'
  and public.cast_controls_actor(
    (storage.foldername(name))[1],
    (storage.foldername(name))[3]
  )
);

commit;
