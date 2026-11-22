/**
 * MOCK MODE ONLY: sample "other students" for the community features (ratings from Chowdex users,
 * the campus leaderboard, and what is popular at a school).
 *
 * In mock mode there is only one user, so without this the campus screens would be empty. The numbers
 * are made up, the same way src/lib/mock/places.json is, and they are generated from a fixed hash so
 * they never change between visits. The signed-in user's own meals are added on top of them.
 * The real backend computes all of this from every user's journal: see
 * supabase/migrations/20261121000007_campus.sql.
 */

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * @param {Object} deps
 * @param {Array} deps.places    mock places (with `neighborhood`)
 * @param {Array} deps.schools   the school list
 */
export function createMockCommunity({ places, schools }) {
  /** Sample ratings other students at `schoolId` gave `placeId`: 0 to 4 of them, each 3 to 5 stars. */
  function sampleRatings(placeId, schoolId) {
    const seed = hash(`${placeId}|${schoolId}`);
    const count = seed % 5;
    return Array.from({ length: count }, (_, i) => 3 + (hash(`${placeId}|${schoolId}|${i}`) % 3));
  }

  const average = (list) => (list.length ? Math.round((10 * list.reduce((a, b) => a + b, 0)) / list.length) / 10 : null);

  /**
   * @param {string} placeId
   * @param {{schoolId: string|null, myRating: number|null}} me
   */
  function communityRating(placeId, { schoolId, myRating }) {
    const bySchool = Object.fromEntries(schools.map((s) => [s.id, sampleRatings(placeId, s.id)]));
    if (myRating && schoolId && bySchool[schoolId]) bySchool[schoolId] = [...bySchool[schoolId], myRating];
    const all = Object.values(bySchool).flat();
    if (myRating && !schoolId) all.push(myRating);
    const mine = schoolId ? bySchool[schoolId] ?? [] : [];
    return {
      rating: average(all),
      count: all.length,
      school: schoolId ? { id: schoolId, rating: average(mine), count: mine.length } : null,
    };
  }

  /**
   * One row per school. The sample part does not depend on `since`; the user's own meals since then
   * are added to their school.
   * @param {{schoolId: string|null, myEntries: Array}} me   myEntries: the user's dex entries in the window
   */
  function board({ schoolId, myEntries }) {
    const rows = schools.map((s) => {
      const seed = hash(`board|${s.id}`);
      return {
        school_id: s.id,
        explorers: 2 + (seed % 7),
        meals: 6 + (seed % 20),
        places: 4 + ((seed >> 3) % 13),
        neighborhoods: 2 + ((seed >> 6) % 6),
      };
    });
    const mine = rows.find((r) => r.school_id === schoolId);
    if (mine && myEntries.length) {
      const myPlaces = new Set(myEntries.map((e) => e.place_id));
      const myHoods = new Set(myEntries.map((e) => places.find((p) => p.id === e.place_id)?.neighborhood?.id).filter(Boolean));
      mine.explorers += 1;
      mine.meals += myEntries.length;
      mine.places += Math.ceil(myPlaces.size / 2); // some of your places are new to the school's list, some are not
      mine.neighborhoods = Math.min(24, mine.neighborhoods + Math.ceil(myHoods.size / 3));
    }
    return rows.sort((a, b) => b.neighborhoods - a.neighborhoods || b.places - a.places || b.meals - a.meals);
  }

  /** The places a school's students log most. */
  function popular(schoolId, limit, myEntries) {
    const mineCount = {};
    for (const e of myEntries) mineCount[e.place_id] = (mineCount[e.place_id] ?? 0) + 1;
    return places
      .map((p) => {
        const ratings = sampleRatings(p.id, schoolId);
        return { place_id: p.id, meals: ratings.length + (hash(`pop|${p.id}|${schoolId}`) % 4) + (mineCount[p.id] ?? 0), rating: average(ratings) };
      })
      .filter((r) => r.meals > 0)
      .sort((a, b) => b.meals - a.meals || (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, limit);
  }

  return { communityRating, board, popular };
}
