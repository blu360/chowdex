-- Chowdex: tables, constraints, and indexes. See docs/schema.md for what each column means.
-- Reference data (neighborhoods, pets, mbta_stops, places) is loaded by scripts/, not by the client.

create extension if not exists postgis;

-- MBTA stations (reference) ---------------------------------------------------
create table public.mbta_stops (
  id    text primary key,                 -- MBTA id, e.g. 'place-chncl'
  name  text not null,
  lat   double precision not null,
  lng   double precision not null,
  lines text[] not null default '{}',     -- e.g. {Orange,Red}
  geog  geography(Point, 4326) generated always as
          (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored
);
create index mbta_stops_geog_idx on public.mbta_stops using gist (geog);

-- The 24 areas (reference) ----------------------------------------------------
create table public.neighborhoods (
  id       text primary key,              -- slug, e.g. 'chinatown-leather-district'
  name     text not null,
  city     text not null check (city in ('Boston', 'Cambridge')),
  color    text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  boundary geography(MultiPolygon, 4326) not null
);
create index neighborhoods_boundary_idx on public.neighborhoods using gist (boundary);

-- The 25 pets (reference) -----------------------------------------------------
create table public.pets (
  id              text primary key,       -- the neighborhood id, or 'starter'
  name            text not null,          -- the animal, e.g. 'Raccoon'
  neighborhood_id text unique references public.neighborhoods (id),
  is_starter      boolean not null default false,
  image           text not null,
  svg             text not null,
  -- the starter has no neighborhood; every other pet must have one
  check (is_starter = (neighborhood_id is null))
);
-- exactly one starter
create unique index pets_one_starter_idx on public.pets (is_starter) where is_starter;

-- Restaurants (reference, seeded from OpenStreetMap) ---------------------------
create table public.places (
  id                      uuid primary key default gen_random_uuid(),
  osm_id                  text not null unique,   -- e.g. 'node/123456'
  name                    text not null,
  lat                     double precision not null,
  lng                     double precision not null,
  cuisine                 text not null,
  price_level             int check (price_level between 1 and 4),
  opening_hours           text,
  open_late               boolean not null default false,
  website                 text,
  google_place_id         text,                   -- the only Google data we store
  nearest_stop_id         text references public.mbta_stops (id),
  nearest_stop_distance_m int,
  neighborhood_id         text references public.neighborhoods (id),
  geog                    geography(Point, 4326) generated always as
                            (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored
);
create index places_geog_idx on public.places using gist (geog);
create index places_neighborhood_idx on public.places (neighborhood_id);
create index places_nearest_stop_idx on public.places (nearest_stop_id);
create index places_cuisine_idx on public.places (cuisine);

-- Users -----------------------------------------------------------------------
-- Trainer XP and level are NOT stored: they are derived (see the profile_stats view).
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null,
  active_pet_id text not null default 'starter' references public.pets (id),
  created_at    timestamptz not null default now()
);

create table public.pet_nicknames (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  pet_id   text not null references public.pets (id),
  nickname text not null check (char_length(nickname) between 1 and 24),
  primary key (user_id, pet_id)
);

-- The food journal. Feeding, levels, badges, and history are all derived from this table.
create table public.dex_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  place_id      uuid not null references public.places (id),
  favorite_dish text check (char_length(favorite_dish) <= 80),
  my_rating     int check (my_rating between 1 and 5),
  note          text check (char_length(note) <= 280),
  photo_path    text,
  visited_at    timestamptz not null default now(),
  unique (user_id, place_id),
  -- a photo must live in the user's own folder of the dex-photos bucket
  check (photo_path is null or photo_path like user_id::text || '/%')
);
create index dex_entries_user_time_idx on public.dex_entries (user_id, visited_at);
create index dex_entries_place_idx on public.dex_entries (place_id);
