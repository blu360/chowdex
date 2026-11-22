/**
 * Fetches Google star ratings for places and saves them in the database as a short-lived cache.
 * Ratings are NEVER fetched while someone uses the app: the app only reads what this script saved.
 *
 *   npm run ratings                    # fetch up to 25 places that have no fresh rating
 *   npm run ratings -- --limit 80      # a bigger batch (each place is one Google request)
 *   npm run ratings -- --dry-run       # only show what would be fetched, and make no requests
 *   npm run ratings -- --retry-unmatched   # also retry places that had no confident match last time
 *
 * Needs GOOGLE_PLACES_KEY (in .env, never in the browser) and SUPABASE_DB_URL (the session-pooler connection string).
 * One request per place: Text Search (New) with only the rating fields asked for. The cap (--limit) is the spending
 * control: the script never makes more requests than that, and it stops at the first quota or permission error.
 *
 * What is stored per place: google_place_id (fine to keep), rating, rating_count, rating_fetched_at (a cache: the app
 * ignores anything older than 30 days, and re-running this script refreshes those). A place Google could not match gets
 * rating_fetched_at set with no rating, so it is not retried on every run.
 *
 * Google's terms limit storing ratings. This is built as a short cache for a demo: check the current Places API terms
 * before launching.
 */
import pg from 'pg';
import { isBigChain, normalizeName } from '../src/lib/chains.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const LIMIT = value('limit', 25);
const CONCURRENCY = Math.min(value('concurrency', 3), 5);
const DRY = flag('dry-run');
const RETRY = flag('retry-unmatched'); // also try places that were checked before but had no match
const STALE_DAYS = 30;
const MAX_METERS = 250; // a Google result farther than this from our pin is not the same place

