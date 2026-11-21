/**
 * The data layer. UI code imports ONLY from this file and never talks to
 * Supabase directly. Shapes are documented in docs/schema.md.
 *
 * VITE_USE_MOCK=true  (default) -> in-memory mock data + localStorage, no backend needed
 * VITE_USE_MOCK=false           -> real Supabase backend (src/lib/supabaseApi.js); needs
 *                                  VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 *
 * Changing a function name or return shape here affects everyone: tell the team first.
 */
import rawPlaces from './mock/places.json';
import pets from './mock/pets.json';
import mbta from './mock/mbta.json';
import neighborhoods from './mock/neighborhoods.json';
import { createPetEngine, DAILY_FEED_LIMIT, PET_LEVEL_XP, PET_MAX_LEVEL, petLevelFromXp, localParts } from './mock/petEngine.js';
import { createSupabaseApi } from './supabaseApi.js';
import { planDirections } from './directions.js';
import { arrivalsQuery, parseArrivals } from './mbtaLive.js';
import { addTripFromRoute, listTrips, removeTrip, tallyTrips } from './trips.js';

export { DAILY_FEED_LIMIT, PET_LEVEL_XP, PET_MAX_LEVEL, petLevelFromXp };

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
 * @property {{id: string, name: string}|null} neighborhood   which of the 24 areas it is in (a neighborhood id, see getNeighborhoods())
 * @property {PlaceDetails} [details]          present ONLY on getPlace(), never in getPlaces()
 */

/**
 * @typedef {Object} DexEntry
 * @property {string}      id
 * @property {string}      place_id
 * @property {string|null} favorite_dish
 * @property {number|null} my_rating     1 to 5, the user's own rating
 * @property {string|null} photo_url
 * @property {string|null} note          free-text journal note, up to 280 characters
 * @property {string}      visited_at    ISO timestamp
 *
 * Only on the result of addToDex() (what logging this meal did):
 * @property {boolean}     [fed]          false when the pets were already full for the day (the meal is logged, but gives no XP)
 * @property {number}      [xp_gained]
 * @property {Pet|null}    [unlocked_pet] the pet this entry just unlocked, if any
 * @property {{pet_id: string, from: number, to: number}[]} [level_ups]
 * @property {{badge_id: string, name: string, tier: number, tier_label: string, pet_id: string}[]} [new_badges]
 */

/**
 * @typedef {Object} FeedingStatus
 * @property {number}  daily_limit   meals per day that feed the pets (DAILY_FEED_LIMIT)
 * @property {number}  meals_today   meals logged today, Boston time
 * @property {number}  fed_today     min(meals_today, daily_limit)
 * @property {number}  remaining     feedings left today
 * @property {boolean} full          the pets are full: more meals are logged but give no XP
 */

/**
 * @typedef {Object} Badge
 * @property {string}      id
 * @property {string}      name
 * @property {string}      description
 * @property {'visits'|'places'|'time'|'journal'|'variety'|'transit'|'neighborhood'} category
 * @property {string}      pet_id          the pet that wears it: a neighborhood pet for neighborhood badges, otherwise "starter"
 * @property {number[]}    tiers           what you need for each tier, e.g. [5, 12, 25]
 * @property {string[]}    tier_labels     "Earned", or "Bronze"/"Silver"/"Gold"
 * @property {number}      tier            tiers earned so far (0 = not earned)
 * @property {boolean}     earned          tier > 0
 * @property {number}      value           progress toward the next target
 * @property {number|null} next_target     null when every tier is earned
 * @property {(string|null)[]} tier_earned_at   ISO time each tier was earned, null if not yet
 */

/**
 * One thing in a pet's story.
 * @typedef {Object} PetHistoryEvent
 * @property {'unlocked'|'fed'|'full'|'level_up'|'badge'} type
 *           unlocked: the pet joined; fed: a meal fed it; full: a meal was logged but the pets were full that day;
 *           level_up: it reached a level; badge: it earned a badge (or the next tier)
 * @property {string}      pet_id
 * @property {string}      at          ISO time
 * @property {string}      text        a ready-to-show sentence
 * @property {string}      entry_id    the journal entry that caused it
 * @property {{id: string, name: string}|null} place
 * @property {number}      [xp]        fed / full
 * @property {number}      [level]     level_up: the new level
 * @property {number}      [from]      level_up: the old level
 * @property {string}      [badge_id]  badge
 * @property {number}      [tier]      badge
 */

/**
 * @typedef {Object} PetJournal   the food journal as one pet sees it (the starter sees every meal)
 * @property {string} pet_id
 * @property {(DexEntry & {place: {id: string, name: string, cuisine: string, price_level: number|null, neighborhood: {id: string, name: string}|null}, fed: boolean, xp_gained: number})[]} entries   newest first
 * @property {{meals: number, photos: number, rated: number, average_rating: number|null,
 *             top_cuisines: {cuisine: string, count: number}[], recent_dishes: string[],
 *             first_meal_at: string|null, last_meal_at: string|null}} stats
 */

/**
 * @typedef {Object} Profile
 * @property {string} id
 * @property {string} display_name
 * @property {string} pet_name           display name (nickname or animal) of the active pet
 * @property {string} active_pet_id
 * @property {number} xp                 trainer XP: all dex entries
 * @property {number} level              derived from xp, see levelFromXp()
 */

