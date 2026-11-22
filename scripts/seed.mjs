/**
 * Seeds the Supabase database: MBTA stations, the 24 neighborhoods, the 25 pets, and restaurants
 * (from OpenStreetMap) for Boston and Cambridge. Safe to run again: everything is an upsert.
 *
 *   SUPABASE_DB_URL="postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres" npm run seed
 *   npm run seed -- --skip-restaurants      # reference data only
 *
 * Use the pooler address from the Supabase dashboard (Connect > Session pooler): the direct database
 * address is IPv6-only. The password is read from the environment and never stored.
 *
 * Restaurants come from the public Overpass API (OpenStreetMap, ODbL). Ratings are not stored: they come
 * live from Google Places at read time. After loading, each place gets its nearest T stop and its
 * neighborhood (a PostGIS point-in-polygon join), and anything outside the 24 areas is dropped.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { isBigChain } from '../src/lib/chains.js';

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error('Set SUPABASE_DB_URL (see the comment at the top of scripts/seed.mjs).');
  process.exit(1);
}
const skipRestaurants = process.argv.includes('--skip-restaurants');
const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const mbta = json('../src/lib/mock/mbta.json');
const hoods = json('../src/lib/mock/neighborhoods.json');
const pets = json('../src/lib/mock/pets.json');

/* ----------------------------- Reference data ----------------------------- */

await client.query('begin');
try {
  for (const s of mbta.stations) {
    await client.query(
      `insert into mbta_stops (id, name, lat, lng, lines) values ($1, $2, $3, $4, $5)
       on conflict (id) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng, lines = excluded.lines`,
      [s.id, s.name, s.lat, s.lng, s.lines],
    );
  }
  console.log(`stations:      ${mbta.stations.length}`);

  for (const f of hoods.features) {
    const { id, name, city, color } = f.properties;
    await client.query(
      `insert into neighborhoods (id, name, city, color, boundary)
       values ($1, $2, $3, $4, st_multi(st_setsrid(st_geomfromgeojson($5), 4326))::geography)
       on conflict (id) do update set name = excluded.name, city = excluded.city, color = excluded.color, boundary = excluded.boundary`,
      [id, name, city, color, JSON.stringify(f.geometry)],
    );
  }
  console.log(`neighborhoods: ${hoods.features.length}`);

  for (const p of pets) {
    await client.query(
      `insert into pets (id, name, neighborhood_id, is_starter, image, svg) values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set name = excluded.name, neighborhood_id = excluded.neighborhood_id,
         is_starter = excluded.is_starter, image = excluded.image, svg = excluded.svg`,
      [p.id, p.name, p.neighborhood_id, p.is_starter, p.image, p.svg],
    );
  }
  console.log(`pets:          ${pets.length}`);
  await client.query('commit');
} catch (err) {
  await client.query('rollback');
  throw err;
}

/* ------------------------------- Restaurants ------------------------------- */

