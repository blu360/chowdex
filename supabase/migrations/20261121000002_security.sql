-- Chowdex: row-level security, sign-up trigger, server-side rules, and photo storage.

-- Reference data: anyone can read, nobody writes from the client ----------------
alter table public.mbta_stops    enable row level security;
alter table public.neighborhoods enable row level security;
alter table public.pets          enable row level security;
alter table public.places        enable row level security;

create policy "read mbta_stops"    on public.mbta_stops    for select to anon, authenticated using (true);
create policy "read neighborhoods" on public.neighborhoods for select to anon, authenticated using (true);
create policy "read pets"          on public.pets          for select to anon, authenticated using (true);
create policy "read places"        on public.places        for select to anon, authenticated using (true);

-- Users: only your own rows ------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.pet_nicknames enable row level security;
alter table public.dex_entries   enable row level security;

create policy "own profile read"   on public.profiles for select to authenticated using (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- profiles are created by the sign-up trigger below, never by the client

create policy "own nicknames" on public.pet_nicknames for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own dex read"   on public.dex_entries for select to authenticated using (user_id = auth.uid());
create policy "own dex insert" on public.dex_entries for insert to authenticated with check (user_id = auth.uid());
create policy "own dex update" on public.dex_entries for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own dex delete" on public.dex_entries for delete to authenticated using (user_id = auth.uid());

-- Column-level limits: a client may only change these fields ------------------------
revoke update on public.profiles    from authenticated;
grant  update (display_name, active_pet_id) on public.profiles from authenticated;
revoke update on public.dex_entries from authenticated;
grant  update (favorite_dish, my_rating, note, photo_path) on public.dex_entries from authenticated;

-- Create a profile on first sign-in ------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(new.email, '@', 1),
      'Explorer'
    )
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- A pet is unlocked by the user's first meal in its neighborhood (the starter always is) -----
create function public.pet_unlocked(uid uuid, pet text) returns boolean
language sql stable security definer set search_path = public as $$
  select pet = 'starter'
      or exists (
        select 1
        from public.dex_entries e
        join public.places p on p.id = e.place_id
        join public.pets   t on t.neighborhood_id = p.neighborhood_id
        where e.user_id = uid and t.id = pet
      );
$$;

-- The active pet must be one the user has unlocked.
create function public.guard_active_pet() returns trigger
language plpgsql as $$
begin
  if new.active_pet_id is distinct from old.active_pet_id
     and not public.pet_unlocked(new.id, new.active_pet_id) then
    raise exception 'NOT_UNLOCKED: that pet is not unlocked yet' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger profiles_guard_active_pet
  before update of active_pet_id on public.profiles
  for each row execute function public.guard_active_pet();

-- Nicknames only for pets you have unlocked.
create function public.guard_nickname() returns trigger
language plpgsql as $$
begin
  if not public.pet_unlocked(new.user_id, new.pet_id) then
    raise exception 'NOT_UNLOCKED: that pet is not unlocked yet' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger pet_nicknames_guard
  before insert or update on public.pet_nicknames
  for each row execute function public.guard_nickname();

-- The server decides when a meal happened, so history cannot be backdated.
create function public.stamp_dex_entry() returns trigger
language plpgsql as $$
begin
  new.visited_at := now();
  return new;
end $$;

create trigger dex_entries_stamp
  before insert on public.dex_entries
  for each row execute function public.stamp_dex_entry();

-- Deleting an entry can lock a pet again: fall back to the starter if it was the active one.
create function public.after_dex_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles p
     set active_pet_id = 'starter'
   where p.id = old.user_id
     and p.active_pet_id <> 'starter'
     and not public.pet_unlocked(old.user_id, p.active_pet_id);
  return old;
end $$;

create trigger dex_entries_after_delete
  after delete on public.dex_entries
  for each row execute function public.after_dex_delete();

-- Meal photos: a private bucket, one folder per user ('<user id>/<file>') ----------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dex-photos', 'dex-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "photos read own" on storage.objects for select to authenticated
  using (bucket_id = 'dex-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'dex-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos update own" on storage.objects for update to authenticated
  using (bucket_id = 'dex-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'dex-photos' and (storage.foldername(name))[1] = auth.uid()::text);
