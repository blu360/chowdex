/**
 * The data layer. UI code imports ONLY from this file and never talks to
 * Supabase directly. Shapes are documented in docs/schema.md.
 *
 * VITE_USE_MOCK=true  (default) -> in-memory mock data + localStorage, no backend needed
 * VITE_USE_MOCK=false           -> real Supabase backend (not implemented yet)
 *
 * Changing a function name or return shape here affects everyone: tell the team first.
 */
import rawPlaces from './mock/places.json';
import pets from './mock/pets.json';
import mbta from './mock/mbta.json';
import neighborhoods from './mock/neighborhoods.json';

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
 * @property {string}      visited_at    ISO timestamp
 * @property {Pet|null}    [unlocked_pet] only on the result of addToDex(): the pet this entry just unlocked, if any
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
 * @property {number}      entries          dex entries in the pet's neighborhood (all entries for the starter)
 * @property {number}      xp               XP from those entries
 * @property {number}      level            levelFromXp(xp)
 * @property {number}      next_level_xp    XP needed for the next level
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

/* ---------------------------------------------------------------------------
 * Errors. Real and mock implementations throw errors with these codes.
 * ------------------------------------------------------------------------- */

function apiError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}
// Codes: 'NOT_SIGNED_IN' | 'NOT_FOUND' | 'ALREADY_IN_DEX' | 'NOT_UNLOCKED'

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

const MOCK_DIRECTIONS = {
  Red: ['Alewife', 'Braintree'],
  Orange: ['Oak Grove', 'Forest Hills'],
  Green: ['Westbound', 'Lechmere'],
  Blue: ['Bowdoin', 'Wonderland'],
};

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
async function fetchVehicleJson() {
  for (const base of ['/mbta/', 'https://api-v3.mbta.com/']) {
    try {
      const res = await fetch(base + VEHICLES_QUERY);
      if (!res.ok) continue;
      const json = await res.json(); // a host that serves index.html for /mbta/ fails here and moves on
      if (Array.isArray(json.data)) return json;
    } catch {
      // try the next source
    }
  }
  throw new Error('MBTA vehicles feed unreachable');
}

const entryXp = (e) => XP_PER_ENTRY + (e.photo_url ? XP_PHOTO_BONUS : 0);
const neighborhoodOfEntry = (e) => mockPlaces.find((p) => p.id === e.place_id)?.neighborhood?.id ?? null;

/** XP needed to reach the next level (the inverse of levelFromXp). */
const nextLevelXp = (xp) => (levelFromXp(xp) + 1) ** 2 * 10;

/**
 * Every pet's progress, derived from the dex. A neighborhood's pet unlocks with your first entry
 * there and levels up with the XP from entries there. The starter is always unlocked and levels with
 * all your entries.
 * @returns {Pet[]}
 */
function petStates(dex, activeId) {
  const byHood = {};
  for (const e of dex) {
    const id = neighborhoodOfEntry(e);
    if (!id) continue;
    const slot = (byHood[id] ??= { entries: 0, xp: 0, first: null });
    slot.entries += 1;
    slot.xp += entryXp(e);
    if (!slot.first || e.visited_at < slot.first) slot.first = e.visited_at;
  }
  const totalXp = dex.reduce((sum, e) => sum + entryXp(e), 0);
  const nicknames = readStore(PET_NICKNAMES_KEY, {});

  return pets.map((p) => {
    const slot = p.is_starter ? { entries: dex.length, xp: totalXp, first: null } : byHood[p.neighborhood_id];
    const xp = slot?.xp ?? 0;
    return {
      ...p,
      nickname: nicknames[p.id] ?? null,
      display_name: nicknames[p.id] ?? p.name,
      neighborhood: p.neighborhood_id ? { id: p.neighborhood_id, name: hoodById[p.neighborhood_id].name } : null,
      unlocked: p.is_starter || Boolean(slot),
      unlocked_at: slot?.first ?? null,
      entries: slot?.entries ?? 0,
      xp,
      level: levelFromXp(xp),
      next_level_xp: nextLevelXp(xp),
      active: p.id === activeId,
    };
  });
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

  /** @param {string} stopId @returns {Promise<Arrival[]>} */
  async getArrivals(stopId) {
    await delay();
    const station = mbta.stations.find((s) => s.id === stopId);
    if (!station) return [];
    const arrivals = [];
    station.lines.forEach((lineName, i) => {
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

    const by_station = {};
    for (const st of mbta.stations) {
      const hits = dexPlaces
        .filter((p) => distanceM(p.lat, p.lng, st.lat, st.lng) <= STAMP_RADIUS_M)
        .map((p) => p.id);
      if (hits.length) by_station[st.id] = hits;
    }

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
   * @param {string} placeId
   * @param {{favoriteDish?: string, myRating?: number, photo?: File}} [extra]
   * @returns {Promise<DexEntry>} includes `unlocked_pet` when this entry unlocked a new neighborhood pet
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
    const nextDex = [...dex, entry];
    writeStore(DEX_KEY, nextDex);

    // Did this entry unlock a neighborhood pet? (First entry in that neighborhood.)
    const hood = mockPlaces.find((p) => p.id === placeId).neighborhood?.id;
    const firstThere = hood && !dex.some((e) => neighborhoodOfEntry(e) === hood);
    const unlocked_pet = firstThere
      ? petStates(nextDex, activePetId(nextDex)).find((p) => p.neighborhood_id === hood)
      : null;
    return { ...entry, unlocked_pet };
  },

  /** @returns {Promise<Profile|null>} null when signed out */
  async getProfile() {
    await delay();
    if (!isSignedIn()) return null;
    const dex = readStore(DEX_KEY, []);
    const xp = dex.reduce((sum, e) => sum + entryXp(e), 0);
    const activeId = activePetId(dex);
    return {
      id: MOCK_USER.id,
      display_name: MOCK_USER.display_name,
      pet_name: petStates(dex, activeId).find((p) => p.id === activeId).display_name,
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
    const demo = [
      ['mock-001', 'Beef pho', 5],
      ['mock-004', 'Lobster roll', 5],
      ['mock-008', 'Chickpea fritter pita', 4],
      ['mock-009', 'Pastrami sandwich', 5],
      ['mock-011', 'Shakshuka', 4],
      ['mock-012', 'Tasty burger', 4],
    ];
    writeStore(SIGNED_IN_KEY, true);
    writeStore(
      DEX_KEY,
      demo.map(([place_id, favorite_dish, my_rating], i) => ({
        id: `dex-demo-${i}`,
        place_id,
        favorite_dish,
        my_rating,
        photo_url: null,
        visited_at: new Date(Date.now() - i * 86400000).toISOString(),
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
  getRoutes,
  getStations,
  getNeighborhoods,
  getPets,
  setActivePet,
  setPetNickname,
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
