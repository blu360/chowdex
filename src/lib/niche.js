/**
 * Which places count as "niche" and get a star on the map instead of a dot: independent spots that people who
 * have been love, but that are not tourist magnets. All of these must be true:
 *
 *   1. One location. Places that share a name with another one nearby, and the Boston-area originals with
 *      several branches (Tatte, Clover...), are not niche, however good they are.
 *   2. Well loved: a Google rating of at least 4.6.
 *   3. Enough ratings to trust it (at least 40), so a 5.0 from three friends does not count...
 *   4. ...but not a crowd favorite (under 800), because a place with thousands of reviews is already well known.
 *
 * Places with no fresh rating are never starred: a star is a claim, so it needs evidence. On the current data this
 * marks about 1 place in 9. Change the numbers below to make stars rarer or more common.
 */
import { isLocalFavorite } from './chains.js';

export const NICHE = { minRating: 4.6, minReviews: 40, maxReviews: 800 };

/** @param {{name: string}} place  @param {{locations: number, rating?: number|null, rating_count?: number|null}} facts */
export function isNiche(place, { locations, rating = null, rating_count: reviews = null }) {
  if (locations !== 1 || isLocalFavorite(place.name)) return false;
  if (rating == null || reviews == null) return false;
  return rating >= NICHE.minRating && reviews >= NICHE.minReviews && reviews <= NICHE.maxReviews;
}
