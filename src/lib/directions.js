/**
 * A small route planner for "get me to this restaurant by T and on foot".
 *
 * It needs no location permission: the rider picks the station they are starting from. The train part is
 * worked out here from our own MBTA data (stations and which ones neighbor each other); the walking and car
 * distances come from a free routing service when it answers, and from a straight-line estimate when it does not.
 *
 * What it is NOT: it does not know timetables, delays, or accessibility. Waits and ride times are estimates.
 * It lives in src/lib so it can be tested without a browser: everything it needs is passed in.
 */
import { compareEmissions, milesFromMeters } from './carbon.js';
import { liveRide, routesForLine } from './mbtaLive.js';

const M_PER_DEG_LNG = 82400; // meters per degree at Boston's latitude: accurate enough for city-scale geometry
const M_PER_DEG_LAT = 111200;
const dist = (a, b) => Math.hypot((a.lng - b.lng) * M_PER_DEG_LNG, (a.lat - b.lat) * M_PER_DEG_LAT);

/** Estimates (documented here so they are easy to change). */
export const WALK_M_PER_MIN = 80; // about 4.8 km/h
const WALK_DETOUR = 1.25; // streets are longer than a straight line
const CAR_DETOUR = 1.3;
const CAR_M_PER_MIN = 350; // about 21 km/h in the city (the car estimate ignores traffic lights and parking)
const TRACK_CURVE = 1.15; // track is longer than the straight line between two stations
const TRAIN_M_PER_MIN = { Red: 500, Orange: 500, Blue: 500, Green: 330 }; // the Green Line runs in the street and is slower
const TRANSFER_MIN = { line: 5, branch: 3 }; // walking between platforms plus waiting
const DEFAULT_WAIT_MIN = 5;
const WALK_ONLY_WITHIN_M = 1000; // closer than this (in a straight line), just walk
const CANDIDATE_STATIONS = 3; // how many stations near the restaurant to try getting off at
const ROUTING_TIMEOUT_MS = 4000;

/* ------------------------- The network (who neighbors whom) ------------------------- */

// Red, Orange, and Blue are single ordered paths in our data. The Green Line is several services that share the
// trunk, so they are spelled out here (in order) by station name.
const GREEN_TRUNK = ['Lechmere', 'Science Park/West End', 'North Station', 'Haymarket', 'Government Center', 'Park Street', 'Boylston', 'Arlington', 'Copley'];
const GREEN_BRANCHES = {
  'Green-B': ['Hynes Convention Center', 'Kenmore', 'Blandford Street', 'Boston University East', 'Boston University Central', 'Amory Street', 'Babcock Street', "Packard's Corner", 'Harvard Avenue', 'Griggs Street', 'Allston Street', 'Warren Street', 'Washington Street', 'Sutherland Road', 'Chiswick Road', 'Chestnut Hill Avenue', 'South Street', 'Boston College'],
  'Green-C': ['Hynes Convention Center', 'Kenmore', 'Cleveland Circle'],
  'Green-D': ['Hynes Convention Center', 'Kenmore', 'Fenway'],
  'Green-E': ['Prudential', 'Symphony', 'Northeastern University', 'Museum of Fine Arts', 'Longwood Medical Area', 'Brigham Circle', 'Fenwood Road', 'Mission Park', 'Riverway', 'Back of the Hill', 'Heath Street'],
};

/** @returns {{id: string, line: string, stations: string[]}[]} every service as an ordered list of station ids */
export function buildServices(mbta) {
  const services = [];
  for (const line of mbta.lines) {
    if (line.id !== 'Green') services.push({ id: line.id, line: line.id, stations: line.station_ids });
  }
  const green = mbta.stations.filter((s) => s.lines.includes('Green'));
  const idOf = (name) => {
    const hit = green.find((s) => s.name === name);
    if (!hit) throw new Error(`Green Line station not found in the data: ${name}`);
    return hit.id;
  };
  for (const [id, names] of Object.entries(GREEN_BRANCHES)) {
    services.push({ id, line: 'Green', stations: [...GREEN_TRUNK, ...names].map(idOf) });
  }
  return services;
}

