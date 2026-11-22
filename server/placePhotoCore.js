/**
 * The place-photo logic, with no web-framework code, so the same thing runs in the Vite dev server
 * (server/placePhoto.js) and on Cloudflare Pages (functions/api/place-photo.js).
 *
 * Asks Google for a place's first photo and returns { status, payload }. The payload's url is Google's own short-lived
 * image link: photos are loaded live from Google and never downloaded or stored by us (Google's terms limit storing
 * Places content and require showing the photographer's credit wherever the photo appears). The Google key stays on
 * the server. Each lookup is two billable Google requests (the photo list, then the image link).
 */

export const PLACE_ID = /^[A-Za-z0-9_-]{10,200}$/; // Google place ids look like "ChIJ..."; anything else is rejected
const TIMEOUT_MS = 6000;

/**
 * A counter that allows at most `cap` Google requests per UTC day, per process. (On Cloudflare each worker instance
 * keeps its own count, so treat it as a best-effort guard: the real cap is the quota set in Google Cloud.)
 */
export function createSpender(cap) {
  let day = '';
  let used = 0;
  return () => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      used = 0;
    }
    if (used >= cap) return false;
    used += 1;
    return true;
  };
}

/**
 * @param {Object} args
 * @param {string} args.id          a Google place id (checked here)
 * @param {string} [args.key]       the Google Places API key (server side only)
 * @param {() => boolean} args.spend  returns false when the daily cap is used up
 * @param {typeof fetch} [args.fetchImpl]
 * @returns {Promise<{status: number, payload: object}>}
 */
export async function lookupPlacePhoto({ id, key, spend, fetchImpl = fetch }) {
  if (!PLACE_ID.test(id ?? '')) return { status: 400, payload: { error: 'bad_id' } };
  if (!key) return { status: 503, payload: { error: 'not_configured' } };

  const google = async (url, fieldMask) => {
    const res = await fetchImpl(url, {
      headers: { 'X-Goog-Api-Key': key, ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  try {
    if (!spend()) return { status: 429, payload: { error: 'daily_cap' } };
    // 1. Which photos does the place have, and who took them?
    const details = await google(`https://places.googleapis.com/v1/places/${id}`, 'photos.name,photos.authorAttributions');
    if (details.status === 404) return { status: 200, payload: { photo: null } };
    if (details.status !== 200) return { status: 502, payload: { error: 'upstream' } };
    const photo = details.body.photos?.[0];
    if (!photo?.name) return { status: 200, payload: { photo: null } };

    // 2. A short-lived link to the image itself.
    if (!spend()) return { status: 429, payload: { error: 'daily_cap' } };
    const media = await google(`https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=720&skipHttpRedirect=true`);
    if (media.status !== 200 || !media.body.photoUri) return { status: 502, payload: { error: 'upstream' } };

    return {
      status: 200,
      payload: {
        photo: {
          url: media.body.photoUri,
          attributions: (photo.authorAttributions ?? []).map((a) => ({ name: a.displayName ?? '', uri: a.uri ?? '' })),
        },
      },
    };
  } catch {
    return { status: 502, payload: { error: 'upstream' } }; // timeouts and network errors: never leak details
  }
}