/**
 * One of the 25 pets: a pet for each of the 24 neighborhoods, plus the starter (Boston Terrier).
 * @typedef {Object} Pet
 * @property {string}      id               the neighborhood id it lives in, e.g. "allston"; "starter" for the Boston Terrier
 * @property {string}      name             the animal, e.g. "Raccoon" (pets have no preset names)
 * @property {string|null} nickname         the name the user gave it, if any
 * @property {string}      display_name     nickname ?? name
 * @property {string}      image            512x512 transparent PNG, e.g. "/pets/png/allston.png"
 * @property {string}      svg              the same art as SVG
 * @property {{id: string, name: string}|null} neighborhood   null for the starter
 * @property {boolean}     is_starter
 * @property {boolean}     unlocked         the starter is always unlocked; the rest unlock on your first dex entry in their neighborhood
 * @property {string|null} unlocked_at      ISO time of your first entry there, null if locked or the starter
 * @property {number}      entries          meals logged in the pet's neighborhood (all meals for the starter), fed or not
 * @property {number}      xp               XP from the meals that fed it (at most DAILY_FEED_LIMIT meals a day count)
 * @property {number}      level            0 to max_level, see petLevelFromXp()
 * @property {number}      max_level        5: a pet is fully grown there, about 9 meals
 * @property {number|null} next_level_xp    total XP needed for the next level, null at the max level
 * @property {{id: string, name: string, tier: number, tier_label: string}[]} badges   badges this pet wears
 * @property {boolean}     active           whether it is the pet shown on the dashboard
 */

/**
 * @typedef {Object} NeighborhoodProgress
 * @property {string}  id
 * @property {string}  name
 * @property {'Boston'|'Cambridge'} city
 * @property {string}  color
 * @property {number}  entries   dex entries in this neighborhood
 * @property {boolean} visited
 * @property {string}  pet_id    the pet that lives here
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

/**
 * @typedef {Object} Station
 * @property {string}   id      MBTA stop id, e.g. "place-chncl"
 * @property {string}   name
 * @property {number}   lat
 * @property {number}   lng
 * @property {string[]} lines   e.g. ["Orange", "Red"]
 */

/**
 * @typedef {Object} Line
 * @property {string}        id            "Red" | "Orange" | "Blue" | "Green"
 * @property {string}        name          e.g. "Red Line"
 * @property {string}        color         hex, the official line color
 * @property {string[]}      station_ids
 * @property {number[][][]}  shapes        polylines as [lng, lat] pairs, ready for GeoJSON
 * @property {string[][]}    shape_routes  shape_routes[i] = ids of the routes (e.g. "Green-B") that run along shapes[i]
 */

/**
 * @typedef {Object} LineProgress
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {number} stamped
 * @property {number} total
 * @property {number} percent   0 to 100, rounded down
 * @property {'none'|'bronze'|'silver'|'gold'} tier
 */

/**
 * One of the 24 areas (23 Boston neighborhoods + Cambridge), as a GeoJSON Feature.
 * @typedef {Object} Neighborhood
 * @property {'Feature'} type
 * @property {{type: 'Polygon'|'MultiPolygon', coordinates: number[][][]|number[][][][]}} geometry
 * @property {{id: string, name: string, city: 'Boston'|'Cambridge', color: string}} properties
 *           `color` is a hex color, unique per neighborhood. Draw it translucent.
 */

/**
 * A subway train. Only trains on the drawn Boston and Cambridge lines are returned.
 * @typedef {Object} Vehicle
 * @property {string}      id
 * @property {string}      line      "Red" | "Orange" | "Green" | "Blue"
 * @property {string}      route     route id, e.g. "Green-B"
 * @property {number}      lat
 * @property {number}      lng
 * @property {number|null} bearing   degrees clockwise from north
 * @property {string|null} status    "IN_TRANSIT_TO" | "STOPPED_AT" | "INCOMING_AT"
 * @property {string|null} label     train number
 */

/**
 * @typedef {Object} VehicleSnapshot
 * @property {Vehicle[]|null} vehicles   null when the live feed could not be reached
 * @property {boolean}        simulated  true when the trains are made up for demos (sped up)
 * @property {boolean}        [error]    true when `vehicles` is null
 * @property {string}         updated_at ISO timestamp
 */

/**
 * One step of a route. `type` is "board" (wait for a train), "ride", "transfer", or "walk".
 * @typedef {Object} DirectionsLeg
 * @property {'board'|'ride'|'transfer'|'walk'} type
 * @property {number} minutes
 * @property {string} [line]          Red, Orange, Blue, Green
 * @property {string} [line_name]     e.g. "Red Line"
 * @property {string} [color]
 * @property {{id?: string, name: string}} [from]
 * @property {{id?: string, name: string}} [to]
 * @property {{id: string, name: string}} [at]   board / transfer: the station
 * @property {number} [stops]         ride: how many stops
 * @property {number} [distance_m]
 * @property {number[][]} [coordinates]   [lng, lat] points to draw
 * @property {'live'|'assumed'} [wait_source]   board: whether the wait comes from the live MBTA feed
 * @property {boolean} [live]         ride: true when the ride time comes from the live feed
 * @property {string} [starts_at]     ISO time this step begins
 * @property {string} [departs_at]    board: ISO time the train leaves
 * @property {boolean} [estimated]    walk: true when the distance is a straight-line estimate, not a routed path
 */

