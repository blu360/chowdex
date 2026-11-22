/**
 * The green-trips log: trips the rider chooses to record, and the running tally.
 *
 * Privacy: a trip is only ever added when the rider taps "I took this trip". It records the place, the miles, and the
 * carbon, never the rider's position, and the log is kept in this browser (localStorage), not sent anywhere.
 * Syncing it to the account is a later step.
 */
const KEY = 'chowdex.trips';
const MAX_TRIPS = 500;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_TRIPS)));
  } catch {
    // storage full or unavailable: the log just will not persist
  }
}

const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0);

/** @returns {Object[]} newest first */
export function listTrips() {
  return read();
}

/**
 * @param {Object} route  a result of planDirections()
 * @returns {Object} the saved trip
 */
export function addTripFromRoute(route) {
  const trip = {
    id: `trip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    place_id: route.to.id,
    place_name: route.to.name,
    from_name: route.from.id ? route.from.name : 'my location', // the position itself is never stored
    mode: route.mode, // 'transit' (train + walking) or 'walk'
    transit_miles: num(route.totals.transit_miles),
    walk_miles: num(route.totals.walk_miles),
    car_miles: num(route.car.miles),
    co2_kg: num(route.emissions.transit_kg),
    // A trip never counts as emitting more than driving would have: the tally only celebrates real savings.
    co2_saved_kg: Math.max(0, route.emissions.saved_kg),
    minutes: num(route.totals.minutes),
  };
  write([trip, ...read()]);
  return trip;
}

export function removeTrip(id) {
  const list = read();
  if (!list.some((t) => t.id === id)) return false;
  write(list.filter((t) => t.id !== id));
  return true;
}

/**
 * @typedef {Object} TripTally
 * @property {number} trips
 * @property {number} miles            miles travelled by train and on foot
 * @property {number} transit_miles
 * @property {number} walk_miles
 * @property {number} car_miles_avoided   what the same trips would have been by car
 * @property {number} co2_saved_kg
 * @property {number} co2_kg           what the trips emitted
 */
export function tallyTrips(list = read()) {
  const sum = (key) => list.reduce((t, trip) => t + num(trip[key]), 0);
  const transit_miles = sum('transit_miles');
  const walk_miles = sum('walk_miles');
  return {
    trips: list.length,
    miles: transit_miles + walk_miles,
    transit_miles,
    walk_miles,
    car_miles_avoided: sum('car_miles'),
    co2_saved_kg: sum('co2_saved_kg'),
    co2_kg: sum('co2_kg'),
  };
}
