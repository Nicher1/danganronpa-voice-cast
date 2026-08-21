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
      host_password_hash = extensions.crypt(p_host_password, extensions.gen_salt('bf'))
  where board_slug = p_slug;

  insert into public.cast_host_sessions (board_slug, user_id)
  values (p_slug, auth.uid())
  on conflict do nothing;

  return jsonb_build_object('state', board_row.state, 'revision', board_row.revision);
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
  select host_password_hash into stored_hash
  from public.cast_board_secrets where board_slug = p_slug;
  if stored_hash is null or extensions.crypt(coalesce(p_password, ''), stored_hash) <> stored_hash then
    raise exception 'Incorrect host password';
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
    password_ok := case stored_scheme
      when 'sha256' then encode(extensions.digest(coalesce(p_password, ''), 'sha256'), 'hex') = stored_hash
      else extensions.crypt(coalesce(p_password, ''), stored_hash) = stored_hash
    end;
    if not password_ok then raise exception 'Incorrect actor password'; end if;
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

  if coalesce(p_password, '') <> '' then
    insert into public.cast_actor_passwords (board_slug, actor_id, password_hash, scheme)
    values (p_slug, p_actor_id, extensions.crypt(p_password, extensions.gen_salt('bf')), 'bcrypt')
    on conflict (board_slug, actor_id) do update
      set password_hash = excluded.password_hash, scheme = excluded.scheme;
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
    values (p_slug, p_actor_id, extensions.crypt(p_password, extensions.gen_salt('bf')), 'bcrypt')
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
    current_chapter := coalesce(board_row.state #>> '{settings,voiceChapter}', '1');
    trial_ongoing := coalesce(
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

    merged_state := jsonb_set(
      jsonb_set(
        coalesce(p_state, '{}'::jsonb),
        '{roles}',
        coalesce(p_state -> 'roles', '[]'::jsonb) || coalesce(
          (
            select jsonb_agg(item.role order by item.ordinality)
            from jsonb_array_elements(coalesce(board_row.state -> 'roles', '[]'::jsonb))
              with ordinality as item(role, ordinality)
            where coalesce((item.role ->> 'hiddenSpoiler')::boolean, false)
              and not coalesce((item.role ->> 'revealed')::boolean, false)
              and not exists (
                select 1
                from jsonb_array_elements(coalesce(p_state -> 'roles', '[]'::jsonb)) as incoming(role)
                where incoming.role ->> 'id' = item.role ->> 'id'
              )
          ),
          '[]'::jsonb
        ),
        true
      ),
      '{secretSettings}',
      coalesce(board_row.state -> 'secretSettings', '{}'::jsonb),
      true
    );

    -- Chapter, Trial, result and graph data are host-controlled. A player may
    -- only replace prediction records belonging to an actor they control.
    merged_state := jsonb_set(merged_state, '{settings}', coalesce(board_row.state -> 'settings', '{}'::jsonb), true);
    merged_state := jsonb_set(merged_state, '{chapterResults}', coalesce(board_row.state -> 'chapterResults', '{}'::jsonb), true);
    merged_state := jsonb_set(merged_state, '{populationGraph}', coalesce(board_row.state -> 'populationGraph', '{}'::jsonb), true);
    merged_state := jsonb_set(merged_state, '{predictions}', merged_predictions, true);

    -- Death totals are historical host-owned facts even though players may edit
    -- their own actor name/password and create a new actor.
    merged_state := jsonb_set(
      merged_state,
      '{actors}',
      coalesce(
        (
          select jsonb_agg(
            case
              when existing.actor is null then item.actor || jsonb_build_object('deathCount', 0)
              else item.actor || jsonb_build_object('deathCount', coalesce(existing.actor -> 'deathCount', '0'::jsonb))
            end
            order by item.ordinality
          )
          from jsonb_array_elements(coalesce(merged_state -> 'actors', '[]'::jsonb))
            with ordinality as item(actor, ordinality)
          left join lateral (
            select stored.actor
            from jsonb_array_elements(coalesce(board_row.state -> 'actors', '[]'::jsonb)) as stored(actor)
            where stored.actor ->> 'id' = item.actor ->> 'id'
            limit 1
          ) as existing on true
        ),
        '[]'::jsonb
      ),
      true
    );
  end if;

  merged_state := public.cast_state_with_password_flags(p_slug, merged_state);

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

revoke all on function public.cast_state_with_password_flags(text, jsonb) from public, anon, authenticated;
revoke all on function public.cast_state_for_public(jsonb) from public, anon, authenticated;
revoke all on function public.cast_is_host(text) from public, anon, authenticated;
revoke all on function public.cast_controls_actor(text, text) from public, anon, authenticated;
revoke all on function public.cast_initialize_board(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.cast_login_host(text, text) from public, anon, authenticated;
revoke all on function public.cast_claim_actor(text, text, text) from public, anon, authenticated;
revoke all on function public.cast_register_actor(text, text, text) from public, anon, authenticated;
revoke all on function public.cast_set_actor_password(text, text, text) from public, anon, authenticated;
revoke all on function public.cast_save_board(text, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.cast_is_host(text) to authenticated;
grant execute on function public.cast_controls_actor(text, text) to authenticated;
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
