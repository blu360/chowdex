/**
 * Live MBTA times, from the V3 predictions feed. Pure helpers: the caller supplies `fetchMbta(path)`, which
 * returns the parsed JSON for an MBTA V3 path (in dev it goes through the proxy that holds the API key).
 */

const GREEN_ROUTES = ['Green-B', 'Green-C', 'Green-D', 'Green-E'];
export const routesForLine = (line) => (line === 'Green' ? GREEN_ROUTES : [line]);

const MIN = 60000;

/** Upcoming trains at a station, soonest first: [{ route: "Red Line", direction: "Alewife", minutes }]. */
export function parseArrivals(json, now = Date.now()) {
  const routes = Object.fromEntries((json.included ?? []).filter((i) => i.type === 'route').map((r) => [r.id, r]));
  const seen = new Map();
  for (const p of json.data ?? []) {
    const time = p.attributes.arrival_time ?? p.attributes.departure_time;
    const route = routes[p.relationships?.route?.data?.id];
    if (!time || !route) continue;
    const minutes = Math.round((new Date(time).getTime() - now) / MIN);
    if (minutes < 0) continue;
    const line = route.id.startsWith('Green') ? 'Green' : route.id;
    const direction = route.attributes.direction_destinations?.[p.attributes.direction_id] ?? '';
    const key = `${line}|${direction}`;
    if (!seen.has(key) || minutes < seen.get(key).minutes) seen.set(key, { route: `${line} Line`, direction, minutes });
  }
  return [...seen.values()].sort((a, b) => a.minutes - b.minutes);
}

/** The query for upcoming subway trains at a station (buses that stop nearby are left out). */
export const arrivalsQuery = (stopId) =>
  `predictions?filter%5Bstop%5D=${encodeURIComponent(stopId)}&filter%5Broute%5D=Red,Orange,Blue,${GREEN_ROUTES.join(',')}` +
  '&include=route&sort=arrival_time&page%5Blimit%5D=40';

/**
 * The next train that goes from one station to another, with real times: how long until it leaves, and how long
 * it takes to reach the second station. Both come from the same trip, so the direction is always right.
 * @returns {Promise<{wait_min: number, ride_min: number} | null>} null when the feed has no such train
 */
export async function liveRide({ fetchMbta, fromId, toId, routes, now = Date.now() }) {
  const query =
    `predictions?filter%5Bstop%5D=${encodeURIComponent(fromId)},${encodeURIComponent(toId)}` +
    `&filter%5Broute%5D=${routes.join(',')}&include=stop&sort=departure_time&page%5Blimit%5D=100`;
  const json = await fetchMbta(query);

  // Predictions are per platform; map each platform back to its station.
  const station = {};
  for (const inc of json.included ?? []) {
    if (inc.type === 'stop') station[inc.id] = inc.relationships?.parent_station?.data?.id ?? inc.id;
  }

  const trips = new Map(); // trip id -> { dep: ms at the first station, arr: ms at the second }
  for (const p of json.data ?? []) {
    const trip = p.relationships?.trip?.data?.id;
    const platform = p.relationships?.stop?.data?.id;
    if (!trip || !platform) continue;
    const at = station[platform] ?? platform;
    const entry = trips.get(trip) ?? {};
    if (at === fromId) {
      const t = p.attributes.departure_time ?? p.attributes.arrival_time;
      if (t) entry.dep = new Date(t).getTime();
    } else if (at === toId) {
      const t = p.attributes.arrival_time ?? p.attributes.departure_time;
      if (t) entry.arr = new Date(t).getTime();
    }
    trips.set(trip, entry);
  }

  let best = null;
  for (const { dep, arr } of trips.values()) {
    if (dep == null || arr == null || arr <= dep || dep < now - 20000) continue; // wrong direction, or already gone
    if (!best || dep < best.dep) best = { dep, arr };
  }
  if (!best) return null;
  return { wait_min: Math.max(0, Math.round((best.dep - now) / MIN)), ride_min: (best.arr - best.dep) / MIN };
}
