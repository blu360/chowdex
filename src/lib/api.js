/**
 * The data layer. UI code imports ONLY from this file and never talks to
 * Supabase directly. Shapes are documented in docs/schema.md.
 *
 * VITE_USE_MOCK=true  (default) -> in-memory mock data + localStorage, no backend needed
 * VITE_USE_MOCK=false           -> real Supabase backend (not implemented yet)
 *
 * Changing a function name or return shape here affects everyone: tell the team first.
 */
import mockPlaces from './mock/places.json';

const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';

/* ---------------------------------------------------------------------------
 * Shapes
 * ------------------------------------------------------------------------- */

/**
 * @typedef {Object} NearestStop
 * @property {string}   id           MBTA stop id, e.g. "place-chncl"
 * @property {string}   name         e.g. "Chinatown"
 * @property {string[]} lines        e.g. ["Orange"], ["Orange", "Red"]
 * @property {number}   distance_m   straight-line distance from the place
 */

/**
 * @typedef {Object} PlaceDetails   Only returned by getPlace(), fetched live (Google Places).
 * @property {number|null}  rating        1.0 to 5.0, null if unrated
 * @property {number|null}  rating_count
 * @property {boolean|null} open_now
 */

/**
 * @typedef {Object} Place
 * @property {string}      id
 * @property {string}      name
 * @property {number}      lat
 * @property {number}      lng
 * @property {string}      cuisine             lowercase, e.g. "pizza"
 * @property {number|null} price_level         1 to 4, null if unknown
 * @property {string|null} opening_hours       OSM opening_hours syntax, null if unknown
 * @property {boolean}     open_late           open past 1am (after the T stops running)
 * @property {string|null} website
 * @property {string|null} google_place_id
 * @property {NearestStop} nearest_stop
 * @property {PlaceDetails} [details]          present ONLY on getPlace(), never in getPlaces()
 */

/**
 * @typedef {Object} DexEntry
 * @property {string}      id
 * @property {string}      place_id
 * @property {string|null} favorite_dish
 * @property {number|null} my_rating     1 to 5, the user's own rating
 * @property {string|null} photo_url
 * @property {string}      visited_at    ISO timestamp
 */

/**
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} display_name
 * @property {string} pet_name
 * @property {number} xp
 * @property {number} level              derived from xp, see levelFromXp()
 */

/**
 * @typedef {Object} User
 * @property {string} id
 * @property {string} email
 * @property {string} display_name
 */

/**
 * @typedef {Object} Arrival
 * @property {string} route        e.g. "Orange Line"
 * @property {string} direction    e.g. "Forest Hills"
 * @property {number} minutes      minutes until arrival
 */

/**
 * @typedef {Object} PlaceFilters
 * @property {string}          [query]      case-insensitive name match
 * @property {string|string[]} [cuisine]
 * @property {number}          [maxPrice]   1 to 4
 * @property {string}          [line]       "Red" | "Orange" | "Green" | "Blue"
 * @property {boolean}         [openLate]   only places open past 1am
 * @property {{south:number, west:number, north:number, east:number}} [bounds]
 */

/* ---------------------------------------------------------------------------
 * Shared game rules (the real backend trigger must use the same numbers)
 * ------------------------------------------------------------------------- */

export const XP_PER_ENTRY = 10;
export const XP_PHOTO_BONUS = 5;

/** level = floor(sqrt(xp / 10)): 0 xp = L0, 10 = L1, 40 = L2, 90 = L3, ... */
export function levelFromXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 10));
}

/* ---------------------------------------------------------------------------
 * Errors. Real and mock implementations throw errors with these codes.
 * ------------------------------------------------------------------------- */

function apiError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}
// Codes: 'NOT_SIGNED_IN' | 'NOT_FOUND' | 'ALREADY_IN_DEX'

/* ---------------------------------------------------------------------------
 * Mock implementation
 * ------------------------------------------------------------------------- */

const DEX_KEY = 'bostonhacks.mock.dex';
const SIGNED_IN_KEY = 'bostonhacks.mock.signedIn';

const MOCK_USER = { id: 'mock-user', email: 'student@example.com', display_name: 'Mock Student' };
const MOCK_PET_NAME = 'Mochi';

// Simulated latency so the UI has to handle loading states.
const delay = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable: mock data just will not persist
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const stripDetails = ({ details, ...place }) => place;

const MOCK_DIRECTIONS = {
  Red: ['Alewife', 'Braintree'],
  Orange: ['Oak Grove', 'Forest Hills'],
  Green: ['Westbound', 'Lechmere'],
  Blue: ['Bowdoin', 'Wonderland'],
};

function isSignedIn() {
  return readStore(SIGNED_IN_KEY, false) === true;
}

