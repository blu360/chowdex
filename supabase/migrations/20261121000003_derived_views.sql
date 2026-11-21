-- Chowdex: everything derived from the food journal (dex_entries). Nothing here is stored.
-- Views use security_invoker, so row-level security applies: each user only ever sees their own rows.
-- These mirror src/lib/mock/petEngine.js and src/lib/api.js; keep them in step.
-- Badges, pet history, and the journal replay are the next migration.

-- Rules (same numbers as the mock) --------------------------------------------------------
-- daily feed limit 2, meal = 10 XP, +5 with a photo, pet levels at 10/20/40/60/90 XP, stamp radius 400 m.

create function public.pet_level(xp int) returns int
language sql immutable as $$
  select count(*)::int from unnest(array[10, 20, 40, 60, 90]) as t(threshold) where xp >= t.threshold;
$$;

-- XP needed for the next pet level, or null at the max (level 5).
create function public.pet_next_level_xp(xp int) returns int
language sql immutable as $$
  select min(t.threshold) from unnest(array[10, 20, 40, 60, 90]) as t(threshold) where t.threshold > xp;
$$;

-- Explorer (trainer) level: floor(sqrt(xp / 10)), uncapped.
create function public.explorer_level(xp int) returns int
language sql immutable as $$
  select floor(sqrt(greatest(xp, 0) / 10.0))::int;
$$;

-- Each meal, with whether it fed the pets and the XP it gave --------------------------------
-- Only the first 2 meals per Boston-time day feed the pets; later ones are logged but give no XP.
create view public.dex_fed with (security_invoker = true) as
with ranked as (
  select
    e.id,
    e.user_id,
    e.place_id,
    e.visited_at,
    e.photo_path,
    p.neighborhood_id,
    row_number() over (
      partition by e.user_id, (e.visited_at at time zone 'America/New_York')::date
      order by e.visited_at, e.id
    ) as meal_of_day
  from public.dex_entries e
  join public.places p on p.id = e.place_id
)
select
  id, user_id, place_id, visited_at, neighborhood_id, meal_of_day,
  meal_of_day <= 2 as fed,
  case when meal_of_day <= 2
       then 10 + case when photo_path is not null then 5 else 0 end
       else 0 end as xp_gained
from ranked;

-- Per-pet progress: the starter eats everywhere; a neighborhood pet only its own area ----------
-- Pets with no meals yet have no row (the API left-joins from `pets`; the starter is always unlocked).
create view public.pet_stats with (security_invoker = true) as
select
  user_id,
  'starter'::text as pet_id,
  count(*)::int as entries,
  coalesce(sum(xp_gained), 0)::int as xp
from public.dex_fed
group by user_id
union all
select
  f.user_id,
  t.id as pet_id,
  count(*)::int as entries,
  coalesce(sum(f.xp_gained), 0)::int as xp
from public.dex_fed f
join public.pets t on t.neighborhood_id = f.neighborhood_id
group by f.user_id, t.id;

-- Trainer stats: XP counts every fed meal ----------------------------------------------------
create view public.profile_stats with (security_invoker = true) as
select
  pr.id as user_id,
  coalesce(sum(f.xp_gained), 0)::int as xp,
  public.explorer_level(coalesce(sum(f.xp_gained), 0)::int) as level
from public.profiles pr
left join public.dex_fed f on f.user_id = pr.id
group by pr.id;

-- Today's feeding status (Boston time) ---------------------------------------------------------
create view public.feeding_status with (security_invoker = true) as
select
  pr.id as user_id,
  count(f.id)::int as meals_today,
  count(f.id) filter (where f.fed)::int as fed_today,
  greatest(2 - count(f.id), 0)::int as remaining,
  count(f.id) >= 2 as full
from public.profiles pr
left join public.dex_fed f
  on f.user_id = pr.id
 and (f.visited_at at time zone 'America/New_York')::date = (now() at time zone 'America/New_York')::date
group by pr.id;

-- Station stamps: a station is stamped when a place in the dex is within 400 m ------------------
create view public.user_stamps with (security_invoker = true) as
select
  e.user_id,
  s.id as stop_id,
  array_agg(e.place_id order by e.visited_at) as place_ids
from public.dex_entries e
join public.places p on p.id = e.place_id
join public.mbta_stops s on st_dwithin(p.geog, s.geog, 400)
group by e.user_id, s.id;

-- Per-line progress. Tiers: bronze 25%, silver 50%, gold 100% (tierFromPercent). ------------------
create view public.line_progress with (security_invoker = true) as
with totals as (
  select l.line, count(*)::int as total
  from public.mbta_stops s, unnest(s.lines) as l(line)
  group by l.line
),
stamped as (
  select us.user_id, l.line, count(*)::int as stamped
  from public.user_stamps us
  join public.mbta_stops s on s.id = us.stop_id, unnest(s.lines) as l(line)
  group by us.user_id, l.line
)
select
  st.user_id,
  t.line,
  st.stamped,
  t.total,
  floor(100.0 * st.stamped / t.total)::int as percent,
  case
    when st.stamped * 100 >= t.total * 100 then 'gold'
    when st.stamped * 100 >= t.total * 50  then 'silver'
    when st.stamped * 100 >= t.total * 25  then 'bronze'
    else 'none'
  end as tier
from stamped st
join totals t using (line);

-- Neighborhood progress: the dashboard's "7 of 24" is the count of rows ---------------------------
create view public.neighborhood_progress with (security_invoker = true) as
select
  f.user_id,
  f.neighborhood_id,
  count(*)::int as entries
from public.dex_fed f
where f.neighborhood_id is not null
group by f.user_id, f.neighborhood_id;

grant select on
  public.dex_fed, public.pet_stats, public.profile_stats, public.feeding_status,
  public.user_stamps, public.line_progress, public.neighborhood_progress
to authenticated;
