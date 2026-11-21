/**
 * Fetches subway lines, station locations, and line shapes from the MBTA V3 API
 * and writes them to src/lib/mock/mbta.json.
 *
 * Usage: npm run fetch:mbta
 * Optional: set MBTA_API_KEY for a higher rate limit (works without one at a low rate).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const API = 'https://api-v3.mbta.com';
const OUT = 'src/lib/mock/mbta.json';
const KEY = process.env.MBTA_API_KEY;

// Subway only. Green is four branch routes, shown as one "Green" line.
const ROUTE_IDS = ['Red', 'Orange', 'Blue', 'Green-B', 'Green-C', 'Green-D', 'Green-E'];
const LINE_OF = (routeId) => (routeId.startsWith('Green') ? 'Green' : routeId);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, attempt = 0) {
  const res = await fetch(`${API}${path}`, KEY ? { headers: { 'x-api-key': KEY } } : undefined);
  if (res.status === 429 && attempt < 4) {
    await sleep(5000 * (attempt + 1));
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  await sleep(KEY ? 100 : 500);
  return res.json();
}

/** Decodes a Google-style encoded polyline (precision 5) into [lng, lat] pairs. */
function decodePolyline(str) {
  const coords = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    for (const axis of ['lat', 'lng']) {
      let shift = 0, result = 0, byte;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 'lat') lat += delta;
      else lng += delta;
    }
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}

/** Douglas-Peucker line simplification (tolerance in degrees, ~0.00015 is about 15m). */
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const sqDist = (p, a, b) => {
    let [x, y] = a;
    let dx = b[0] - x, dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = Math.max(0, Math.min(1, ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy)));
      x += dx * t; y += dy * t;
    }
    dx = p[0] - x; dy = p[1] - y;
    return dx * dx + dy * dy;
  };
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = sqDist(points[i], points[first], points[last]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance * tolerance && idx !== -1) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round5 = (n) => Math.round(n * 1e5) / 1e5;

// The app only covers Boston and Cambridge. Stations elsewhere are dropped, and each line is
// cut off at its last station inside this area (the stretch between two kept stations stays).
const ALLOWED_MUNICIPALITIES = new Set(['Boston', 'Cambridge']);

// Meters per degree at Boston's latitude, good enough for "which vertex is nearest".
const M_PER_DEG_LNG = 82400;
const M_PER_DEG_LAT = 111200;

/** Slices a full-resolution polyline to the span between the first and last station near it. */
function trimToStations(points, stationList, maxDistM = 250) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const st of stationList) {
    let best = Infinity;
    let bestIdx = -1;
    points.forEach(([lng, lat], i) => {
      const dx = (lng - st.lng) * M_PER_DEG_LNG;
      const dy = (lat - st.lat) * M_PER_DEG_LAT;
      const d = Math.hypot(dx, dy);
      if (d < best) {
        best = d;
        bestIdx = i;
      }
    });
    if (best <= maxDistM) {
      lo = Math.min(lo, bestIdx);
      hi = Math.max(hi, bestIdx);
    }
  }
  return hi >= lo ? points.slice(lo, hi + 1) : [];
}

