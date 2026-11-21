-- Chowdex: table-level privileges. Row-level security (migration 2) decides WHICH rows; these decide
-- whether a role may touch the table at all. New Supabase projects grant the API roles nothing by default
-- (plus a few odd extras like TRUNCATE), so start from zero and grant exactly what each role needs.

revoke all on
  public.mbta_stops, public.neighborhoods, public.pets, public.places,
  public.profiles, public.pet_nicknames, public.dex_entries,
  public.badge_defs, public.entry_facts, public.entry_running, public.entry_first_stops, public.badge_steps,
  public.user_badges, public.entry_pets, public.pet_running, public.pet_events, public.pet_journal,
  public.dex_fed, public.pet_stats, public.profile_stats, public.feeding_status,
  public.user_stamps, public.line_progress, public.neighborhood_progress
from anon, authenticated;

-- Public reference data: anyone can read, nobody writes from the client.
grant select on public.mbta_stops, public.neighborhoods, public.pets, public.places, public.badge_defs
  to anon, authenticated;

-- Signed-in users: their own profile, nicknames, and journal (RLS limits them to their own rows).
grant select on public.profiles to authenticated;
grant update (display_name, active_pet_id) on public.profiles to authenticated;

grant select, insert, update, delete on public.pet_nicknames to authenticated;

grant select, insert, delete on public.dex_entries to authenticated;
grant update (favorite_dish, my_rating, note, photo_path) on public.dex_entries to authenticated;

-- The derived views (security_invoker, so they only ever show the caller's own rows).
grant select on
  public.entry_facts, public.entry_running, public.entry_first_stops, public.badge_steps,
  public.user_badges, public.entry_pets, public.pet_running, public.pet_events, public.pet_journal,
  public.dex_fed, public.pet_stats, public.profile_stats, public.feeding_status,
  public.user_stamps, public.line_progress, public.neighborhood_progress
to authenticated;
