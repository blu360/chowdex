-- Chowdex: a short-lived cache of Google star ratings on each place.
-- The ratings are fetched in batches by scripts/fetch-ratings.mjs (never in real time), and the app ignores any
-- rating older than 30 days. Only google_place_id is meant to be kept long term; the rating columns are a cache.
alter table public.places
  add column if not exists rating            numeric(2, 1) check (rating between 1 and 5),
  add column if not exists rating_count      int check (rating_count >= 0),
  add column if not exists rating_fetched_at timestamptz;   -- set even when Google had no match, so we do not retry every run

create index if not exists places_rating_fetched_idx on public.places (rating_fetched_at);
