-- Chowdex: badges, pet history, and the food journal, all derived from dex_entries.
-- Mirrors the replay in src/lib/mock/petEngine.js. Views use security_invoker, so users only see their own rows.
-- "Late", "early", and "weekend" use Boston time. All badge progress counts every logged meal (fed or not).

-- Badge catalog ------------------------------------------------------------------------------
-- Static badges, plus one Rider badge per T line and one Regular badge per neighborhood, generated
-- from the reference tables so they follow the data. Neighborhood badges are worn by that pet; the rest by the starter.
create view public.badge_defs as
with line_totals as (
  select l.line, count(*)::int as total
  from public.mbta_stops s, unnest(s.lines) as l(line)
  group by l.line
),
line_tiers as (
  select
    line, total,
    greatest(4, round(total * 0.3))::int as silver,
    greatest(greatest(4, round(total * 0.3))::int + 1, round(total * 0.5))::int as gold
  from line_totals
)
select * from (
  values
    ('first-bite',          'First Bite',              'Log your first meal.',                                                       'visits',  array[1],        'starter'),
    ('getting-around',      'Getting Around',          'Try different places.',                                                      'visits',  array[5, 12, 25], 'starter'),
    ('neighborhood-hopper', 'Neighborhood Hopper',     'Eat in different neighborhoods.',                                            'places',  array[3, 6, 10],  'starter'),
    ('both-sides',          'Both Sides of the River', 'Eat in both Boston and Cambridge.',                                          'places',  array[2],        'starter'),
    ('night-owl',           'Night Owl',               'Log 3 meals after 10 pm.',                                                   'time',    array[3],        'starter'),
    ('early-bird',          'Early Bird',              'Log 3 meals between 5 and 9 am.',                                            'time',    array[3],        'starter'),
    ('weekend-brunch',      'Weekend Brunch',          'Log 3 meals on weekend mornings and early afternoons (9 am to 2 pm).',       'time',    array[3],        'starter'),
    ('food-diary',          'Food Diary',              'Write down what you ate.',                                                   'journal', array[5, 15],    'starter'),
    ('photographer',        'Photographer',            'Add photos of your meals.',                                                  'journal', array[3, 10],    'starter'),
    ('critic',              'Critic',                  'Rate the places you try.',                                                   'journal', array[5, 15],    'starter'),
    ('taste-tourist',       'Taste Tourist',           'Try different kinds of food.',                                               'variety', array[4, 8],     'starter'),
    ('budget-eater',        'Budget Eater',            'Find cheap eats ($).',                                                       'variety', array[3, 8],     'starter')
) as d(id, name, description, category, tiers, pet_id)
union all
select
  'rider-' || lower(line),
  line || ' Line Rider',
  'Stamp stations on the ' || line || ' Line by eating within 400 m of them.',
  'transit',
  array[3, silver, gold],
  'starter'
from line_tiers
union all
select
  'local-' || n.id,
  n.name || ' Regular',
  'Eat at 3 different places in ' || n.name || '.',
  'neighborhood',
  array[3],
  n.id
from public.neighborhoods n;

create function public.badge_tier_label(tier_count int, tier int) returns text
language sql immutable as $$
  select (case tier_count
            when 1 then array['Earned']
            when 2 then array['Bronze', 'Gold']
            else array['Bronze', 'Silver', 'Gold']
          end)[tier];
$$;

-- One row per meal with flags for what it counts toward -----------------------------------------
create view public.entry_facts with (security_invoker = true) as
select
  e.id as entry_id,
  e.user_id,
  e.visited_at,
  e.place_id,
  p.neighborhood_id,
  (row_number() over (partition by e.user_id, p.neighborhood_id order by e.visited_at, e.id)) as hood_rank,
  (p.neighborhood_id is not null
     and row_number() over (partition by e.user_id, p.neighborhood_id order by e.visited_at, e.id) = 1) as new_hood,
  (n.city is not null
     and row_number() over (partition by e.user_id, n.city order by e.visited_at, e.id) = 1) as new_city,
  (row_number() over (partition by e.user_id, p.cuisine order by e.visited_at, e.id) = 1) as new_cuisine,
  coalesce(p.price_level = 1, false) as cheap,
  extract(hour from e.visited_at at time zone 'America/New_York') as hr,
  extract(isodow from e.visited_at at time zone 'America/New_York') in (6, 7) as weekend,
  (nullif(btrim(e.favorite_dish), '') is not null) as has_dish,
  (e.photo_path is not null) as has_photo,
  (e.my_rating is not null) as has_rating
from public.dex_entries e
join public.places p on p.id = e.place_id
left join public.neighborhoods n on n.id = p.neighborhood_id;

