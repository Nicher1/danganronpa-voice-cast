-- player-save-hardening-migration.sql
-- Apply after login-hardening-migration.sql (recommended order; it does not depend on it).
-- Safe to run more than once.
-- 1. A player (non-host) save now starts from the stored board. From the incoming state only the
--    changes the app allows a player are copied: their own actor (name, history, locks, spending
--    their replacement token), claiming or releasing characters for their own actor (same lock,
--    token and max-per-actor rules as moveRole in index.html), their own practice recordings and
--    their own predictions. Everything else (other actors, other roles' fields, recaps, settings,
--    results, graph, deaths, spoiler roles) can only be changed by the host.
-- 2. Player predictions in every game on the board are saved. Before, any game outside
--    dr1/dr2/dr3anime/v3 (DR 2x2, Slayhem) fell back to dr1 and the prediction was dropped.
-- Host saves are unchanged.

begin;

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

revoke all on function public.cast_merge_player_save(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.cast_save_board(text, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.cast_save_board(text, jsonb, bigint) to authenticated;

commit;