/**
 * @typedef {Object} Directions
 * @property {'transit'|'walk'} mode   "walk" when the restaurant is close enough to just walk
 * @property {{id: string|null, name: string, lat: number, lng: number}} from   where the rider starts ("Your location", or a station; id is null for a position)
 * @property {{id: string, name: string, lat: number, lng: number}} to     the restaurant
 * @property {DirectionsLeg[]} legs
 * @property {{minutes: number, transit_miles: number, walk_miles: number, miles: number}} totals
 * @property {{miles: number, minutes: number, estimated: boolean}} car   the same trip by car (no traffic or parking)
 * @property {{car_kg: number, transit_kg: number, saved_kg: number, percent: number}} emissions   estimated CO2, see carbon.js
 * @property {boolean} live   true when the first train's wait and ride time come from the live MBTA feed
 * @property {string} depart_at   ISO time the trip starts (now)
 * @property {string} arrive_at   ISO time you get there: the ETA, built from the live times where there are any
 */

/**
 * A trip the rider chose to log.
 * @typedef {Object} Trip
 * @property {string} id
 * @property {string} at           ISO time it was logged
 * @property {string} place_id
 * @property {string} place_name
 * @property {string} from_name
 * @property {'transit'|'walk'} mode
 * @property {number} transit_miles
 * @property {number} walk_miles
 * @property {number} car_miles    what driving would have been
 * @property {number} co2_kg
 * @property {number} co2_saved_kg
 * @property {number} minutes
 */

/**
 * @typedef {Object} TripTally
 * @property {number} trips
 * @property {number} miles                miles travelled by train and on foot
 * @property {number} transit_miles
 * @property {number} walk_miles
 * @property {number} car_miles_avoided
 * @property {number} co2_saved_kg
 * @property {number} co2_kg
 */

/**
 * @typedef {Object} StampSummary
 * @property {Object<string, string[]>} by_station   station id -> ids of the dex places that stamped it;
 *                                                    only stamped stations appear
 * @property {LineProgress[]} lines
 * @property {number} stamped_total                  unique stations stamped
 * @property {number} station_total
 */

/* ---------------------------------------------------------------------------
 * Shared game rules (the real backend trigger must use the same numbers)
 * ------------------------------------------------------------------------- */

/** A station is stamped when any of the user's dex places is within this many meters of it. */
export const STAMP_RADIUS_M = 400;

/** Line badge tiers by percent of the line's stations stamped. */
export function tierFromPercent(percent) {
  if (percent >= 100) return 'gold';
  if (percent >= 50) return 'silver';
  if (percent >= 25) return 'bronze';
  return 'none';
}

export const XP_PER_ENTRY = 10;
export const XP_PHOTO_BONUS = 5;

/** level = floor(sqrt(xp / 10)): 0 xp = L0, 10 = L1, 40 = L2, 90 = L3, ... */
export function levelFromXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 10));
}

/** Total XP at which a trainer level starts: the inverse of levelFromXp(). */
export function xpForLevel(level) {
  return 10 * level * level;
}


/* ---------------------------------------------------------------------------
 * Errors. Real and mock implementations throw errors with these codes.
 * ------------------------------------------------------------------------- */

function apiError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}
// Codes: 'NOT_SIGNED_IN' | 'NOT_FOUND' | 'ALREADY_IN_DEX' | 'NOT_UNLOCKED' | 'INVALID'

/* ---------------------------------------------------------------------------
 * Mock implementation
 * ------------------------------------------------------------------------- */

const DEX_KEY = 'bostonhacks.mock.dex';
const SIGNED_IN_KEY = 'bostonhacks.mock.signedIn';

const MOCK_USER = { id: 'mock-user', email: 'student@example.com', display_name: 'Mock Student' };
const ACTIVE_PET_KEY = 'bostonhacks.mock.activePet';
const PET_NICKNAMES_KEY = 'bostonhacks.mock.petNicknames';

/* Which neighborhood is a point in? (The real backend does this once with a PostGIS join.) */
function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function neighborhoodAt(lng, lat) {
  for (const f of neighborhoods.features) {
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const hit = polygons.some((poly) => inRing(lng, lat, poly[0]) && !poly.slice(1).some((hole) => inRing(lng, lat, hole)));
    if (hit) return { id: f.properties.id, name: f.properties.name };
  }
  return null;
}

/** The mock restaurants, each tagged with the neighborhood it is in. */
const mockPlaces = rawPlaces.map((p) => ({ ...p, neighborhood: neighborhoodAt(p.lng, p.lat) }));
const hoodById = Object.fromEntries(neighborhoods.features.map((f) => [f.properties.id, f.properties]));
const starterPet = pets.find((p) => p.is_starter);

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

function isSignedIn() {
  return readStore(SIGNED_IN_KEY, false) === true;
}

/** Great-circle distance in meters (haversine). */
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Meters per degree at Boston's latitude: accurate enough for city-scale geometry.
const M_PER_DEG_LNG = 82400;
const M_PER_DEG_LAT = 111200;

/** Distance in meters from a point to a polyline of [lng, lat] pairs. */
function distanceToPolylineM(lng, lat, polyline) {
  const px = lng * M_PER_DEG_LNG;
  const py = lat * M_PER_DEG_LAT;
  let best = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const ax = polyline[i][0] * M_PER_DEG_LNG;
    const ay = polyline[i][1] * M_PER_DEG_LAT;
    const dx = polyline[i + 1][0] * M_PER_DEG_LNG - ax;
    const dy = polyline[i + 1][1] * M_PER_DEG_LAT - ay;
    const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

const isNearDrawnLines = (lng, lat, maxM = 300) =>
  mbta.lines.some((line) => line.shapes.some((shape) => distanceToPolylineM(lng, lat, shape) <= maxM));

/** Total length of a polyline in meters. */
function polylineLengthM(polyline) {
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    total += Math.hypot(
      (polyline[i + 1][0] - polyline[i][0]) * M_PER_DEG_LNG,
      (polyline[i + 1][1] - polyline[i][1]) * M_PER_DEG_LAT,
    );
  }
  return total;
}