-- Running totals after each meal, in order -------------------------------------------------------
create view public.entry_running with (security_invoker = true) as
select
  f.entry_id, f.user_id, f.visited_at, f.neighborhood_id, f.hood_rank,
  (row_number() over w)::int as meals,
  (sum(f.new_hood::int)    over w)::int as hoods,
  (sum(f.new_city::int)    over w)::int as cities,
  (sum(f.new_cuisine::int) over w)::int as cuisines,
  (sum(f.cheap::int)       over w)::int as cheap,
  (sum((f.hr >= 22 or f.hr < 4)::int) over w)::int as late,
  (sum((f.hr >= 5 and f.hr < 9)::int) over w)::int as early,
  (sum((f.weekend and f.hr >= 9 and f.hr < 14)::int) over w)::int as brunch,
  (sum(f.has_dish::int)    over w)::int as dishes,
  (sum(f.has_photo::int)   over w)::int as photos,
  (sum(f.has_rating::int)  over w)::int as rated
from public.entry_facts f
window w as (partition by f.user_id order by f.visited_at, f.entry_id rows between unbounded preceding and current row);

-- The first meal that stamped each station, for the line badges ------------------------------------
create view public.entry_first_stops with (security_invoker = true) as
select distinct on (e.user_id, s.id)
  e.user_id, s.id as stop_id, e.id as entry_id, e.visited_at
from public.dex_entries e
join public.places p on p.id = e.place_id
join public.mbta_stops s on st_dwithin(p.geog, s.geog, 400)
order by e.user_id, s.id, e.visited_at, e.id;

-- Badge progress after each meal: (badge, meal, value so far) ------------------------------------------
create view public.badge_steps with (security_invoker = true) as
select user_id, 'first-bite'          as badge_id, entry_id, visited_at, meals    as value from public.entry_running
union all select user_id, 'getting-around',      entry_id, visited_at, meals    from public.entry_running
union all select user_id, 'neighborhood-hopper', entry_id, visited_at, hoods    from public.entry_running
union all select user_id, 'both-sides',          entry_id, visited_at, cities   from public.entry_running
union all select user_id, 'night-owl',           entry_id, visited_at, late     from public.entry_running
union all select user_id, 'early-bird',          entry_id, visited_at, early    from public.entry_running
union all select user_id, 'weekend-brunch',      entry_id, visited_at, brunch   from public.entry_running
union all select user_id, 'food-diary',          entry_id, visited_at, dishes   from public.entry_running
union all select user_id, 'photographer',        entry_id, visited_at, photos   from public.entry_running
union all select user_id, 'critic',              entry_id, visited_at, rated    from public.entry_running
union all select user_id, 'taste-tourist',       entry_id, visited_at, cuisines from public.entry_running
union all select user_id, 'budget-eater',        entry_id, visited_at, cheap    from public.entry_running
union all
select user_id, 'local-' || neighborhood_id, entry_id, visited_at, hood_rank::int
from public.entry_running
where neighborhood_id is not null
union all
select
  fs.user_id,
  'rider-' || lower(l.line),
  fs.entry_id,
  fs.visited_at,
  (row_number() over (partition by fs.user_id, l.line order by fs.visited_at, fs.entry_id, fs.stop_id))::int
from public.entry_first_stops fs
join public.mbta_stops s on s.id = fs.stop_id, unnest(s.lines) as l(line);

-- getBadges(): every badge with the user's progress, locked ones included ---------------------------------
create view public.user_badges with (security_invoker = true) as
with progress as (
  select
    s.user_id, s.badge_id,
    max(s.value) as value,
    min(s.visited_at) filter (where s.value >= d.tiers[1]) as t1,
    min(s.visited_at) filter (where s.value >= d.tiers[2]) as t2,
    min(s.visited_at) filter (where s.value >= d.tiers[3]) as t3
  from public.badge_steps s
  join public.badge_defs d on d.id = s.badge_id
  group by s.user_id, s.badge_id
)
select
  pr.id as user_id,
  d.id as badge_id,
  d.name, d.description, d.category, d.pet_id, d.tiers,
  coalesce(p.value, 0)::int as value,
  (select count(*) from unnest(d.tiers) as t(target) where coalesce(p.value, 0) >= t.target)::int as tier,
  (select min(t.target) from unnest(d.tiers) as t(target) where t.target > coalesce(p.value, 0)) as next_target,
  (array[p.t1, p.t2, p.t3])[1:cardinality(d.tiers)] as tier_earned_at
from public.profiles pr
cross join public.badge_defs d
left join progress p on p.user_id = pr.id and p.badge_id = d.id;

