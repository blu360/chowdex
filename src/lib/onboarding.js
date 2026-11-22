/**
 * What the user told us during onboarding (student or not, school or neighborhood), and whether
 * they have been through it.
 *
 * FRONTEND ONLY for now: it is kept in this browser's localStorage, per user id, because the API's
 * Profile has no fields for it yet. When the backend adds something like `profiles.is_student`,
 * `profiles.school_id`, and `profiles.onboarded_at`, read and write those here instead and nothing
 * else in the app needs to change.
 */
const KEY = 'chowdex.onboarding';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
}

/**
 * @typedef {Object} OnboardingAnswers
 * @property {boolean} done
 * @property {boolean} [skipped]
 * @property {boolean|null} [student]
 * @property {string|null} [schoolId]   an id from features/onboarding/schools.js
 * @property {string|null} [hoodId]     a neighborhood id, for people without a listed school
 * @property {string} [at]              ISO time
 */

/** @returns {OnboardingAnswers|null} */
export function loadOnboarding(userId) {
  return readAll()[userId] ?? null;
}

/** @param {string} userId @param {OnboardingAnswers} answers */
export function saveOnboarding(userId, answers) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [userId]: { ...answers, at: new Date().toISOString() } }));
  } catch {
    // storage unavailable: they will simply be asked again next time
  }
}

export function clearOnboarding(userId) {
  try {
    const all = readAll();
    delete all[userId];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // nothing to clear
  }
}

/** Straight-line distance in meters between two things with lat/lng. */
export function distanceM(a, b) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "350 m", "0.8 mi": short enough for a list row. */
export function formatDistance(m) {
  if (m < 160) return `${Math.round(m / 10) * 10} m`;
  const miles = m / 1609.34;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}
