-- Island Pet: one shared pet per board for the second game's island routes.
-- Additive and safe to run more than once. Run after supabase-schema.sql.
-- Players change the pet only through cast_pet_action (as their own actor). The server
-- owns the clock, cooldowns, daily coin limits, prices and chapter unlocks.
begin;

create table if not exists public.cast_pets (
  slug text primary key references public.cast_boards(slug) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.cast_pets enable row level security;
revoke all on public.cast_pets from public, anon, authenticated;
grant select on public.cast_pets to anon, authenticated;
grant select, insert, update, delete on public.cast_pets to service_role;
drop policy if exists "Public shared pet" on public.cast_pets;
create policy "Public shared pet" on public.cast_pets for select to anon, authenticated
  using (exists(select 1 from public.cast_public_boards b where b.slug = cast_pets.slug and b.initialized));

-- Keep in step with CATALOG in pet-minigame.js (tests/island-pet.integration.js compares them).
create or replace function public.cast_pet_catalog()
returns jsonb language sql immutable set search_path = pg_catalog as $$
select $json$[
 {"id":"biscuit","kind":"food","price":0,"ch":1,"fx":{"hunger":14}},
 {"id":"rice_ball","kind":"food","price":6,"ch":1,"fx":{"hunger":26,"joy":3}},
 {"id":"peach_juice","kind":"food","price":8,"ch":1,"fx":{"hunger":8,"joy":10}},
 {"id":"island_curry","kind":"food","price":14,"ch":2,"fx":{"hunger":40}},
 {"id":"fruit_parfait","kind":"food","price":20,"ch":3,"fx":{"hunger":12,"joy":26}},
 {"id":"beach_feast","kind":"food","price":32,"ch":5,"fx":{"hunger":50,"joy":20,"energy":6}},
 {"id":"beach_ball","kind":"toy","price":0,"ch":1,"fx":{"joy":14,"energy":-6}},
 {"id":"bubbles","kind":"toy","price":12,"ch":1,"fx":{"joy":18,"clean":-4,"energy":-5}},
 {"id":"kite","kind":"toy","price":10,"ch":2,"fx":{"joy":22,"energy":-9}},
 {"id":"hide_and_seek","kind":"toy","price":16,"ch":4,"fx":{"joy":30,"energy":-12}},
 {"id":"straw_hat","kind":"hat","price":15,"ch":1},
 {"id":"sun_visor","kind":"hat","price":20,"ch":2},
 {"id":"party_hat","kind":"hat","price":25,"ch":3},
 {"id":"star_crown","kind":"hat","price":60,"ch":5},
 {"id":"bell","kind":"neck","price":12,"ch":1},
 {"id":"flower_lei","kind":"neck","price":20,"ch":1},
 {"id":"bandana","kind":"neck","price":18,"ch":2},
 {"id":"sunset","kind":"bg","price":30,"ch":2},
 {"id":"garden","kind":"bg","price":40,"ch":3},
 {"id":"night_sky","kind":"bg","price":50,"ch":4}
]$json$::jsonb $$;

create or replace function public.cast_pet_default_state(p_now timestamptz)
returns jsonb language sql immutable set search_path = pg_catalog as $$
select jsonb_build_object('v',1,'name',null,'revealed',false,'xp',0,
  'stats',jsonb_build_object('hunger',70,'joy',70,'energy',80,'clean',80),
  'at',p_now,'owned','{}'::jsonb,'worn','{}'::jsonb,'people','{}'::jsonb,'log','[]'::jsonb) $$;

-- Stats drift down while nobody is around, but never below 10 and never for more than 16 hours.
create or replace function public.cast_pet_decay(p_state jsonb, p_now timestamptz)
returns jsonb language plpgsql immutable set search_path = pg_catalog as $$
declare hours double precision; stats jsonb := p_state->'stats'; key text; rate double precision; old double precision;
begin
  hours := least(16, greatest(0, extract(epoch from (p_now - (p_state->>'at')::timestamptz)) / 3600.0));
  foreach key in array array['hunger','joy','energy','clean'] loop
    rate := case key when 'hunger' then 2.5 when 'joy' then 2 when 'energy' then 1.5 else 1.5 end;
    old := (stats->>key)::double precision;
    stats := jsonb_set(stats, array[key], to_jsonb(round(greatest(least(old, 10), old - rate * hours))::integer));
  end loop;
  return jsonb_set(jsonb_set(p_state, '{stats}', stats), '{at}', to_jsonb(p_now));
end $$;

create or replace function public.cast_pet_apply(
  p_slug text, p_actor text, p_actor_name text, p_action text, p_arg text, p_score integer,
  p_chapter integer, p_now timestamptz)
returns jsonb language plpgsql set search_path = public as $$
declare
  s jsonb; person jsonb; item jsonb; fx record; stats jsonb; today text; cls text; cd integer; last_at timestamptz;
  coins integer; price integer; gain integer; cap integer; wait integer; text_line text; xp_gain integer := 0;
  care boolean := false; score integer; kind text; ch integer := greatest(1, least(6, coalesce(p_chapter, 1)));
begin
  insert into public.cast_pets(slug, state) values (p_slug, public.cast_pet_default_state(p_now)) on conflict do nothing;
  select state into s from public.cast_pets where slug = p_slug for update;
  s := public.cast_pet_decay(s, p_now);
  stats := s->'stats';
  today := to_char(p_now at time zone 'Europe/Copenhagen', 'YYYY-MM-DD');
  person := coalesce(s->'people'->p_actor, jsonb_build_object('coins',0,'care',0,'day','','dayCare',0,'dayGame',0,'cd','{}'::jsonb));
  if person->>'day' is distinct from today then
    person := jsonb_set(jsonb_set(person, '{day}', to_jsonb(today)), '{dayCare}', '0');
    person := jsonb_set(person, '{dayGame}', '0');
  end if;
  coins := (person->>'coins')::integer;

  if p_action in ('feed','play') then
    kind := case p_action when 'feed' then 'food' else 'toy' end;
    select x into item from jsonb_array_elements(public.cast_pet_catalog()) x where x->>'id' = p_arg and x->>'kind' = kind;
    if item is null then return jsonb_build_object('ok',false,'error','Pick something from the list.'); end if;
    if (item->>'ch')::integer > ch then return jsonb_build_object('ok',false,'error','That is not unlocked yet.'); end if;
    price := (item->>'price')::integer;
    if coins < price then return jsonb_build_object('ok',false,'error','Not enough coins.'); end if;
    if p_action = 'feed' and (stats->>'hunger')::integer >= 95 then return jsonb_build_object('ok',false,'error','Not hungry right now.'); end if;
    if p_action = 'play' and (stats->>'energy')::integer < 15 then return jsonb_build_object('ok',false,'error','Too sleepy to play. Let it rest first.'); end if;
    cls := p_action; cd := 25;
  elsif p_action = 'wash' then cls := 'wash'; cd := 45;
  elsif p_action = 'pet' then cls := 'pet'; cd := 15;
  elsif p_action = 'rest' then cls := 'rest'; cd := 90;
  elsif p_action = 'game' then cls := 'game'; cd := 60;
  elsif p_action = 'buy' then
    select x into item from jsonb_array_elements(public.cast_pet_catalog()) x where x->>'id' = p_arg and x->>'kind' in ('hat','neck','bg');
    if item is null then return jsonb_build_object('ok',false,'error','Pick something from the shop.'); end if;
    if (item->>'ch')::integer > ch then return jsonb_build_object('ok',false,'error','That is not unlocked yet.'); end if;
    if s->'owned' ? p_arg then return jsonb_build_object('ok',false,'error','Already owned.'); end if;
    price := (item->>'price')::integer;
    if coins < price then return jsonb_build_object('ok',false,'error','Not enough coins.'); end if;
    person := jsonb_set(person, '{coins}', to_jsonb(coins - price));
    s := jsonb_set(s, '{owned}', (s->'owned') || jsonb_build_object(p_arg, true));
    s := jsonb_set(s, array['worn', item->>'kind'], to_jsonb(p_arg), true);
    text_line := 'bought and dressed the pet in: ' || p_arg;
  elsif p_action = 'wear' then
    select x into item from jsonb_array_elements(public.cast_pet_catalog()) x where x->>'id' = p_arg and x->>'kind' in ('hat','neck','bg');
    if item is null or not (s->'owned' ? p_arg) then return jsonb_build_object('ok',false,'error','You can only wear things the pet owns.'); end if;
    s := jsonb_set(s, array['worn', item->>'kind'], to_jsonb(p_arg), true);
    text_line := 'changed the look: ' || p_arg;
  elsif p_action = 'unwear' then
    if p_arg not in ('hat','neck','bg') then return jsonb_build_object('ok',false,'error','Choose hat, neck or background.'); end if;
    s := jsonb_set(s, '{worn}', (s->'worn') - p_arg);
    text_line := 'took off the ' || p_arg;
  else
    return jsonb_build_object('ok',false,'error','Unknown pet action.');
  end if;

  if cls is not null then
    last_at := (person->'cd'->>cls)::timestamptz;
    if last_at is not null and p_now < last_at + make_interval(secs => cd) then
      wait := ceil(extract(epoch from (last_at + make_interval(secs => cd) - p_now)))::integer;
      return jsonb_build_object('ok',false,'error','Wait '||wait||' more seconds.');
    end if;
    person := jsonb_set(person, array['cd', cls], to_jsonb(p_now));
    if cls in ('feed','play') then
      for fx in select key, value::integer as delta from jsonb_each_text(item->'fx') loop
        stats := jsonb_set(stats, array[fx.key], to_jsonb(greatest(0, least(100, (stats->>fx.key)::integer + fx.delta))));
      end loop;
      coins := coins - price;
      person := jsonb_set(person, '{coins}', to_jsonb(coins));
      care := true; xp_gain := 3;
      text_line := case cls when 'feed' then 'fed the pet: ' else 'played with the pet: ' end || p_arg;
    elsif cls = 'wash' then
      stats := jsonb_set(stats, '{clean}', to_jsonb(least(100, (stats->>'clean')::integer + 35)));
      stats := jsonb_set(stats, '{joy}', to_jsonb(least(100, (stats->>'joy')::integer + 2)));
      care := true; xp_gain := 3; text_line := 'gave the pet a wash';
    elsif cls = 'pet' then
      stats := jsonb_set(stats, '{joy}', to_jsonb(least(100, (stats->>'joy')::integer + 6)));
      care := true; xp_gain := 3; text_line := 'cuddled the pet';
    elsif cls = 'rest' then
      stats := jsonb_set(stats, '{energy}', to_jsonb(least(100, (stats->>'energy')::integer + 28)));
      stats := jsonb_set(stats, '{hunger}', to_jsonb(greatest(0, (stats->>'hunger')::integer - 4)));
      care := true; xp_gain := 3; text_line := 'tucked the pet in for a nap';
    elsif cls = 'game' then
      score := greatest(0, least(40, coalesce(p_score, 0)));
      cap := 60 - (person->>'dayGame')::integer;
      gain := least(score / 4, greatest(cap, 0));
      person := jsonb_set(person, '{coins}', to_jsonb((person->>'coins')::integer + gain));
      person := jsonb_set(person, '{dayGame}', to_jsonb((person->>'dayGame')::integer + gain));
      stats := jsonb_set(stats, '{joy}', to_jsonb(least(100, (stats->>'joy')::integer + least(15, score / 3))));
      stats := jsonb_set(stats, '{energy}', to_jsonb(greatest(0, (stats->>'energy')::integer - 5)));
      xp_gain := score / 5;
      text_line := 'scored ' || score || ' in Snack Catch';
    end if;
    s := jsonb_set(s, '{stats}', stats);
  end if;

  if care and (person->>'dayCare')::integer < 20 then
    person := jsonb_set(person, '{coins}', to_jsonb((person->>'coins')::integer + 1));
    person := jsonb_set(person, '{dayCare}', to_jsonb((person->>'dayCare')::integer + 1));
  end if;
  if care then person := jsonb_set(person, '{care}', to_jsonb((person->>'care')::integer + 1)); end if;
  s := jsonb_set(s, '{xp}', to_jsonb((s->>'xp')::integer + xp_gain));
  s := jsonb_set(s, array['people', p_actor], person, true);
  s := jsonb_set(s, '{log}', (
    select coalesce(jsonb_agg(entry order by ord), '[]'::jsonb) from (
      select entry, ord from jsonb_array_elements(
        jsonb_build_array(jsonb_build_object('t', p_now, 'who', left(p_actor_name, 40), 'text', text_line)) || (s->'log')
      ) with ordinality as t(entry, ord) order by ord limit 12) z));
  update public.cast_pets set state = s, updated_at = p_now where slug = p_slug;
  return jsonb_build_object('ok', true, 'state', s);
end $$;

create or replace function public.cast_pet_action(
  p_slug text, p_actor text, p_action text, p_arg text default null, p_score integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor_name text; chapter integer;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if p_actor is null or p_action is null or length(coalesce(p_arg,'')) > 40 then raise exception 'Invalid pet request.'; end if;
  select a->>'name', coalesce((b.state->'settings'->'games'->'dr2x2'->>'voiceChapter')::integer, 1)
    into actor_name, chapter
    from public.cast_public_boards b, lateral jsonb_array_elements(b.state->'actors') a
    where b.slug = p_slug and b.initialized and a->>'id' = p_actor;
  if actor_name is null then raise exception 'Voice actor not found.'; end if;
  if not (public.cast_is_host(p_slug) or exists(
    select 1 from public.cast_actor_sessions s where s.board_slug = p_slug and s.actor_id = p_actor and s.user_id = auth.uid()
  )) then raise exception 'You can only care for the pet as your own actor.'; end if;
  return public.cast_pet_apply(p_slug, p_actor, actor_name, p_action, p_arg, p_score, chapter, statement_timestamp());
end $$;

create or replace function public.cast_pet_host(p_slug text, p_action text, p_arg text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s jsonb; now_ts timestamptz := statement_timestamp(); clean_name text;
begin
  if not public.cast_is_host(p_slug) then raise exception 'Host access required.'; end if;
  insert into public.cast_pets(slug, state) values (p_slug, public.cast_pet_default_state(now_ts)) on conflict do nothing;
  select state into s from public.cast_pets where slug = p_slug for update;
  s := public.cast_pet_decay(s, now_ts);
  if p_action = 'reveal' then
    s := jsonb_set(s, '{revealed}', to_jsonb(p_arg = 'true'));
  elsif p_action = 'rename' then
    clean_name := nullif(btrim(coalesce(p_arg, '')), '');
    if clean_name is not null and clean_name !~ '^[A-Za-z0-9 .''-]{1,20}$' then
      raise exception 'Use up to 20 letters, numbers, spaces, dots, dashes or apostrophes.';
    end if;
    s := jsonb_set(s, '{name}', coalesce(to_jsonb(clean_name), 'null'::jsonb));
  elsif p_action = 'reset' then
    s := public.cast_pet_default_state(now_ts) || jsonb_build_object('revealed', s->'revealed', 'name', s->'name');
  else
    raise exception 'Unknown host action.';
  end if;
  update public.cast_pets set state = s, updated_at = now_ts where slug = p_slug;
  return jsonb_build_object('ok', true, 'state', s);
end $$;

revoke all on function public.cast_pet_catalog(), public.cast_pet_default_state(timestamptz),
  public.cast_pet_decay(jsonb, timestamptz),
  public.cast_pet_apply(text,text,text,text,text,integer,integer,timestamptz),
  public.cast_pet_action(text,text,text,text,integer), public.cast_pet_host(text,text,text)
  from public, anon, authenticated;
grant execute on function public.cast_pet_action(text,text,text,text,integer), public.cast_pet_host(text,text,text) to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') and not exists(
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cast_pets'
  ) then alter publication supabase_realtime add table public.cast_pets; end if;
end $$;
notify pgrst, 'reload schema';
commit;