async function main() {
  console.log('Fetching routes...');
  const routesRes = await get(`/routes?filter[id]=${ROUTE_IDS.join(',')}`);
  const routeInfo = Object.fromEntries(routesRes.data.map((r) => [r.id, r.attributes]));

  const lines = {};
  const stations = {};
  const rawShapes = {}; // full-resolution polylines per line, trimmed after all stations are known
  let skipped = 0;

  for (const routeId of ROUTE_IDS) {
    const lineId = LINE_OF(routeId);
    const attrs = routeInfo[routeId];
    if (!attrs) throw new Error(`Route not returned by API: ${routeId}`);
    lines[lineId] ??= {
      id: lineId,
      name: `${lineId} Line`,
      color: `#${attrs.color}`,
      station_ids: [],
      shapes: [],
      shape_routes: [], // shape_routes[i] = ids of the routes (e.g. "Green-B") that run along shapes[i]
    };

    console.log(`Fetching stations and shape for ${routeId}...`);
    const stops = await get(`/stops?filter[route]=${routeId}&filter[location_type]=1`);
    for (const s of stops.data) {
      const { name, latitude, longitude, municipality } = s.attributes;
      if (latitude == null || longitude == null) continue;
      if (!ALLOWED_MUNICIPALITIES.has(municipality)) {
        skipped++;
        continue;
      }
      stations[s.id] ??= { id: s.id, name, lat: round5(latitude), lng: round5(longitude), lines: [] };
      if (!stations[s.id].lines.includes(lineId)) stations[s.id].lines.push(lineId);
      if (!lines[lineId].station_ids.includes(s.id)) lines[lineId].station_ids.push(s.id);
    }

    const shapes = await get(`/shapes?filter[route]=${routeId}`);
    // Both directions return the same path reversed. Dedupe by endpoints (order-independent),
    // then keep the longest variants only (skips short shuttle and depot pieces).
    const endpointKey = (pts) =>
      [pts[0], pts[pts.length - 1]]
        .map(([lng, lat]) => `${lng.toFixed(3)},${lat.toFixed(3)}`)
        .sort()
        .join('|');
    const seen = new Set();
    const decoded = shapes.data
      .map((sh) => decodePolyline(sh.attributes.polyline))
      .sort((a, b) => b.length - a.length)
      .filter((pts) => {
        const key = endpointKey(pts);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6); // trimmed and deduped again below, once we know which parts are in bounds
    (rawShapes[lineId] ??= []).push(...decoded.map((pts) => ({ routeId, pts })));
  }

  // Cut each line off at its last in-bounds station, then simplify for the map.
  for (const line of Object.values(lines)) {
    const lineStations = line.station_ids.map((id) => stations[id]);
    const seenEnds = new Map(); // endpoints key -> index into line.shapes
    for (const { routeId, pts } of rawShapes[line.id]) {
      const trimmed = trimToStations(pts, lineStations);
      if (trimmed.length < 2) continue;
      // Skip tiny leftovers (depot spurs, shuttle pieces) and shapes identical to one already kept.
      const lengthM = trimmed.slice(1).reduce(
        (sum, [lng, lat], i) =>
          sum + Math.hypot((lng - trimmed[i][0]) * M_PER_DEG_LNG, (lat - trimmed[i][1]) * M_PER_DEG_LAT),
        0,
      );
      if (lengthM < 800) continue;
      const key = [trimmed[0], trimmed[trimmed.length - 1]]
        .map(([lng, lat]) => `${lng.toFixed(3)},${lat.toFixed(3)}`)
        .sort()
        .join('|');
      if (seenEnds.has(key)) {
        // Same path already kept: just remember that this route runs along it too.
        const routes = line.shape_routes[seenEnds.get(key)];
        if (!routes.includes(routeId)) routes.push(routeId);
        continue;
      }
      seenEnds.set(key, line.shapes.length);
      line.shapes.push(simplify(trimmed, 0.00015).map(([lng, lat]) => [round5(lng), round5(lat)]));
      line.shape_routes.push([routeId]);
    }
  }
  console.log(`Dropped ${skipped} station entries outside Boston and Cambridge.`);

  const output = {
    generated_at: new Date().toISOString(),
    source: 'MBTA V3 API (api-v3.mbta.com)',
    coverage: [...ALLOWED_MUNICIPALITIES],
    lines: Object.values(lines),
    stations: Object.values(stations).sort((a, b) => a.name.localeCompare(b.name)),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(output));
  const kb = Math.round(JSON.stringify(output).length / 1024);
  console.log(`Wrote ${OUT}: ${output.lines.length} lines, ${output.stations.length} stations, ${kb} KB`);
  for (const l of output.lines) console.log(`  ${l.name}: ${l.station_ids.length} stations, ${l.shapes.length} shape(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
