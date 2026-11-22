-- Chowdex: green trips on the account, so the campus leaderboard can show each school's miles and CO2 saved.
--
-- NOT YET RUN against a real database: review and test before applying.
-- The app works without it: until this is applied, trips stay in the browser as before and the leaderboard
-- simply leaves the miles and CO2 out.
--
-- Privacy: a trip row holds numbers only (miles, carbon, when). No place, no station, no position. Rows are only
-- ever written when a signed-in rider taps "I took this trip", and each user can only see their own. The
-- leaderboard function returns per-school totals, never a person's trips.
-- Trust: the numbers are worked out in the browser, so someone could post made-up trips to lift their school.
-- The range checks below stop absurd rows; anything stricter would mean planning the route on the server.

create table if not exists public.green_trips (
  user_id       uuid        not null references auth.users (id) on delete cascade,
  client_id     text        not null check (char_length(client_id) between 1 and 64),  -- the trip's id in the browser log
  at            timestamptz not null default now(),
  mode          text        not null check (mode in ('transit', 'walk')),
  transit_miles numeric     not null default 0 check (transit_miles between 0 and 60),
  walk_miles    numeric     not null default 0 check (walk_miles between 0 and 15),
  car_miles     numeric     not null default 0 check (car_miles between 0 and 80),
  co2_kg        numeric     not null default 0 check (co2_kg between 0 and 40),
  co2_saved_kg  numeric     not null default 0 check (co2_saved_kg between 0 and 40),
  primary key (user_id, client_id)
);

create index if not exists green_trips_at_idx on public.green_trips (at);

alter table public.green_trips enable row level security;

create policy "own trips read"   on public.green_trips for select to authenticated using (user_id = auth.uid());
create policy "own trips insert" on public.green_trips for insert to authenticated with check (user_id = auth.uid());
create policy "own trips delete" on public.green_trips for delete to authenticated using (user_id = auth.uid());

-- A trip is never edited, only added or removed.
revoke all on public.green_trips from anon, authenticated;
grant select, insert, delete on public.green_trips to authenticated;

-- One row per school with green trips since p_since. Kept apart from campus_board() so that function, which is
-- already live, does not have to change shape.
create or replace function public.campus_green(p_since timestamptz)
returns table (school_id text, trips int, miles numeric, co2_saved_kg numeric)
language sql stable security definer set search_path = public as $$
  select
    pr.school_id,
    count(*)::int,
    round(sum(t.transit_miles + t.walk_miles), 1),
    round(sum(t.co2_saved_kg), 1)
  from public.green_trips t
  join public.profiles pr on pr.id = t.user_id
  where pr.school_id is not null and t.at >= p_since
  group by pr.school_id;
$$;

revoke all on function public.campus_green(timestamptz) from public;
grant execute on function public.campus_green(timestamptz) to anon, authenticated;
