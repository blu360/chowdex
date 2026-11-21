/**
 * The local spotlight: which small places to show off, and why.
 *
 * Reviews alone do not say whether a place is a small local spot (a busy chain can have 4.5 stars
 * and 5,000 reviews), so each place gets a "local score" from several plain signals. Every point
 * comes with a reason that is shown to the user, so the pick is never a black box.
 *
 * Everything is worked out in the browser from what src/lib/api.js already returns. Nothing is stored.
 * A stronger version would add community signals from the backend (see the notes at the bottom).
 */
import { STAMP_RADIUS_M } from './api.js';
import { isLocalFavorite, locationCounts, normalizeName } from './chains.js';

/** A rating this high with this few reviews reads as "locals know it, tourists have not found it". */
const GEM_MIN_RATING = 4.3;
const GEM_MAX_REVIEWS = 1500;
const CANDIDATES = 9; // how many top places get their live details looked up before the final pick

/**
 * @param {import('./api.js').Place} place
 * @param {Object} ctx
 * @param {Map<string, number>} ctx.counts      from locationCounts(): how many locations share the name
 * @param {Set<string>} ctx.visitedHoods        neighborhood ids the user has eaten in
 * @param {Set<string>} ctx.stampedStations     station ids the user has stamped
 * @returns {{score: number, reasons: string[]}}
 */
export function localScore(place, { counts, visitedHoods, stampedStations }) {
  let score = 0;
  const reasons = [];
  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };

  // 1. How small is it? One location beats a handful; a handful beats a local chain.
  const locations = counts.get(normalizeName(place.name)) ?? 1;
  if (locations === 1) add(3, 'One of a kind');
  else if (locations <= 3) add(2, 'Small local group');
  else if (isLocalFavorite(place.name)) add(1, 'Boston original');

  // 2. What the ratings look like, when we have them: well loved, but not overrun.
  const rating = place.details?.rating;
  const reviews = place.details?.rating_count;
  if (rating != null && rating >= GEM_MIN_RATING && reviews != null && reviews < GEM_MAX_REVIEWS) add(2, 'Hidden gem');
  else if (rating != null && rating >= 4.5) add(1, 'Highly rated');

  // 3. What it does for this explorer: a new neighborhood (and its pet), or a new station stamp.
  if (place.neighborhood && !visitedHoods.has(place.neighborhood.id)) add(2, `New area: ${place.neighborhood.name}`);
  const stop = place.nearest_stop;
  if (stop && stop.distance_m <= STAMP_RADIUS_M && !stampedStations.has(stop.id)) add(1, `Stamps ${stop.name}`);

  // 4. Student budget.
  if (place.price_level != null && place.price_level <= 2) add(1, 'Easy on the wallet');

  return { score, reasons };
}

/** A small repeatable hash, so ties are shuffled the same way all day and differently tomorrow. */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Picks today's spotlight: the highest local scores among places the user has not logged yet,
 * one per neighborhood where possible. The order of equal scores changes each day.
 *
 * @param {Object} input
 * @param {import('./api.js').Place[]} input.places           from getPlaces() (chains already removed)
 * @param {import('./api.js').DexEntry[]} input.dex
 * @param {import('./api.js').NeighborhoodProgress[]} input.hoods
 * @param {import('./api.js').StampSummary} input.stamps
 * @param {(id: string) => Promise<import('./api.js').Place>} input.getPlace   to look up live ratings for the finalists
 * @param {number} [input.limit]
 * @returns {Promise<Array<import('./api.js').Place & {score: number, reasons: string[]}>>}
 */
export async function pickSpotlight({ places, dex, hoods, stamps, getPlace, limit = 3 }) {
  const logged = new Set(dex.map((e) => e.place_id));
  const ctx = {
    counts: locationCounts(places),
    visitedHoods: new Set(hoods.filter((h) => h.visited).map((h) => h.id)),
    stampedStations: new Set(Object.keys(stamps.by_station)),
  };
  const today = new Date().toISOString().slice(0, 10);
  const byScore = (a, b) => b.score - a.score || hash(a.id + today) - hash(b.id + today);

  const ranked = places
    .filter((p) => !logged.has(p.id))
    .map((p) => ({ ...p, ...localScore(p, ctx) }))
    .sort(byScore)
    .slice(0, CANDIDATES);

  // Ratings are only on getPlace(), so look them up for the finalists and score again.
  const detailed = await Promise.all(
    ranked.map(async (p) => {
      try {
        const full = await getPlace(p.id);
        return { ...full, ...localScore(full, ctx) };
      } catch {
        return p;
      }
    }),
  );
  detailed.sort(byScore);

  // Spread across neighborhoods first, then fill up with whatever scored best.
  const picks = [];
  const usedHoods = new Set();
  for (const p of detailed) {
    if (picks.length === limit) break;
    const hood = p.neighborhood?.id;
    if (hood && usedHoods.has(hood)) continue;
    if (hood) usedHoods.add(hood);
    picks.push(p);
  }
  for (const p of detailed) {
    if (picks.length === limit) break;
    if (!picks.includes(p)) picks.push(p);
  }
  return picks;
}

/*
  Signals worth adding once the backend can supply them:
  - How many Chowdex users have logged the place, and their average rating (our own data, no licensing).
  - Whether it is independently owned (OpenStreetMap's `operator`/`brand` tags, or a curated flag).
  - How new it is (OpenStreetMap's `start_date`, or when it first appeared in a seed).
*/