const mockApi = {
  /** @param {PlaceFilters} [filters] @returns {Promise<Place[]>} */
  async getPlaces(filters = {}) {
    await delay();
    const { query, cuisine, maxPrice, line, openLate, bounds } = filters;
    const cuisines = cuisine ? [].concat(cuisine) : null;
    const q = query ? query.trim().toLowerCase() : '';

    return mockPlaces
      .filter((p) => {
        if (q && !p.name.toLowerCase().includes(q)) return false;
        if (cuisines && !cuisines.includes(p.cuisine)) return false;
        if (maxPrice && p.price_level != null && p.price_level > maxPrice) return false;
        if (line && !p.nearest_stop.lines.includes(line)) return false;
        if (openLate && !p.open_late) return false;
        if (bounds) {
          if (p.lat < bounds.south || p.lat > bounds.north) return false;
          if (p.lng < bounds.west || p.lng > bounds.east) return false;
        }
        return true;
      })
      .map(stripDetails);
  },

  /** @param {string} id @returns {Promise<Place>} includes `details` */
  async getPlace(id) {
    await delay();
    const place = mockPlaces.find((p) => p.id === id);
    if (!place) throw apiError('NOT_FOUND', `Place not found: ${id}`);
    return place;
  },

  /** @param {string} stopId @returns {Promise<Arrival[]>} */
  async getArrivals(stopId) {
    await delay();
    const match = mockPlaces.find((p) => p.nearest_stop.id === stopId);
    if (!match) return [];
    const arrivals = [];
    match.nearest_stop.lines.forEach((lineName, i) => {
      (MOCK_DIRECTIONS[lineName] || []).forEach((direction, j) => {
        arrivals.push({
          route: `${lineName} Line`,
          direction,
          minutes: 2 + ((i * 3 + j * 4 + stopId.length) % 9),
        });
      });
    });
    return arrivals.sort((a, b) => a.minutes - b.minutes);
  },

  /** @returns {Promise<DexEntry[]>} empty array when signed out */
  async getDex() {
    await delay();
    if (!isSignedIn()) return [];
    return readStore(DEX_KEY, []);
  },

  /**
   * @param {string} placeId
   * @param {{favoriteDish?: string, myRating?: number, photo?: File}} [extra]
   * @returns {Promise<DexEntry>}
   */
  async addToDex(placeId, { favoriteDish = null, myRating = null, photo = null } = {}) {
    await delay();
    if (!isSignedIn()) throw apiError('NOT_SIGNED_IN', 'Sign in to add to your dex');
    if (!mockPlaces.some((p) => p.id === placeId)) {
      throw apiError('NOT_FOUND', `Place not found: ${placeId}`);
    }
    const dex = readStore(DEX_KEY, []);
    if (dex.some((e) => e.place_id === placeId)) {
      throw apiError('ALREADY_IN_DEX', 'This place is already in your dex');
    }
    const entry = {
      id: `dex-${Date.now()}`,
      place_id: placeId,
      favorite_dish: favoriteDish,
      my_rating: myRating,
      photo_url: photo ? await fileToDataUrl(photo) : null,
      visited_at: new Date().toISOString(),
    };
    writeStore(DEX_KEY, [...dex, entry]);
    return entry;
  },

  /** @returns {Promise<Profile|null>} null when signed out */
  async getProfile() {
    await delay();
    if (!isSignedIn()) return null;
    const dex = readStore(DEX_KEY, []);
    const xp = dex.reduce(
      (sum, e) => sum + XP_PER_ENTRY + (e.photo_url ? XP_PHOTO_BONUS : 0),
      0,
    );
    return {
      id: MOCK_USER.id,
      display_name: MOCK_USER.display_name,
      pet_name: MOCK_PET_NAME,
      xp,
      level: levelFromXp(xp),
    };
  },

  /** @returns {Promise<User|null>} */
  async getCurrentUser() {
    await delay(50);
    return isSignedIn() ? MOCK_USER : null;
  },

  async signInWithGoogle() {
    await delay();
    writeStore(SIGNED_IN_KEY, true);
  },

  async signOut() {
    await delay(50);
    writeStore(SIGNED_IN_KEY, false);
  },
};

/* ---------------------------------------------------------------------------
 * Real implementation (Supabase). Backend owner fills this in.
 * ------------------------------------------------------------------------- */

const notImplemented = (name) => async () => {
  throw new Error(`api.${name}() is not implemented for the real backend yet. Set VITE_USE_MOCK=true.`);
};

const realApi = Object.fromEntries(
  Object.keys(mockApi).map((name) => [name, notImplemented(name)]),
);

/* ---------------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------------- */

const impl = USE_MOCK ? mockApi : realApi;

export const {
  getPlaces,
  getPlace,
  getArrivals,
  getDex,
  addToDex,
  getProfile,
  getCurrentUser,
  signInWithGoogle,
  signOut,
} = impl;