/** The point `distM` meters along a polyline, with the heading there. Returns [lng, lat, bearing]. */
function pointAlong(polyline, distM) {
  let remaining = distM;
  for (let i = 0; i < polyline.length - 1; i++) {
    const dx = (polyline[i + 1][0] - polyline[i][0]) * M_PER_DEG_LNG;
    const dy = (polyline[i + 1][1] - polyline[i][1]) * M_PER_DEG_LAT;
    const len = Math.hypot(dx, dy);
    if (remaining <= len || i === polyline.length - 2) {
      const t = len === 0 ? 0 : Math.min(1, remaining / len);
      return [
        polyline[i][0] + (polyline[i + 1][0] - polyline[i][0]) * t,
        polyline[i][1] + (polyline[i + 1][1] - polyline[i][1]) * t,
        (Math.atan2(dx, dy) * 180) / Math.PI + (dx < 0 ? 360 : 0),
      ];
    }
    remaining -= len;
  }
  return [...polyline[0], 0];
}

/**
 * Made-up trains for demos and for when the live feed is unreachable: a few per line shape,
 * shuttling back and forth, deliberately faster than real trains so the motion is easy to see.
 */
function simulateVehicles(now = Date.now()) {
  const trains = [];
  for (const line of mbta.lines) {
    line.shapes.forEach((shape, shapeIndex) => {
      const total = polylineLengthM(shape);
      const count = Math.max(2, Math.round(total / 3500));
      for (let k = 0; k < count; k++) {
        const phase = (now / 600000 + k / count + shapeIndex * 0.13) % 1; // one round trip per 10 minutes
        const progress = phase < 0.5 ? phase * 2 : 2 - phase * 2;
        const [lng, lat, bearing] = pointAlong(shape, progress * total);
        trains.push({
          id: `sim-${line.id}-${shapeIndex}-${k}`,
          route: line.shape_routes?.[shapeIndex]?.[0] ?? line.id,
          line: line.id,
          lat,
          lng,
          bearing: phase < 0.5 ? bearing : (bearing + 180) % 360,
          status: 'IN_TRANSIT_TO',
          label: null,
        });
      }
    });
  }
  return trains;
}

const VEHICLES_QUERY = 'vehicles?filter%5Broute%5D=Red,Orange,Blue,Green-B,Green-C,Green-D,Green-E';

/**
 * Tries the dev-server proxy first (it adds our MBTA API key, so the key stays out of the browser),
 * then the public API directly, which works without a key at a lower rate limit.
 */
async function fetchMbtaJson(query) {
  for (const base of ['/mbta/', 'https://api-v3.mbta.com/']) {
    try {
      const res = await fetch(base + query);
      if (!res.ok) continue;
      const json = await res.json(); // a host that serves index.html for /mbta/ fails here and moves on
      if (Array.isArray(json.data)) return json;
    } catch {
      // try the next source
    }
  }
  throw new Error('MBTA feed unreachable');
}

const fetchVehicleJson = () => fetchMbtaJson(VEHICLES_QUERY);

/** The stamp rule: station id -> ids of the given places within STAMP_RADIUS_M of it. */
function stampsFor(visitedPlaces) {
  const by_station = {};
  for (const st of mbta.stations) {
    const hits = visitedPlaces
      .filter((p) => distanceM(p.lat, p.lng, st.lat, st.lng) <= STAMP_RADIUS_M)
      .map((p) => p.id);
    if (hits.length) by_station[st.id] = hits;
  }
  return by_station;
}

/** XP one fed meal is worth. (Meals past the daily limit are worth nothing: see petEngine.js.) */
const entryXp = (e) => XP_PER_ENTRY + (e.photo_url ? XP_PHOTO_BONUS : 0);
const neighborhoodOfEntry = (e) => mockPlaces.find((p) => p.id === e.place_id)?.neighborhood?.id ?? null;
const cleanNote = (n) => String(n ?? '').trim().slice(0, 280) || null;

/** ISO time for `daysAgo` days back at hour:minute on the Boston clock (handles daylight saving). */
function bostonTime(daysAgo, hour, minute) {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() - daysAgo);
  const guess = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hour + 5, minute));
  const off = localParts(guess.toISOString()).hour - hour; // 0 in winter, 1 in summer
  const shift = ((((off + 12) % 24) + 24) % 24) - 12;
  return new Date(guess.getTime() - shift * 3600000).toISOString();
}

/** Feeding, levels, badges, and history, all derived from the dex. */
const engine = createPetEngine({
  places: mockPlaces,
  pets,
  neighborhoods: neighborhoods.features,
  lines: mbta.lines,
  stampsFor,
  entryXp,
});

/**
 * Every pet's progress, derived from the dex. A neighborhood's pet unlocks with your first entry
 * there and levels with the meals fed there. The starter is always unlocked and eats everywhere.
 * @returns {Pet[]}
 */
function petStates(dex, activeId, analysis = engine.analyze(dex)) {
  const nicknames = readStore(PET_NICKNAMES_KEY, {});
  return pets.map((p) => ({
    ...p,
    nickname: nicknames[p.id] ?? null,
    display_name: nicknames[p.id] ?? p.name,
    neighborhood: p.neighborhood_id ? { id: p.neighborhood_id, name: hoodById[p.neighborhood_id].name } : null,
    ...engine.petStats(analysis, p),
    active: p.id === activeId,
  }));
}

