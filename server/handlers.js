/**
 * The two server-side endpoints as plain web-standard handlers (Request in, Response out), so the same code runs as
 * a Cloudflare Worker (worker/index.js) or as Cloudflare Pages Functions (functions/). Secrets come from `env`.
 */
import { createSpender, lookupPlacePhoto } from './placePhotoCore.js';

let spend; // one counter per worker instance

/** GET /api/place-photo?id=<google place id>  (secret: GOOGLE_PLACES_KEY; optional PHOTO_DAILY_CAP) */
export async function handlePlacePhoto(request, env) {
  spend ??= createSpender(Number(env.PHOTO_DAILY_CAP) || 500);
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const { status, payload } = await lookupPlacePhoto({ id, key: env.GOOGLE_PLACES_KEY, spend });
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

const MBTA_ALLOWED = /^(vehicles|predictions|routes|stops|shapes|schedules|trips|alerts|lines|services)(\/|$)/;
const MBTA_CACHE_SECONDS = 8;

/**
 * GET /mbta/<path>: forwards read-only requests to the MBTA V3 API and adds our key (secret: MBTA_API_KEY) so it never
 * reaches the browser. Answers are cached for a few seconds at the edge, so many people watching the same trains cost
 * one MBTA request.
 */
export async function handleMbta(request, env, path) {
  if (request.method !== 'GET' || !MBTA_ALLOWED.test(path)) return new Response('Not found', { status: 404 });
  const upstream = new URL(`https://api-v3.mbta.com/${path}`);
  upstream.search = new URL(request.url).search;
  const res = await fetch(upstream, {
    headers: { accept: 'application/vnd.api+json', ...(env.MBTA_API_KEY ? { 'x-api-key': env.MBTA_API_KEY } : {}) },
    cf: { cacheTtl: MBTA_CACHE_SECONDS, cacheEverything: true },
  });
  return new Response(res.body, {
    status: res.status,
    headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${MBTA_CACHE_SECONDS}` },
  });
}