/** Cheapest way (in minutes) from the start station to each station, through rides and transfers. */
export function buildNetwork(mbta) {
  const station = Object.fromEntries(mbta.stations.map((s) => [s.id, s]));
  const services = buildServices(mbta);
  const edges = new Map(); // node -> [{ to, cost, kind, service?, a?, b? }]
  const node = (stationId, serviceId) => `${stationId}|${serviceId}`;
  const add = (from, edge) => {
    if (!edges.has(from)) edges.set(from, []);
    edges.get(from).push(edge);
  };
  const nodesAt = new Map(); // stationId -> [node...]

  for (const svc of services) {
    for (let i = 0; i < svc.stations.length; i++) {
      const id = svc.stations[i];
      const n = node(id, svc.id);
      if (!nodesAt.has(id)) nodesAt.set(id, []);
      nodesAt.get(id).push({ node: n, service: svc });
      if (i === 0) continue;
      const prev = svc.stations[i - 1];
      const meters = dist(station[prev], station[id]) * TRACK_CURVE;
      const minutes = meters / TRAIN_M_PER_MIN[svc.line];
      add(node(prev, svc.id), { to: n, cost: minutes, kind: 'ride', service: svc, a: prev, b: id, meters });
      add(n, { to: node(prev, svc.id), cost: minutes, kind: 'ride', service: svc, a: id, b: prev, meters });
    }
  }
  // Changing trains at a station: between lines, or between Green Line branches.
  for (const [id, list] of nodesAt) {
    for (const x of list) {
      for (const y of list) {
        if (x.node === y.node) continue;
        const sameLine = x.service.line === y.service.line;
        add(x.node, { to: y.node, cost: sameLine ? TRANSFER_MIN.branch : TRANSFER_MIN.line, kind: 'transfer', at: id, from: x.service, toService: y.service });
      }
    }
  }
  return { station, services, edges, nodesAt, node };
}

/**
 * Dijkstra over the network. Boarding at `fromId` costs the wait for that line's train (`waitFor(line)`, in minutes).
 * @returns {{minutes: number, steps: object[]} | null} steps are the ride/transfer edges in order
 */
export function shortestPath(network, fromId, toId, waitFor = () => DEFAULT_WAIT_MIN) {
  if (fromId === toId) return { minutes: 0, steps: [] };
  const { edges, nodesAt } = network;
  const best = new Map();
  const via = new Map();
  const queue = [];
  for (const { node, service } of nodesAt.get(fromId) ?? []) {
    const wait = waitFor(service.line);
    best.set(node, wait);
    queue.push([wait, node]);
  }
  while (queue.length) {
    queue.sort((p, q) => p[0] - q[0]);
    const [cost, here] = queue.shift();
    if (cost > best.get(here)) continue;
    for (const edge of edges.get(here) ?? []) {
      const next = cost + edge.cost;
      if (next < (best.get(edge.to) ?? Infinity)) {
        best.set(edge.to, next);
        via.set(edge.to, { from: here, edge });
        queue.push([next, edge.to]);
      }
    }
  }
  let end = null;
  for (const { node } of nodesAt.get(toId) ?? []) {
    if (best.has(node) && (!end || best.get(node) < best.get(end))) end = node;
  }
  if (!end) return null;
  const steps = [];
  for (let at = end; via.has(at); at = via.get(at).from) steps.unshift(via.get(at).edge);
  return { minutes: best.get(end), steps };
}

/* ------------------------------- Track geometry ------------------------------- */

function buildTracks(mbta) {
  const tracks = [];
  for (const line of mbta.lines) {
    line.shapes.forEach((pts, i) => {
      const cum = [0];
      for (let j = 1; j < pts.length; j++) {
        cum.push(cum[j - 1] + Math.hypot((pts[j][0] - pts[j - 1][0]) * M_PER_DEG_LNG, (pts[j][1] - pts[j - 1][1]) * M_PER_DEG_LAT));
      }
      tracks.push({ line: line.id, routes: line.shape_routes?.[i] ?? [], pts, cum });
    });
  }
  return tracks;
}

/** Closest point on a track: how far along it, and how far off it. */
function project(track, p) {
  const px = p.lng * M_PER_DEG_LNG;
  const py = p.lat * M_PER_DEG_LAT;
  let best = { s: 0, dist: Infinity };
  for (let i = 0; i < track.pts.length - 1; i++) {
    const ax = track.pts[i][0] * M_PER_DEG_LNG;
    const ay = track.pts[i][1] * M_PER_DEG_LAT;
    const dx = track.pts[i + 1][0] * M_PER_DEG_LNG - ax;
    const dy = track.pts[i + 1][1] * M_PER_DEG_LAT - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best.dist) best = { s: track.cum[i] + t * Math.sqrt(len2), dist: d };
  }
  return best;
}

