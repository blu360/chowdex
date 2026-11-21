/**
 * Builds src/lib/mock/neighborhoods.json: the 24 areas the app uses
 * (23 Boston neighborhoods + Cambridge), each with a boundary polygon and a color.
 *
 * Sources:
 *  - Boston Neighborhood Boundaries (City of Boston open data, data.boston.gov)
 *  - Cambridge city boundary (OpenStreetMap relation 1933745, via Nominatim)
 *  - Wharf District: not in the city file, so an approximate hand-drawn polygon is cut out of Downtown
 *
 * Usage: npm run build:neighborhoods
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as turf from '@turf/turf';

const OUT = 'src/lib/mock/neighborhoods.json';
const BOSTON_URL =
  'https://data.boston.gov/dataset/bf1a7b50-4c72-4637-b0fa-11d632e3aff1/resource/e5849875-a6f6-4c9c-9d8a-5048b0fbd03e/download/boston_neighborhood_boundaries.geojson';
const CAMBRIDGE_URL =
  'https://nominatim.openstreetmap.org/search?q=Cambridge%2C%20Middlesex%20County%2C%20Massachusetts&polygon_geojson=1&format=jsonv2&limit=3';

// The city file splits things differently than the neighborhood list we use, so some are merged.
// Harbor Islands is left out on purpose.
const BOSTON = [
  ['Allston', ['Allston']],
  ['Back Bay', ['Back Bay']],
  ['Bay Village', ['Bay Village']],
  ['Beacon Hill', ['Beacon Hill']],
  ['Brighton', ['Brighton']],
  ['Charlestown', ['Charlestown']],
  ['Chinatown–Leather District', ['Chinatown', 'Leather District']],
  ['Dorchester', ['Dorchester']],
  ['Downtown', ['Downtown']], // Wharf District is cut out below
  ['East Boston', ['East Boston']],
  ['Fenway–Kenmore', ['Fenway', 'Longwood']],
  ['Hyde Park', ['Hyde Park']],
  ['Jamaica Plain', ['Jamaica Plain']],
  ['Mattapan', ['Mattapan']],
  ['Mission Hill', ['Mission Hill']],
  ['North End', ['North End']],
  ['Roslindale', ['Roslindale']],
  ['Roxbury', ['Roxbury']],
  ['South Boston', ['South Boston', 'South Boston Waterfront']],
  ['South End', ['South End']],
  ['West End', ['West End']],
  ['West Roxbury', ['West Roxbury']],
];

// Approximate outline of the Wharf District (Rowes Wharf to Commercial Wharf along the waterfront).
// Intersected with Downtown below, so it can never spill outside it.
const WHARF_OUTLINE = turf.polygon([
  [
    [-71.0537, 42.3553],
    [-71.0493, 42.3553],
    [-71.0488, 42.3612],
    [-71.0508, 42.3645],
    [-71.0529, 42.3628],
    [-71.0537, 42.3592],
    [-71.0537, 42.3553],
  ],
]);

const slug = (name) =>
  name
    .toLowerCase()
    .replace(/–/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'bostonhacks-dev-script/0.1' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

const union = (a, b) => turf.union(turf.featureCollection([a, b]));
const simplifyAndRound = (f) => turf.truncate(turf.simplify(f, { tolerance: 0.0001, highQuality: false }), { precision: 5 });

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`;
}

async function main() {
  console.log('Downloading Boston neighborhood boundaries...');
  const boston = await getJson(BOSTON_URL);
  const byName = Object.fromEntries(boston.features.map((f) => [f.properties.name, f]));
  const need = (name) => {
    if (!byName[name]) throw new Error(`Boston file has no "${name}". Found: ${Object.keys(byName).join(', ')}`);
    return byName[name];
  };

  console.log('Downloading Cambridge boundary...');
  const cambridgeRes = await getJson(CAMBRIDGE_URL);
  const cambridgeHit = cambridgeRes.find(
    (r) => r.osm_type === 'relation' && r.category === 'boundary' && r.type === 'administrative',
  );
  if (!cambridgeHit) throw new Error('Cambridge boundary not found in Nominatim response');

  let features = BOSTON.map(([name, parts]) => ({
    name,
    city: 'Boston',
    feature: parts.map(need).reduce((a, b) => union(a, b)),
  }));

  // Wharf District: the part of Downtown inside the hand-drawn outline.
  const downtown = features.find((f) => f.name === 'Downtown');
  const wharfGeom = turf.intersect(turf.featureCollection([WHARF_OUTLINE, downtown.feature]));
  if (!wharfGeom) throw new Error('Wharf District outline does not overlap Downtown');
  downtown.feature = turf.difference(turf.featureCollection([downtown.feature, wharfGeom]));
  features.push({ name: 'Wharf District', city: 'Boston', feature: wharfGeom });

  features.push({ name: 'Cambridge', city: 'Cambridge', feature: turf.feature(cambridgeHit.geojson) });

  features = features
    .map((f) => ({ ...f, feature: simplifyAndRound(f.feature) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Neighbors, so touching areas get colors far apart on the color wheel.
  const n = features.length;
  const adjacent = features.map(() => new Set());
  for (let i = 0; i < n; i++) {
    const bufferedI = turf.buffer(features[i].feature, 0.04, { units: 'kilometers' });
    for (let j = i + 1; j < n; j++) {
      if (turf.booleanIntersects(bufferedI, features[j].feature)) {
        adjacent[i].add(j);
        adjacent[j].add(i);
      }
    }
  }

  const palette = Array.from({ length: n }, (_, i) => ({
    hue: (i * 360) / n,
    hex: hslToHex((i * 360) / n, i % 2 ? 62 : 74, 46 + (i % 3) * 4),
  }));
  const hueDist = (a, b) => {
    const d = Math.abs(a - b) % 360;
    return Math.min(d, 360 - d);
  };
  const order = [...features.keys()].sort((a, b) => adjacent[b].size - adjacent[a].size);
  const used = new Set();
  const chosen = {};
  for (const i of order) {
    const neighborHues = [...adjacent[i]].filter((j) => chosen[j]).map((j) => chosen[j].hue);
    let best = null;
    let bestScore = -1;
    for (const p of palette) {
      if (used.has(p.hue)) continue;
      const score = neighborHues.length ? Math.min(...neighborHues.map((h) => hueDist(h, p.hue))) : 180;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    used.add(best.hue);
    chosen[i] = best;
  }

  const output = {
    type: 'FeatureCollection',
    generated_at: new Date().toISOString(),
    sources: [
      'City of Boston, Boston Neighborhood Boundaries (data.boston.gov)',
      'OpenStreetMap contributors, Cambridge city boundary (ODbL)',
      'Wharf District: approximate, hand-drawn inside Downtown',
    ],
    features: features.map((f, i) => ({
      type: 'Feature',
      properties: { id: slug(f.name), name: f.name, city: f.city, color: chosen[i].hex },
      geometry: f.feature.geometry,
    })),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  const json = JSON.stringify(output);
  writeFileSync(OUT, json);
  console.log(`Wrote ${OUT}: ${output.features.length} areas, ${Math.round(json.length / 1024)} KB`);
  output.features.forEach((f, i) => {
    const km2 = (turf.area(f) / 1e6).toFixed(1);
    const nb = [...adjacent[i]].map((j) => features[j].name).join(', ');
    console.log(`  ${f.properties.name.padEnd(28)} ${f.properties.color}  ${km2.padStart(6)} km2  next to: ${nb}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