const key = process.env.GOOGLE_PLACES_KEY;
const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl || (!key && !DRY)) {
  console.error('Set SUPABASE_DB_URL and GOOGLE_PLACES_KEY (see the comment at the top of scripts/fetch-ratings.mjs).');
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query(
  `select id, name, lat, lng, neighborhood_id from places
   where rating_fetched_at is null or rating_fetched_at < now() - ($1 || ' days')::interval
      or ($2::boolean and rating is null)
   order by id`,
  [String(STALE_DAYS), RETRY],
);

// Big chains are hidden in the app, so they are not worth a request. Then spread the batch across neighborhoods
// (a few from each, round-robin) so every area has some stars to show.
const candidates = rows.filter((p) => !isBigChain(p.name));
const byHood = new Map();
for (const p of candidates) {
  const list = byHood.get(p.neighborhood_id ?? 'none') ?? [];
  list.push(p);
  byHood.set(p.neighborhood_id ?? 'none', list);
}
const queue = [];
for (let round = 0; queue.length < LIMIT; round++) {
  let added = false;
  for (const list of byHood.values()) {
    if (list[round] && queue.length < LIMIT) {
      queue.push(list[round]);
      added = true;
    }
  }
  if (!added) break;
}

console.log(`${rows.length} places without a fresh rating, ${candidates.length} after skipping chains; this run: ${queue.length} (limit ${LIMIT}).`);
if (DRY) {
  console.log('dry run, no requests made. First few:', queue.slice(0, 6).map((p) => p.name).join(', '));
  await client.end();
  process.exit(0);
}

const meters = (a, b) => Math.hypot((a.lng - b.lng) * 82400, (a.lat - b.lat) * 111200);

/** Words that say what kind of place it is, not which one: ignored when comparing names. */
const GENERIC = new Set(['the', 'and', 'cafe', 'coffee', 'restaurant', 'bar', 'grill', 'kitchen', 'bakery', 'pizza', 'pizzeria', 'co', 'house', 'boston', 'cambridge']);
const words = (name) => normalizeName(name).split(' ').filter((w) => w && !GENERIC.has(w));

/**
 * Do a business's name and Google's name refer to the same place? `away` is how many meters apart the two pins are.
 * Accepts: the same name (or one inside the other), the same letters with different spacing ("PickN'Roll"), mostly the
 * same words, or, when the pins are almost on top of each other (60 m), the same first word ("Loco" and "Loco Fenway").
 */
function sameName(ours, theirs, away) {
  const x = normalizeName(ours);
  const y = normalizeName(theirs);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const sx = x.replace(/ /g, '');
  const sy = y.replace(/ /g, '');
  if (sx === sy || sx.includes(sy) || sy.includes(sx)) return true;
  const xw = words(ours);
  const yw = words(theirs);
  if (xw.length && yw.length) {
    const shared = yw.filter((w) => xw.includes(w)).length;
    if (shared / Math.max(xw.length, yw.length) >= 0.6) return true;
    if (away <= 60 && xw[0] === yw[0] && xw[0].length >= 3) return true;
  }
  return false;
}

let writes = Promise.resolve();
const save = (sql, params) => (writes = writes.then(() => client.query(sql, params)));

// Google limits Text Search requests per minute, so requests are spaced out (about 4 a second), and a "per minute"
// limit error just waits a minute and carries on. Other errors (permission, daily quota) still stop the run.
const INTERVAL_MS = 250;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextSlot = 0;
async function pace() {
  const wait = Math.max(0, nextSlot - Date.now());
  nextSlot = Date.now() + wait + INTERVAL_MS;
  if (wait) await sleep(wait);
}
let backoffs = 0;

let requests = 0;
let saved = 0;
let noMatch = 0;
let stop = null; // a reason to stop everything (quota, permission)

async function lookup(place) {
  await pace();
  requests += 1;
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.rating,places.userRatingCount',
    },
    body: JSON.stringify({
      textQuery: `${place.name} Boston`,
      maxResultCount: 3,
      locationBias: { circle: { center: { latitude: place.lat, longitude: place.lng }, radius: 200 } },
    }),
  });
  if (res.status === 403 || res.status === 429 || res.status === 400) {
    const body = await res.json().catch(() => ({}));
    const message = String(body.error?.message ?? '').split(key).join('<key>').slice(0, 200);
    if (res.status === 429 && /per minute/i.test(message) && backoffs < 8) {
      backoffs += 1;
      console.log(`  per-minute limit reached: waiting 65 s (${backoffs}/8)`);
      requests -= 1;
      nextSlot = Date.now() + 65000;
      queue.unshift(place); // try this place again after the wait
      return;
    }
    stop = `HTTP ${res.status}: ${message}`;
    return;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { places = [] } = await res.json();
  const match = places.find((g) => {
    if (!g.location) return false;
    const away = meters({ lat: g.location.latitude, lng: g.location.longitude }, place);
    return away <= MAX_METERS && sameName(place.name, g.displayName?.text, away);
  });
  if (!match || match.rating == null) {
    noMatch += 1;
    await save('update places set rating_fetched_at = now() where id = $1', [place.id]);
    return;
  }
  await save(
    'update places set google_place_id = $2, rating = $3, rating_count = $4, rating_fetched_at = now() where id = $1',
    [place.id, match.id, match.rating, match.userRatingCount ?? null],
  );
  saved += 1;
}

const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length && !stop) {
    const place = queue.shift();
    try {
      await lookup(place);
    } catch (err) {
      console.warn(`  skipped ${place.name}: ${err.message}`);
    }
  }
});
await Promise.all(workers);
await writes;

console.log(`\nGoogle requests made: ${requests}`);
console.log(`ratings saved: ${saved}, no confident match: ${noMatch}`);
if (stop) console.log(`STOPPED EARLY: ${stop}`);
const { rows: [totals] } = await client.query(
  `select count(*) filter (where rating is not null)::int as rated, count(*) filter (where rating_fetched_at is not null)::int as checked, count(*)::int as total from places`,
);
console.log(`database now: ${totals.rated} places with a rating, ${totals.checked} checked, ${totals.total} total`);
await client.end();