/** The active pet is the one the user picked, as long as it is unlocked; otherwise the starter. */
function activePetId(dex) {
  const saved = readStore(ACTIVE_PET_KEY, null);
  const pick = pets.find((p) => p.id === saved);
  if (!pick || pick.is_starter) return starterPet.id;
  return dex.some((e) => neighborhoodOfEntry(e) === pick.neighborhood_id) ? pick.id : starterPet.id;
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

  /**
   * Upcoming subway trains at a station, from the live MBTA predictions feed (real times, in mock mode too).
   * An empty list means no trains are running (or the feed could not be reached).
   * @param {string} stopId @returns {Promise<Arrival[]>}
   */
  async getArrivals(stopId) {
    if (!mbta.stations.some((s) => s.id === stopId)) return [];
    try {
      return parseArrivals(await fetchMbtaJson(arrivalsQuery(stopId)));
    } catch {
      return [];
    }
  },

  /** @returns {Promise<Line[]>} the four subway lines with colors and map shapes */
  async getRoutes() {
    await delay();
    return mbta.lines;
  },

  /** @returns {Promise<Station[]>} every subway station in Boston and Cambridge */
  async getStations() {
    await delay();
    return mbta.stations;
  },

  /**
   * Where the trains are right now. Mock mode reads the public MBTA vehicles feed directly
   * (no key needed at this rate); the real backend should proxy it through an edge function.
   * @param {{simulate?: boolean}} [options] simulate: skip the live feed and use made-up trains
   * @returns {Promise<VehicleSnapshot>}
   */
  async getVehicles({ simulate = false } = {}) {
    const updated_at = new Date().toISOString();
    if (simulate) return { vehicles: simulateVehicles(), simulated: true, updated_at };
    try {
      const json = await fetchVehicleJson();
      const vehicles = json.data
        .filter((v) => v.attributes.latitude != null && v.attributes.longitude != null)
        .map((v) => {
          const route = v.relationships.route.data.id;
          return {
            id: v.id,
            route,
            line: route.startsWith('Green') ? 'Green' : route,
            lat: v.attributes.latitude,
            lng: v.attributes.longitude,
            bearing: v.attributes.bearing ?? null,
            status: v.attributes.current_status ?? null,
            label: v.attributes.label ?? null,
          };
        })
        .filter((v) => isNearDrawnLines(v.lng, v.lat));
      return { vehicles, simulated: false, updated_at };
    } catch {
      return { vehicles: null, simulated: false, error: true, updated_at };
    }
  },

  /** @returns {Promise<{type: 'FeatureCollection', features: Neighborhood[]}>} the 24 neighborhood areas */
  async getNeighborhoods() {
    await delay();
    return { type: 'FeatureCollection', features: neighborhoods.features };
  },

  /**
   * Station stamps: a station is stamped when a place in the user's dex is within
   * STAMP_RADIUS_M of it. Derived from the dex, nothing extra is stored.
   * @returns {Promise<StampSummary>} all zeros when signed out
   */
  async getStamps() {
    await delay();
    const dex = isSignedIn() ? readStore(DEX_KEY, []) : [];
    const dexPlaces = dex
      .map((e) => mockPlaces.find((p) => p.id === e.place_id))
      .filter(Boolean);

    const by_station = stampsFor(dexPlaces);

    const lines = mbta.lines.map((l) => {
      const total = l.station_ids.length;
      const stamped = l.station_ids.filter((id) => by_station[id]).length;
      const percent = total ? Math.floor((100 * stamped) / total) : 0;
      return { id: l.id, name: l.name, color: l.color, stamped, total, percent, tier: tierFromPercent(percent) };
    });

    return {
      by_station,
      lines,
      stamped_total: Object.keys(by_station).length,
      station_total: mbta.stations.length,
    };
  },

  /** @returns {Promise<DexEntry[]>} empty array when signed out */
  async getDex() {
    await delay();
    if (!isSignedIn()) return [];
    return readStore(DEX_KEY, []);
  },

  /**
   * All 25 pets with their progress. Signed out: only the starter is unlocked.
   * @returns {Promise<Pet[]>}
   */
  async getPets() {
    await delay();
    const dex = isSignedIn() ? readStore(DEX_KEY, []) : [];
    return petStates(dex, activePetId(dex));
  },

  /**
   * Choose which unlocked pet shows on the dashboard.
   * @param {string} petId
   * @returns {Promise<Pet>}
   * @throws NOT_SIGNED_IN, NOT_FOUND, or NOT_UNLOCKED
   */
  async setActivePet(petId) {
    await delay();
    if (!isSignedIn()) throw apiError('NOT_SIGNED_IN', 'Sign in to choose a pet');
    const dex = readStore(DEX_KEY, []);
    const pet = petStates(dex, null).find((p) => p.id === petId);
    if (!pet) throw apiError('NOT_FOUND', `Pet not found: ${petId}`);
    if (!pet.unlocked) throw apiError('NOT_UNLOCKED', `${pet.name} is not unlocked yet. Visit ${pet.neighborhood.name} to unlock it.`);
    writeStore(ACTIVE_PET_KEY, petId);
    return { ...pet, active: true };
  },

  /**
   * Give an unlocked pet a nickname (up to 24 characters). An empty nickname clears it.
   * @param {string} petId
   * @param {string} nickname
   * @returns {Promise<Pet>}
   * @throws NOT_SIGNED_IN, NOT_FOUND, or NOT_UNLOCKED
   */
  async setPetNickname(petId, nickname) {
    await delay();
    if (!isSignedIn()) throw apiError('NOT_SIGNED_IN', 'Sign in to name a pet');
    const dex = readStore(DEX_KEY, []);
    const pet = petStates(dex, null).find((p) => p.id === petId);
    if (!pet) throw apiError('NOT_FOUND', `Pet not found: ${petId}`);
    if (!pet.unlocked) throw apiError('NOT_UNLOCKED', `${pet.name} is not unlocked yet`);
    const clean = String(nickname ?? '').trim().slice(0, 24);
    const all = readStore(PET_NICKNAMES_KEY, {});
    if (clean) all[petId] = clean;
    else delete all[petId];
    writeStore(PET_NICKNAMES_KEY, all);
    return petStates(dex, activePetId(dex)).find((p) => p.id === petId);
  },

  /**
   * How far along each of the 24 neighborhoods the user is.
   * @returns {Promise<NeighborhoodProgress[]>} sorted by name
   */
  async getNeighborhoodProgress() {
    await delay();
    const dex = isSignedIn() ? readStore(DEX_KEY, []) : [];
    const counts = {};
    for (const e of dex) {
      const id = neighborhoodOfEntry(e);
      if (id) counts[id] = (counts[id] ?? 0) + 1;
    }
    return neighborhoods.features
      .map((f) => ({
        id: f.properties.id,
        name: f.properties.name,
        city: f.properties.city,
        color: f.properties.color,
        entries: counts[f.properties.id] ?? 0,
        visited: Boolean(counts[f.properties.id]),
        pet_id: pets.find((p) => p.neighborhood_id === f.properties.id).id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  /**
   * Log a meal in the food journal. It feeds the pets (the starter, and the pet of the neighborhood
   * the place is in), unless the pets are already full for the day (DAILY_FEED_LIMIT meals).
   * @param {string} placeId
   * @param {{favoriteDish?: string, myRating?: number, note?: string, photo?: File}} [extra]
   * @returns {Promise<DexEntry>} the entry plus what it did: `fed`, `xp_gained`, `unlocked_pet`, `level_ups`, `new_badges`
   * @throws NOT_SIGNED_IN, NOT_FOUND, or ALREADY_IN_DEX
   */
  async addToDex(placeId, { favoriteDish = null, myRating = null, note = null, photo = null } = {}) {
    await delay();
    if (!isSignedIn()) throw apiError('NOT_SIGNED_IN', 'Sign in to add to your dex');
    const place = mockPlaces.find((p) => p.id === placeId);
    if (!place) throw apiError('NOT_FOUND', `Place not found: ${placeId}`);
    const dex = readStore(DEX_KEY, []);
    if (dex.some((e) => e.place_id === placeId)) {
      throw apiError('ALREADY_IN_DEX', 'This place is already in your dex');
    }
    const entry = {
      id: `dex-${Date.now()}`,
      place_id: placeId,
      favorite_dish: favoriteDish,
      my_rating: myRating,
      note: cleanNote(note),
      photo_url: photo ? await fileToDataUrl(photo) : null,
      visited_at: new Date().toISOString(),
    };
    const nextDex = [...dex, entry];
    writeStore(DEX_KEY, nextDex);

    // Work out what this meal did.
    const after = engine.analyze(nextDex);
    const info = after.entryInfo[entry.id];
    const mine = after.events.filter((ev) => ev.entry_id === entry.id);
    const unlocked = mine.find((ev) => ev.type === 'unlocked');
    return {
      ...entry,
      fed: info.fed,
      xp_gained: info.xp,
      unlocked_pet: unlocked ? petStates(nextDex, activePetId(nextDex), after).find((p) => p.id === unlocked.pet_id) : null,
      level_ups: mine.filter((ev) => ev.type === 'level_up').map((ev) => ({ pet_id: ev.pet_id, from: ev.from, to: ev.level })),
      new_badges: mine
        .filter((ev) => ev.type === 'badge')
        .map((ev) => {
          const b = engine.badgeDefById.get(ev.badge_id);
          return { badge_id: b.id, name: b.name, tier: ev.tier, tier_label: b.tier_labels[ev.tier - 1], pet_id: ev.pet_id };
        }),
    };
  },

  /**
   * Edit a journal entry after the fact: dish, rating, note, or photo. Pass `null` to clear a field.
   * (Adding a photo later earns the photo bonus only if that meal was fed.)
   * @param {string} entryId
   * @param {{favoriteDish?: string|null, myRating?: number|null, note?: string|null, photo?: File|null}} patch
   * @returns {Promise<DexEntry>}
   * @throws NOT_SIGNED_IN, NOT_FOUND, or INVALID
   */
  async updateDexEntry(entryId, { favoriteDish, myRating, note, photo } = {}) {
    await delay();
    if (!isSignedIn()) throw apiError('NOT_SIGNED_IN', 'Sign in to edit your journal');
    const dex = readStore(DEX_KEY, []);
    const index = dex.findIndex((e) => e.id === entryId);
    if (index === -1) throw apiError('NOT_FOUND', `Journal entry not found: ${entryId}`);
    const next = { ...dex[index] };
    if (favoriteDish !== undefined) next.favorite_dish = String(favoriteDish ?? '').trim().slice(0, 80) || null;
    if (myRating !== undefined) {
      if (myRating !== null && !(myRating >= 1 && myRating <= 5)) throw apiError('INVALID', 'Rating must be 1 to 5');
      next.my_rating = myRating;
    }
    if (note !== undefined) next.note = cleanNote(note);
    if (photo !== undefined) next.photo_url = photo ? await fileToDataUrl(photo) : null;
    dex[index] = next;
    writeStore(DEX_KEY, dex);
    return next;
  },

  /**
   * Remove a journal entry. Everything derived from it (XP, levels, badges, history, an unlocked
   * pet whose only meal it was) is recalculated, so this takes that meal's progress with it.
   * @param {string} entryId
   * @returns {Promise<void>}
   * @throws NOT_SIGNED_IN or NOT_FOUND
   */
  async deleteDexEntry(entryId) {
    await delay();
    if (!isSignedIn()) throw apiError('NOT_SIGNED_IN', 'Sign in to edit your journal');
    const dex = readStore(DEX_KEY, []);
    if (!dex.some((e) => e.id === entryId)) throw apiError('NOT_FOUND', `Journal entry not found: ${entryId}`);
    writeStore(DEX_KEY, dex.filter((e) => e.id !== entryId));
  },

  /**
   * Recent happenings across all pets, newest first, in one call (feeds, joins, level-ups, badges).
   * Each meal appears once per pet it fed; filter by `pet_id` to pick a view.
   * @param {{limit?: number}} [options]
   * @returns {Promise<PetHistoryEvent[]>}
   */
  async getActivity({ limit = 40 } = {}) {
    await delay();
    const dex = isSignedIn() ? readStore(DEX_KEY, []) : [];
    return engine
      .analyze(dex)
      .events.sort((a, b) => b.at.localeCompare(a.at) || b.seq - a.seq)
      .slice(0, limit)
      .map(({ seq, ...event }) => event);
  },

  /**
   * Are the pets full for today? Boston time. Meals past the limit are still logged, they just
   * give no XP, so nobody needs to eat out more to keep up.
   * @returns {Promise<FeedingStatus>}
   */
  async getFeedingStatus() {
    await delay();
    const dex = isSignedIn() ? readStore(DEX_KEY, []) : [];
    const today = localParts(new Date().toISOString()).day;
    const meals = dex.filter((e) => localParts(e.visited_at).day === today).length;
    return {
      daily_limit: DAILY_FEED_LIMIT,
      meals_today: meals,
      fed_today: Math.min(meals, DAILY_FEED_LIMIT),
      remaining: Math.max(0, DAILY_FEED_LIMIT - meals),
      full: meals >= DAILY_FEED_LIMIT,
    };
  },

  /**
   * Every badge with the user's progress. Neighborhood badges are worn by that neighborhood's pet;
   * the rest are worn by the starter.
   * @returns {Promise<Badge[]>}
   */
  async getBadges() {
    await delay();
    const dex = isSignedIn() ? readStore(DEX_KEY, []) : [];
    return engine.badgeList(engine.analyze(dex));
  },

  /**
   * A pet's story, newest first: when it joined, each meal it was fed, level-ups, and badges.
   * @param {string} petId
   * @returns {Promise<PetHistoryEvent[]>} empty for a locked pet or when signed out
   * @throws NOT_FOUND
   */
  async getPetHistory(petId) {
    await delay();
    if (!pets.some((p) => p.id === petId)) throw apiError('NOT_FOUND', `Pet not found: ${petId}`);
    const dex = isSignedIn() ? readStore(DEX_KEY, []) : [];
    return engine
      .analyze(dex)
      .events.filter((ev) => ev.pet_id === petId)
      .sort((a, b) => b.at.localeCompare(a.at) || b.seq - a.seq)
      .map(({ seq, ...event }) => event);
  },

  /**
   * The food journal as one pet sees it: the meals that fed it, with the place, the dish, and how
   * much XP each gave. The starter sees every meal; a neighborhood pet sees meals in its neighborhood.
   * @param {string} petId
   * @returns {Promise<PetJournal>}
   * @throws NOT_FOUND
   */
  async getPetJournal(petId) {
    await delay();
    const pet = pets.find((p) => p.id === petId);
    if (!pet) throw apiError('NOT_FOUND', `Pet not found: ${petId}`);
    const dex = isSignedIn() ? readStore(DEX_KEY, []) : [];
    const analysis = engine.analyze(dex);
    const entries = [...dex]
      .filter((e) => pet.is_starter || neighborhoodOfEntry(e) === pet.neighborhood_id)
      .sort((a, b) => b.visited_at.localeCompare(a.visited_at))
      .map((e) => {
        const p = mockPlaces.find((x) => x.id === e.place_id);
        const info = analysis.entryInfo[e.id];
        return {
          ...e,
          place: { id: p.id, name: p.name, cuisine: p.cuisine, price_level: p.price_level, neighborhood: p.neighborhood },
          fed: info.fed,
          xp_gained: info.xp,
        };
      });

    const ratings = entries.map((e) => e.my_rating).filter(Boolean);
    const cuisineCounts = {};
    for (const e of entries) cuisineCounts[e.place.cuisine] = (cuisineCounts[e.place.cuisine] ?? 0) + 1;
    const stats = {
      meals: entries.length,
      photos: entries.filter((e) => e.photo_url).length,
      rated: ratings.length,
      average_rating: ratings.length ? Math.round((10 * ratings.reduce((a, b) => a + b, 0)) / ratings.length) / 10 : null,
      top_cuisines: Object.entries(cuisineCounts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([cuisine, count]) => ({ cuisine, count })),
      recent_dishes: [...new Set(entries.map((e) => e.favorite_dish).filter(Boolean))].slice(0, 5),
      first_meal_at: entries.length ? entries[entries.length - 1].visited_at : null,
      last_meal_at: entries.length ? entries[0].visited_at : null,
    };
    return { pet_id: petId, entries, stats };
  },

  /** @returns {Promise<Profile|null>} null when signed out */
  async getProfile() {
    await delay();
    if (!isSignedIn()) return null;
    const dex = readStore(DEX_KEY, []);
    const analysis = engine.analyze(dex);
    const xp = analysis.xpBy[starterPet.id] ?? 0; // trainer XP: every fed meal
    const activeId = activePetId(dex);
    return {
      id: MOCK_USER.id,
      display_name: MOCK_USER.display_name,
      pet_name: petStates(dex, activeId, analysis).find((p) => p.id === activeId).display_name,
      active_pet_id: activeId,
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

  /** Mock only: signs in and fills the dex with a few places so the UI has something to show. */
  async loadDemoData() {
    await delay();
    // [place, dish, rating, note, days ago, hour (24h, Boston time), minute]. Spread over days and times, three of them late.
    const demo = [
      ['mock-001', 'Beef pho', 5, 'Best broth near campus.', 8, 12, 30],
      ['mock-004', 'Lobster roll', 5, null, 6, 22, 15],
      ['mock-008', 'Chickpea fritter pita', 4, null, 5, 8, 0],
      ['mock-009', 'Pastrami sandwich', 5, 'Split it with a friend.', 3, 12, 10],
      ['mock-011', 'Shakshuka', 4, null, 2, 22, 40],
      ['mock-012', 'Tasty burger', 4, 'Post-study-session fuel.', 1, 23, 20],
    ];
    writeStore(SIGNED_IN_KEY, true);
    writeStore(
      DEX_KEY,
      demo.map(([place_id, favorite_dish, my_rating, note, daysAgo, hour, minute], i) => ({
        id: `dex-demo-${i}`,
        place_id,
        favorite_dish,
        my_rating,
        note,
        photo_url: null,
        visited_at: bostonTime(daysAgo, hour, minute),
      })),
    );
  },

  /** Mock only: clears the dex and signs out. */
  async resetDemoData() {
    await delay(50);
    writeStore(DEX_KEY, []);
    writeStore(ACTIVE_PET_KEY, null);
    writeStore(PET_NICKNAMES_KEY, {});
    writeStore(SIGNED_IN_KEY, false);
  },
};

/* ---------------------------------------------------------------------------
 * Real implementation (Supabase): src/lib/supabaseApi.js. Only built when VITE_USE_MOCK=false.
 * The map shapes, stations, neighborhoods, and the live train feed are bundled data and stay shared.
 * ------------------------------------------------------------------------- */

const realApi = USE_MOCK
  ? null
  : createSupabaseApi({
      apiError,
      levelFromXp,
      tierFromPercent,
      dailyFeedLimit: DAILY_FEED_LIMIT,
      config: { url: import.meta.env.VITE_SUPABASE_URL, anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      fetchMbta: fetchMbtaJson,
      staticApi: mockApi,
      data: { mbta, neighborhoods, pets },
    });

/** True when running on mock data (no backend). The demo-data buttons only make sense then. */
export const IS_MOCK = USE_MOCK;

/* ---------------------------------------------------------------------------
 * Public API
 * ------------------------------------------------------------------------- */

const base = USE_MOCK ? mockApi : realApi;

/**
 * Directions and the green-trips log work the same in both modes: the route planner runs in the browser on the
 * bundled MBTA data, and the trip log lives in the browser (see src/lib/trips.js).
 */
const greenApi = {
  /**
   * How to get to a restaurant by train and on foot, with real MBTA times for the first train and a carbon
   * comparison against driving. The rider's position stays in the browser; the public walking/driving router only
   * ever sees it blurred to about 100 m.
   * @param {string} placeId
   * @param {{lat: number, lng: number} | {stationId: string}} origin   the rider's current position, or a station
   *        to start from instead (e.g. when location is off): `{ stationId: "place-harsq" }`
   * @returns {Promise<Directions>}
   * @throws NOT_FOUND, INVALID
   */
  async getDirections(placeId, origin) {
    const place = await base.getPlace(placeId);
    try {
      return await planDirections({ mbta, place, origin, fetchMbta: fetchMbtaJson });
    } catch (err) {
      if (err.code === 'NOT_FOUND') throw apiError('NOT_FOUND', err.message);
      if (err.code === 'INVALID') throw apiError('INVALID', err.message);
      throw err;
    }
  },

  /**
   * Record a trip the rider took. Only called when they tap "I took this trip".
   * @param {Directions} route
   * @returns {Promise<Trip>}
   */
  async logTrip(route) {
    return addTripFromRoute(route);
  },

  /** @returns {Promise<Trip[]>} newest first */
  async getTrips() {
    return listTrips();
  },

  /** @throws NOT_FOUND */
  async deleteTrip(tripId) {
    if (!removeTrip(tripId)) throw apiError('NOT_FOUND', `Trip not found: ${tripId}`);
  },

  /** @returns {Promise<TripTally>} */
  async getTripTally() {
    return tallyTrips();
  },
};

const impl = { ...base, ...greenApi };

export const {
  getDirections,
  logTrip,
  getTrips,
  deleteTrip,
  getTripTally,
  getPlaces,
  getPlace,
  getArrivals,
  getRoutes,
  getStations,
  getNeighborhoods,
  getPets,
  setActivePet,
  setPetNickname,
  getFeedingStatus,
  deleteDexEntry,
  getActivity,
  getBadges,
  getPetHistory,
  getPetJournal,
  updateDexEntry,
  getNeighborhoodProgress,
  getVehicles,
  getStamps,
  getDex,
  addToDex,
  getProfile,
  getCurrentUser,
  signInWithGoogle,
  signOut,
  loadDemoData,
  resetDemoData,
} = impl;
