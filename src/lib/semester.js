/**
 * Semesters, and the "semester recap" built from what the user did in one.
 * Everything is worked out in the browser from what src/lib/api.js already returns.
 */
import { stampTimes } from './game.js';

/**
 * The semester a date falls in. Spring is January to May, Summer June to August, Fall September to December.
 * @returns {{id: string, label: string, start: string, end: string}} start is inclusive, end is exclusive (ISO)
 */
export function semesterOf(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const make = (name, from, to) => ({
    id: `${y}-${name.toLowerCase()}`,
    label: `${name} ${y}`,
    start: new Date(y, from, 1).toISOString(),
    end: new Date(y, to, 1).toISOString(),
  });
  if (m <= 4) return make('Spring', 0, 5);
  if (m <= 7) return make('Summer', 5, 8);
  return make('Fall', 8, 12);
}

/** The semester before the given one. */
export function previousSemester(semester) {
  return semesterOf(new Date(new Date(semester.start).getTime() - 86400000));
}

/**
 * @param {Object} input
 * @param {{start: string, end: string, label: string}} input.semester
 * @param {Array} input.entries   journal entries with `place` (from getPetJournal('starter'))
 * @param {import('./api.js').Pet[]} input.pets
 * @param {import('./api.js').Badge[]} input.badges
 * @param {import('./api.js').StampSummary} input.stamps
 * @param {import('./api.js').Trip[]} input.trips
 */
export function buildRecap({ semester, entries, pets, badges, stamps, trips }) {
  const within = (iso) => iso != null && iso >= semester.start && iso < semester.end;
  const meals = entries.filter((e) => within(e.visited_at));

  const count = (list) => {
    const map = new Map();
    for (const x of list) map.set(x, (map.get(x) ?? 0) + 1);
    return [...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  };
  const hoods = count(meals.map((e) => e.place.neighborhood?.name).filter(Boolean));
  const cuisines = count(meals.map((e) => e.place.cuisine));
  const rated = meals.filter((e) => e.my_rating).sort((a, b) => b.my_rating - a.my_rating || b.visited_at.localeCompare(a.visited_at));
  const semesterTrips = trips.filter((t) => within(t.at));

  return {
    semester,
    meals: meals.length,
    places: new Set(meals.map((e) => e.place.id)).size,
    neighborhoods: hoods.map(([name]) => name),
    topNeighborhood: hoods[0]?.[0] ?? null,
    topCuisines: cuisines.slice(0, 3).map(([cuisine, n]) => ({ cuisine, count: n })),
    favorite: rated[0] ? { name: rated[0].place.name, rating: rated[0].my_rating, dish: rated[0].favorite_dish } : null,
    photos: meals.filter((e) => e.photo_url).length,
    xp: meals.reduce((sum, e) => sum + (e.xp_gained ?? 0), 0),
    newPets: pets.filter((p) => !p.is_starter && within(p.unlocked_at)),
    stamps: Object.values(stampTimes(stamps, entries)).filter(within).length,
    badges: badges.filter((b) => b.tier_earned_at.some(within)).map((b) => b.name),
    greenTrips: semesterTrips.length,
    co2SavedKg: Math.round(10 * semesterTrips.reduce((sum, t) => sum + (t.co2_saved_kg ?? 0), 0)) / 10,
  };
}
