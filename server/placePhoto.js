/**
 * The place-photo endpoint: GET /api/place-photo?id=<google place id>
 *
 * The browser never sees the Google key. This handler asks Google for the place's first photo and returns
 * { url, attributions }. The url is Google's own short-lived image link, so photos are loaded live from Google when a
 * place card opens and are never downloaded or stored by us (Google's terms limit storing Places content, and
 * require showing the photographer's attribution wherever the photo appears).
 *
 * It is plain Node with no dependencies, so the same handler runs in the Vite dev server today and in a small server
 * (for example on a Vultr machine) later. Each call makes two billable Google requests (place photos list, then the
 * image link), and a daily cap on those requests is the spending control.
 */

const PLACE_ID = /^[A-Za-z0-9_-]{10,200}$/; // Google place ids look like "ChIJ..."; anything else is rejected
const TIMEOUT_MS = 6000;

/**
 * @param {Object} options
 * @param {string} [options.key]        Google Places API key (server side only)
 * @param {number} [options.dailyCap]   most Google requests per day this process will make
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createPlacePhotoHandler({ key, dailyCap = 500, fetchImpl = fetch } = {}) {
  let day = '';
  let used = 0;
  const spend = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      used = 0;
    }
    if (used >= dailyCap) return false;
    used += 1;
    return true;
  };

  const google = async (url, fieldMask) => {
    const res = await fetchImpl(url, {
      headers: { 'X-Goog-Api-Key': key, ...(fieldMask ? { 'X-Goog-FieldMask': fieldMask } : {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const send = (res, status, payload) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
  };

  return async function placePhoto(req, res) {
    try {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id') ?? '';
      if (!PLACE_ID.test(id)) return send(res, 400, { error: 'bad_id' });
      if (!key) return send(res, 503, { error: 'not_configured' });
      if (!spend()) return send(res, 429, { error: 'daily_cap' });

      // 1. Which photos does the place have, and who took them?
      const details = await google(`https://places.googleapis.com/v1/places/${id}`, 'photos.name,photos.authorAttributions');
      if (details.status === 404) return send(res, 200, { photo: null });
      if (details.status !== 200) return send(res, 502, { error: 'upstream' });
      const photo = details.body.photos?.[0];
      if (!photo?.name) return send(res, 200, { photo: null });

      // 2. A short-lived link to the image itself.
      if (!spend()) return send(res, 429, { error: 'daily_cap' });
      const media = await google(`https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=720&skipHttpRedirect=true`);
      if (media.status !== 200 || !media.body.photoUri) return send(res, 502, { error: 'upstream' });

      return send(res, 200, {
        photo: {
          url: media.body.photoUri,
          attributions: (photo.authorAttributions ?? []).map((a) => ({ name: a.displayName ?? '', uri: a.uri ?? '' })),
        },
      });
    } catch {
      return send(res, 502, { error: 'upstream' }); // timeouts and network errors: never leak details
    }
  };
}