function pointAt(track, s) {
  let i = 0;
  while (i < track.cum.length - 2 && track.cum[i + 1] < s) i++;
  const seg = track.cum[i + 1] - track.cum[i];
  const t = seg === 0 ? 0 : (s - track.cum[i]) / seg;
  return [track.pts[i][0] + (track.pts[i + 1][0] - track.pts[i][0]) * t, track.pts[i][1] + (track.pts[i + 1][1] - track.pts[i][1]) * t];
}

/** The piece of a track between two distances along it, in travel order (reversed if s1 > s2). */
function slice(track, s1, s2) {
  const [lo, hi] = s1 <= s2 ? [s1, s2] : [s2, s1];
  const pts = [pointAt(track, lo)];
  for (let i = 0; i < track.pts.length; i++) if (track.cum[i] > lo && track.cum[i] < hi) pts.push(track.pts[i]);
  pts.push(pointAt(track, hi));
  return s1 <= s2 ? pts : pts.reverse();
}

const ON_TRACK_M = 250;

/** The drawn track between two neighboring stations of a line, falling back to a straight segment. */
function edgeShape(tracks, line, routeId, a, b) {
  const candidates = tracks.filter((t) => t.line === line);
  const ofRoute = candidates.filter((t) => t.routes.includes(routeId));
  let best = null;
  for (const track of ofRoute.length ? [...ofRoute, ...candidates.filter((t) => !ofRoute.includes(t))] : candidates) {
    const pa = project(track, a);
    const pb = project(track, b);
    const off = Math.max(pa.dist, pb.dist);
    if (off <= ON_TRACK_M && (!best || off < best.off)) best = { track, pa, pb, off };
    if (best && ofRoute.includes(track)) break; // a track of the right route is good enough
  }
  if (!best) return [[a.lng, a.lat], [b.lng, b.lat]];
  return slice(best.track, best.pa.s, best.pb.s);
}

const lengthOf = (pts) => {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot((pts[i][0] - pts[i - 1][0]) * M_PER_DEG_LNG, (pts[i][1] - pts[i - 1][1]) * M_PER_DEG_LAT);
  return total;
};

/* ----------------------------- Walking and driving ----------------------------- */