-- Which pets each meal fed ---------------------------------------------------------------------------------
-- Every meal feeds the starter and the pet of the neighborhood it was in.
create view public.entry_pets with (security_invoker = true) as
select f.user_id, f.id as entry_id, f.place_id, f.visited_at, f.fed, f.xp_gained, 'starter'::text as pet_id
from public.dex_fed f
union all
select f.user_id, f.id, f.place_id, f.visited_at, f.fed, f.xp_gained, t.id
from public.dex_fed f
join public.pets t on t.neighborhood_id = f.neighborhood_id;

create view public.pet_running with (security_invoker = true) as
select
  ep.*,
  (row_number() over w)::int as pet_meal_no,
  (coalesce(sum(ep.xp_gained) over w, 0) - ep.xp_gained)::int as xp_before,
  (coalesce(sum(ep.xp_gained) over w, 0))::int as xp_after
from public.entry_pets ep
window w as (partition by ep.user_id, ep.pet_id order by ep.visited_at, ep.entry_id rows between unbounded preceding and current row);

-- getPetHistory() / getActivity(): the story, rebuilt by replaying the journal -----------------------------------
-- Sort newest first by (at desc, sort_key desc): within one meal the order is joined, fed/full, level up, badge.
create view public.pet_events with (security_invoker = true) as
with badge_crossings as (
  select distinct on (s.user_id, s.badge_id, i.tier)
    s.user_id, s.badge_id, i.tier, s.entry_id, s.visited_at
  from public.badge_steps s
  join public.badge_defs d on d.id = s.badge_id
  cross join lateral generate_series(1, cardinality(d.tiers)) as i(tier)
  where s.value >= d.tiers[i.tier]
  order by s.user_id, s.badge_id, i.tier, s.visited_at, s.entry_id
)
select r.user_id, r.pet_id, 'unlocked'::text as type, r.visited_at as at, r.entry_id, r.place_id,
       pl.name as place_name, null::int as xp, null::int as level, null::int as from_level,
       null::text as badge_id, null::int as tier, 1 as sort_key,
       t.name || ' joined you after your first meal in ' || n.name || '.' as text
from public.pet_running r
join public.pets t on t.id = r.pet_id and not t.is_starter
join public.neighborhoods n on n.id = t.neighborhood_id
join public.places pl on pl.id = r.place_id
where r.pet_meal_no = 1
union all
select r.user_id, r.pet_id, case when r.fed then 'fed' else 'full' end, r.visited_at, r.entry_id, r.place_id,
       pl.name, r.xp_gained, null, null, null, null, 2,
       case when r.fed
            then 'Fed at ' || pl.name || ' (+' || r.xp_gained || ' XP).'
            else 'Meal at ' || pl.name || '. Full for today, so no XP.' end
from public.pet_running r
join public.places pl on pl.id = r.place_id
union all
select r.user_id, r.pet_id, 'level_up', r.visited_at, r.entry_id, r.place_id,
       pl.name, null, public.pet_level(r.xp_after), public.pet_level(r.xp_before), null, null, 3,
       'Reached level ' || public.pet_level(r.xp_after) || '.'
from public.pet_running r
join public.places pl on pl.id = r.place_id
where public.pet_level(r.xp_after) > public.pet_level(r.xp_before)
union all
select c.user_id, d.pet_id, 'badge', c.visited_at, c.entry_id, e.place_id,
       pl.name, null, null, null, c.badge_id, c.tier, 4,
       'Earned ' || d.name || ' (' || public.badge_tier_label(cardinality(d.tiers), c.tier) || ').'
from badge_crossings c
join public.badge_defs d on d.id = c.badge_id
join public.dex_entries e on e.id = c.entry_id
join public.places pl on pl.id = e.place_id;

-- getPetJournal(): the meals that fed a pet (the starter sees all of them) ---------------------------------------
-- Stats (meal count, average rating, top cuisines, ...) are cheap aggregates the API can compute from these rows.
create view public.pet_journal with (security_invoker = true) as
select
  ep.user_id, ep.pet_id, ep.entry_id, ep.visited_at, ep.fed, ep.xp_gained,
  e.favorite_dish, e.my_rating, e.note, e.photo_path,
  pl.id as place_id, pl.name as place_name, pl.cuisine, pl.price_level, pl.neighborhood_id
from public.entry_pets ep
join public.dex_entries e on e.id = ep.entry_id
join public.places pl on pl.id = ep.place_id;

grant select on public.badge_defs to anon, authenticated;
grant select on
  public.entry_facts, public.entry_running, public.entry_first_stops, public.badge_steps,
  public.user_badges, public.entry_pets, public.pet_running, public.pet_events, public.pet_journal
to authenticated;
