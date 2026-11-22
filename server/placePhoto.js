/**
 * The place-photo endpoint for the Vite dev server (and `vite preview`): GET /api/place-photo?id=<google place id>
 * The logic is in placePhotoCore.js, which Cloudflare Pages uses too (functions/api/place-photo.js).
 */
import { createSpender, lookupPlacePhoto } from './placePhotoCore.js';

/**
 * @param {Object} options
 * @param {string} [options.key]       Google Places API key (server side only)
 * @param {number} [options.dailyCap]  most Google requests per day this process will make
 * @param {typeof fetch} [options.fetchImpl]
 */
export function createPlacePhotoHandler({ key, dailyCap = 500, fetchImpl = fetch } = {}) {
  const spend = createSpender(dailyCap);
  return async function placePhoto(req, res) {
    const id = new URL(req.url, 'http://localhost').searchParams.get('id') ?? '';
    const { status, payload } = await lookupPlacePhoto({ id, key, spend, fetchImpl });
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(payload));
  };
}
