-- Chowdex: the campus layer. School on the profile (from onboarding), and three functions that read across
-- every user's journal for community ratings, the campus leaderboard, and what is popular at a school.
--
-- APPLIED to the live database on 2026-11-21, after a rolled-back test with fake users that checked the anonymous
-- and signed-in roles: outsiders only get aggregate counts, signed-in users can only set their own school, and
-- nothing else on profiles became writable.
-- Privacy: the functions are "security definer" so they can see all journals, but they only return counts and
-- averages. A school with one or two students would still let someone guess who rated a place, so consider
-- hiding a school's numbers until it has a few explorers (for example `having count(distinct e.user_id) >= 3`).

alter table public.profiles
  add column if not exists is_student   boolean,
  add column if not exists school_id    text,          -- an id from src/lib/schools.js, e.g. 'northeastern'
  add column if not exists onboarded_at timestamptz;   -- set when onboarding is finished or skipped

create index if not exists profiles_school_idx on public.profiles (school_id);

-- Users may set these three on their own row (migration 2 limits which profile columns can be updated).
grant update (is_student, school_id, onboarded_at) on public.profiles to authenticated;

-- Ratings Chowdex users gave a place: overall, and from the caller's school.
create or replace function public.place_community_rating(p_place uuid)
returns table (rating numeric, rating_count int, school_id text, school_rating numeric, school_count int)
language sql stable security definer set search_path = public as $$
  select
    round(avg(e.my_rating)::numeric, 1),
    count(e.my_rating)::int,
    (select school_id from public.profiles where id = auth.uid()),
    round((avg(e.my_rating) filter (where pr.school_id = me.school_id))::numeric, 1),
    (count(e.my_rating) filter (where pr.school_id = me.school_id))::int
  from public.dex_entries e
  join public.profiles pr on pr.id = e.user_id
  left join public.profiles me on me.id = auth.uid()
  where e.place_id = p_place and e.my_rating is not null;
$$;

-- One row per school with activity since p_since.
create or replace function public.campus_board(p_since timestamptz)
returns table (school_id text, explorers int, meals int, places int, neighborhoods int)
language sql stable security definer set search_path = public as $$
  select
    pr.school_id,
    count(distinct e.user_id)::int,
    count(*)::int,
    count(distinct e.place_id)::int,
    count(distinct pl.neighborhood_id)::int
  from public.dex_entries e
  join public.profiles pr on pr.id = e.user_id
  join public.places pl on pl.id = e.place_id
  where pr.school_id is not null and e.visited_at >= p_since
  group by pr.school_id;
$$;

-- The places a school's students log most.
create or replace function public.campus_popular(p_school text, p_limit int default 5)
returns table (place_id uuid, meals int, rating numeric)
language sql stable security definer set search_path = public as $$
  select e.place_id, count(*)::int, round(avg(e.my_rating)::numeric, 1)
  from public.dex_entries e
  join public.profiles pr on pr.id = e.user_id
  where pr.school_id = p_school
  group by e.place_id
  order by count(*) desc, avg(e.my_rating) desc nulls last
  limit greatest(1, least(p_limit, 25));
$$;

revoke all on function public.place_community_rating(uuid) from public;
revoke all on function public.campus_board(timestamptz) from public;
revoke all on function public.campus_popular(text, int) from public;
grant execute on function public.place_community_rating(uuid) to anon, authenticated;
grant execute on function public.campus_board(timestamptz) to anon, authenticated;
grant execute on function public.campus_popular(text, int) to anon, authenticated;