if (!skipRestaurants) {
  // A box around Boston and Cambridge; the polygons below decide what is really kept.
  const BBOX = '42.22,-71.20,42.42,-70.98'; // south, west, north, east
  const query = `[out:json][timeout:180];
(
  nwr["amenity"~"^(restaurant|cafe|fast_food|ice_cream)$"]["name"](${BBOX});
);
out center tags;`;

  console.log('fetching restaurants from OpenStreetMap (this can take a minute)...');
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'chowdex-seed-script' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass answered ${res.status}. Try again in a minute.`);
  const { elements } = await res.json();

  /** Open past 1 am (after the T stops running): a rough read of OSM opening_hours. */
  function openLate(hours) {
    if (!hours) return false;
    if (/24\/7/.test(hours)) return true;
    for (const m of hours.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)) {
      const start = Number(m[1]) * 60 + Number(m[2]);
      const end = Number(m[3]) * 60 + Number(m[4]);
      if (end <= start && end >= 60) return true; // runs past midnight, ends at 1 am or later
    }
    return false;
  }

  const cuisineOf = (tags) => {
    const first = (tags.cuisine ?? '').split(';')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (first) return first;
    return { cafe: 'cafe', fast_food: 'fast_food', ice_cream: 'ice_cream' }[tags.amenity] ?? 'restaurant';
  };

  const rows = [];
  const chainIds = []; // big chains: not loaded, and removed if an earlier seed loaded them
  const seen = new Set();
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null || !el.tags?.name) continue;
    const osmId = `${el.type}/${el.id}`;
    if (seen.has(osmId)) continue;
    seen.add(osmId);
    const t = el.tags;
    // Chowdex is for local spots: skip national chains (by name, or by OpenStreetMap's brand tag). See src/lib/chains.js.
    if (isBigChain(t.name, { brandWikidata: t['brand:wikidata'] ?? null })) {
      chainIds.push(osmId);
      continue;
    }
    rows.push({
      osm_id: osmId,
      name: t.name.slice(0, 120),
      lat,
      lng,
      cuisine: cuisineOf(t),
      opening_hours: t.opening_hours ?? null,
      open_late: openLate(t.opening_hours),
      website: t.website ?? t['contact:website'] ?? null,
    });
  }
  console.log(`OpenStreetMap returned ${rows.length + chainIds.length} named places (${chainIds.length} big-chain locations skipped)`);

  await client.query('begin');
  try {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await client.query(
        `insert into places (osm_id, name, lat, lng, cuisine, opening_hours, open_late, website)
         select osm_id, name, lat, lng, cuisine, opening_hours, open_late, website
         from jsonb_to_recordset($1::jsonb)
           as r(osm_id text, name text, lat float8, lng float8, cuisine text, opening_hours text, open_late bool, website text)
         on conflict (osm_id) do update set name = excluded.name, lat = excluded.lat, lng = excluded.lng,
           cuisine = excluded.cuisine, opening_hours = excluded.opening_hours, open_late = excluded.open_late, website = excluded.website`,
        [JSON.stringify(chunk)],
      );
    }

    // Chains loaded by an earlier seed go away too, unless someone already has one in their dex.
    const chainsRemoved = await client.query(
      `delete from places p where p.osm_id = any($1::text[]) and not exists (select 1 from dex_entries e where e.place_id = p.id)`,
      [chainIds],
    );
    if (chainsRemoved.rowCount) console.log(`removed ${chainsRemoved.rowCount} chain locations from an earlier seed`);

    // Neighborhood: point-in-polygon. Places outside all 24 areas are not part of the game.
    await client.query(
      `update places p set neighborhood_id = (
         select n.id from neighborhoods n where st_covers(n.boundary::geometry, p.geog::geometry) limit 1)`,
    );
    const dropped = await client.query(
      `delete from places p where neighborhood_id is null and not exists (select 1 from dex_entries e where e.place_id = p.id)`,
    );

    // Nearest T stop and its distance in meters.
    await client.query(
      `update places p set nearest_stop_id = (select s.id from mbta_stops s order by s.geog <-> p.geog limit 1)`,
    );
    await client.query(
      `update places p set nearest_stop_distance_m = round(st_distance(p.geog, s.geog))::int
       from mbta_stops s where s.id = p.nearest_stop_id`,
    );
    await client.query('commit');
    console.log(`restaurants:   ${rows.length - dropped.rowCount} kept, ${dropped.rowCount} outside Boston and Cambridge dropped`);
  } catch (err) {
    await client.query('rollback');
    throw err;
  }
}

/* --------------------------------- Summary --------------------------------- */

const count = async (t) => (await client.query(`select count(*)::int as n from ${t}`)).rows[0].n;
console.log('\nin the database now:');
for (const t of ['mbta_stops', 'neighborhoods', 'pets', 'places']) console.log(`  ${t.padEnd(14)} ${await count(t)}`);
await client.end();
