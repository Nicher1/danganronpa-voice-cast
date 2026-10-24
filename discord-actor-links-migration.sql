-- Private Discord-to-actor identity mappings. Run after shared scheduling.
begin;
create schema if not exists cast_discord;
revoke all on schema cast_discord from public,anon,authenticated;
create table if not exists cast_discord.actor_links (
  slug text not null references public.cast_schedules(slug) on delete cascade,
  actor_id text not null,
  discord_id text not null check (discord_id ~ '^[1-9][0-9]{16,19}$' and discord_id::numeric<=18446744073709551615),
  updated_at timestamptz not null default now(),
  primary key(slug,actor_id), unique(slug,discord_id)
);
revoke all on cast_discord.actor_links from public,anon,authenticated;
alter table cast_discord.actor_links enable row level security;

create or replace function public.cast_get_actor_discord(p_slug text,p_actor_id text)
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not public.cast_is_host(p_slug) then raise exception 'Host access required.'; end if;
  if not exists(select 1 from public.cast_boards b,lateral jsonb_array_elements(b.state->'actors') a where b.slug=p_slug and a->>'id'=p_actor_id) then
    raise exception 'Save the voice actor before linking Discord.';
  end if;
  return (select discord_id from cast_discord.actor_links where slug=p_slug and actor_id=p_actor_id);
end $$;

create or replace function public.cast_set_actor_discord(p_slug text,p_actor_id text,p_discord_id text,p_expected_discord_id text)
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_id text; new_id text:=nullif(btrim(p_discord_id),'');
begin
  if not public.cast_is_host(p_slug) then raise exception 'Host access required.'; end if;
  -- Also serializes creation of a previously absent link and actor deletion.
  perform 1 from public.cast_boards where slug=p_slug for update;
  if not exists(select 1 from public.cast_boards b,lateral jsonb_array_elements(b.state->'actors') a where b.slug=p_slug and a->>'id'=p_actor_id) then
    raise exception 'Voice actor not found.';
  end if;
  if new_id is not null and (new_id !~ '^[1-9][0-9]{16,19}$' or length(new_id)>20) then
    raise exception 'Enter a numeric Discord user ID, not a username.';
  end if;
  if new_id is not null and new_id::numeric>18446744073709551615 then raise exception 'Invalid Discord user ID.'; end if;
  select discord_id into current_id from cast_discord.actor_links where slug=p_slug and actor_id=p_actor_id;
  if current_id is distinct from nullif(btrim(p_expected_discord_id),'') then
    raise exception 'This Discord link changed elsewhere. Reopen the profile and try again.';
  end if;
  if new_id is null then
    delete from cast_discord.actor_links where slug=p_slug and actor_id=p_actor_id;
  else
    if exists(select 1 from cast_discord.actor_links where slug=p_slug and discord_id=new_id and actor_id<>p_actor_id) then
      raise exception 'That Discord account is already linked to another actor. Unlink it there first.';
    end if;
    insert into cast_discord.actor_links(slug,actor_id,discord_id) values(p_slug,p_actor_id,new_id)
    on conflict(slug,actor_id) do update set discord_id=excluded.discord_id,updated_at=now();
  end if;
  return new_id;
end $$;
revoke all on function public.cast_get_actor_discord(text,text),public.cast_set_actor_discord(text,text,text,text) from public,anon,authenticated;
grant execute on function public.cast_get_actor_discord(text,text),public.cast_set_actor_discord(text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