/** Walking / driving routes from a free OpenStreetMap routing service. Returns null if it does not answer in time. */
async function routedTrip(profile, a, b, fetchJson) {
  // These public routers take longitude,latitude. They only ever see the two endpoints (a station and a restaurant).
  const base = profile === 'foot' ? 'https://routing.openstreetmap.de/routed-foot' : 'https://routing.openstreetmap.de/routed-car';
  const url = `${base}/route/v1/${profile}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
  try {
    const json = await fetchJson(url);
    const route = json?.routes?.[0];
    if (!route) return null;
    return { distance_m: route.distance, minutes: route.duration / 60, coordinates: route.geometry.coordinates };
  } catch {
    return null;
  }
}

/** The default fetcher: JSON with a short timeout. */
export async function fetchJsonWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROUTING_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`routing ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------- The planner --------------------------------- */

/**
 * Live wait (and ride time) for the first train. The feed only predicts a trip's arrival at a stop once it is
 * fairly close, so when the whole ride is not predicted yet, the next station still gives a real wait.
 */
async function liveFirstTrain({ fetchMbta, first }) {
  const routes = routesForLine(first.line);
  try {
    const whole = await liveRide({ fetchMbta, fromId: first.from.id, toId: first.to.id, routes });
    if (whole) return { ...whole, whole_ride: true };
    if (first.first_hop_id && first.first_hop_id !== first.to.id) {
      const hop = await liveRide({ fetchMbta, fromId: first.from.id, toId: first.first_hop_id, routes });
      if (hop) return { wait_min: hop.wait_min, ride_min: null, whole_ride: false };
    }
  } catch {
    // no live feed: the planner assumes a wait
  }
  return null;
}

const notFound = (message) => Object.assign(new Error(message), { code: 'NOT_FOUND' });
const invalid = (message) => Object.assign(new Error(message), { code: 'INVALID' });

/** A person's position is rounded (to about 100 m) before it is sent to the public walking and driving router. */
const coarse = (p) => ({ lat: Math.round(p.lat * 1000) / 1000, lng: Math.round(p.lng * 1000) / 1000 });

let cachedNetwork;
let cachedTracks;
let cachedFor;

/**
 * @param {Object} args
 * @param {Object} args.mbta          the bundled MBTA data (stations, lines with shapes)
 * @param {{id: string, name: string, lat: number, lng: number}} args.place   the restaurant
 * @param {{lat: number, lng: number} | {stationId: string}} args.origin
 *        where the rider is: their current position, or a station they pick instead
 * @param {(url: string) => Promise<any>} [args.fetchJson]   walking / driving router (OpenStreetMap)
 * @param {(path: string) => Promise<any>} [args.fetchMbta]  MBTA V3 JSON, for live times (optional)
 * @param {number} [args.now]  the time the trip starts, in ms (defaults to the current time)
 * @returns {Promise<Object>} a Directions object, see api.js
 */
export async function planDirections({ mbta, place, origin, fetchJson = fetchJsonWithTimeout, fetchMbta, now = Date.now() }) {
  if (cachedFor !== mbta) {
    cachedNetwork = buildNetwork(mbta);
    cachedTracks = buildTracks(mbta);
    cachedFor = mbta;
  }
  const network = cachedNetwork;
  const tracks = cachedTracks;

  // Where the trip starts.
  let start;
  if (origin?.stationId) {
    const s = network.station[origin.stationId];
    if (!s) throw notFound(`Station not found: ${origin.stationId}`);
    start = { lat: s.lat, lng: s.lng, name: s.name, station: s };
  } else if (Number.isFinite(origin?.lat) && Number.isFinite(origin?.lng)) {
    start = { lat: origin.lat, lng: origin.lng, name: 'Your location', station: null };
  } else {
    throw invalid('Give a location or a station to start from');
  }

  const straight = dist(start, place);
  const lineName = (id) => mbta.lines.find((l) => l.id === id)?.name ?? `${id} Line`;
  const lineColor = (id) => mbta.lines.find((l) => l.id === id)?.color ?? '#1d2b45';
  const nameOf = (id) => ({ id, name: network.station[id].name });
  const nearest = (point, n) =>
    mbta.stations
      .map((s) => ({ s, d: dist(s, point) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, n);

  // Which station to board at and which to get off at: try the few nearest each end and keep the quickest overall.
  const boardOptions = start.station ? [{ s: start.station, d: 0 }] : nearest(start, CANDIDATE_STATIONS);
  const alightOptions = nearest(place, CANDIDATE_STATIONS);
  let plan = null;
  for (const board of boardOptions) {
    for (const alight of alightOptions) {
      if (board.s.id === alight.s.id) continue;
      const path = shortestPath(network, board.s.id, alight.s.id);
      if (!path) continue;
      const total = (board.d * WALK_DETOUR) / WALK_M_PER_MIN + path.minutes + (alight.d * WALK_DETOUR) / WALK_M_PER_MIN;
      if (!plan || total < plan.total) plan = { board: board.s, alight: alight.s, path, total };
    }
  }

  const walkOnlyMin = (straight * WALK_DETOUR) / WALK_M_PER_MIN;
  const walkOnly = straight <= WALK_ONLY_WITHIN_M || !plan || walkOnlyMin <= plan.total;

  // The train legs in order (without times yet).
  const rideLegs = [];
  const transferLegs = [];
  const order = []; // 'ride' | 'transfer' entries, in sequence
  if (!walkOnly) {
    const steps = [...plan.path.steps];
    while (steps[0]?.kind === 'transfer') steps.shift(); // never start by changing trains: just board the right one
    let i = 0;
    while (i < steps.length) {
      const step = steps[i];
      if (step.kind === 'transfer') {
        const leg = { type: 'transfer', at: nameOf(step.at), from_line: step.from.line, to_line: step.toService.line, minutes: step.cost };
        transferLegs.push(leg);
        order.push(leg);
        i++;
        continue;
      }
      const service = step.service;
      const rides = [];
      while (i < steps.length && steps[i].kind === 'ride' && steps[i].service.id === service.id) rides.push(steps[i++]);
      const coordinates = [];
      for (const r of rides) {
        const shape = edgeShape(tracks, service.line, service.id, network.station[r.a], network.station[r.b]);
        coordinates.push(...(coordinates.length ? shape.slice(1) : shape));
      }
      const leg = {
        type: 'ride', line: service.line, line_name: lineName(service.line), service: service.id, color: lineColor(service.line),
        from: nameOf(rides[0].a), to: nameOf(rides.at(-1).b), stops: rides.length,
        minutes: rides.reduce((t, r) => t + r.cost, 0),
        distance_m: lengthOf(coordinates) || rides.reduce((t, r) => t + r.meters, 0),
        coordinates, live: false,
        first_hop_id: rides[0].b, // the next station: its predictions give the live wait when the whole ride is not predicted yet
      };
      rideLegs.push(leg);
      order.push(leg);
    }
  }

  // Everything that needs the network, at once: real walking and driving routes, and live train times.
  const footFrom = walkOnly ? start : { ...plan.alight };
  const walkEstimate = (a, b) => {
    const d = dist(a, b) * WALK_DETOUR;
    return { distance_m: d, minutes: d / WALK_M_PER_MIN, coordinates: [[a.lng, a.lat], [b.lng, b.lat]], estimated: true };
  };
  const router = (p) => (p.station || p.id ? p : { ...p, ...coarse(p) }); // a person's position is blurred before it leaves the browser
  const needFirstWalk = !walkOnly && !start.station;
  const first = rideLegs[0];
  const [car, finalWalk, firstWalk, live] = await Promise.all([
    routedTrip('car', router(start), place, fetchJson),
    routedTrip('foot', walkOnly ? router(start) : footFrom, place, fetchJson),
    needFirstWalk ? routedTrip('foot', router(start), plan.board, fetchJson) : null,
    first && fetchMbta ? liveFirstTrain({ fetchMbta, first }) : null,
  ]);

  const carRoute = car ?? { distance_m: straight * CAR_DETOUR, minutes: (straight * CAR_DETOUR) / CAR_M_PER_MIN, estimated: true };
  const legs = [];

  if (needFirstWalk) {
    const w = firstWalk ?? walkEstimate(start, plan.board);
    legs.push({ type: 'walk', from: { name: start.name }, to: { name: plan.board.name }, distance_m: w.distance_m, minutes: w.minutes, coordinates: w.coordinates, estimated: Boolean(w.estimated) });
  }

  if (!walkOnly) {
    const boardAt = nameOf(first.from.id);
    legs.push({
      type: 'board', line: first.line, line_name: first.line_name, color: first.color, at: boardAt,
      minutes: live ? live.wait_min : DEFAULT_WAIT_MIN, wait_source: live ? 'live' : 'assumed',
    });
    if (live?.whole_ride) {
      first.minutes = Math.max(1, live.ride_min);
      first.live = true;
    }
    for (const leg of order) legs.push(leg);
  }

  const lastFrom = walkOnly ? start : plan.alight;
  const fw = finalWalk ?? walkEstimate(lastFrom, place);
  legs.push({
    type: 'walk', from: { name: walkOnly ? start.name : lastFrom.name }, to: { name: place.name },
    distance_m: fw.distance_m, minutes: fw.minutes, coordinates: fw.coordinates, estimated: Boolean(fw.estimated),
  });

  // Clock times: leaving now, each leg starts when the one before it ends. A train leaves when the wait is over.
  let clock = now;
  for (const leg of legs) {
    leg.starts_at = new Date(clock).toISOString();
    if (leg.type === 'board') leg.departs_at = new Date(clock + leg.minutes * 60000).toISOString();
    clock += leg.minutes * 60000;
  }

  const rideMeters = rideLegs.reduce((t, l) => t + l.distance_m, 0);
  const walkMeters = legs.filter((l) => l.type === 'walk').reduce((t, l) => t + l.distance_m, 0);
  const transitMiles = milesFromMeters(rideMeters);
  const walkMiles = milesFromMeters(walkMeters);
  const carMiles = milesFromMeters(carRoute.distance_m);

  return {
    mode: walkOnly ? 'walk' : 'transit',
    from: { id: start.station?.id ?? null, name: start.name, lat: start.lat, lng: start.lng },
    to: { id: place.id, name: place.name, lat: place.lat, lng: place.lng },
    legs,
    depart_at: new Date(now).toISOString(),
    arrive_at: new Date(clock).toISOString(),
    totals: {
      minutes: Math.round(legs.reduce((t, l) => t + l.minutes, 0)),
      transit_miles: transitMiles,
      walk_miles: walkMiles,
      miles: transitMiles + walkMiles,
    },
    car: { miles: carMiles, minutes: Math.round(carRoute.minutes), estimated: Boolean(carRoute.estimated) },
    emissions: compareEmissions({ carMiles, transitMiles }),
    live: Boolean(live),
  };
}

/** The route as GeoJSON for the map: colored train legs, and dashed walking legs. */
export function routeToGeoJSON(route) {
  const features = [];
  for (const leg of route?.legs ?? []) {
    if (!leg.coordinates || leg.coordinates.length < 2) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: leg.coordinates },
      properties: { kind: leg.type === 'walk' ? 'walk' : 'ride', color: leg.color ?? '#1d2b45' },
    });
  }
  return { type: 'FeatureCollection', features };
}
