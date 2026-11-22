/**
 * The Cloudflare Worker that serves Chowdex: the built site (static files from dist/) plus two small endpoints that
 * hold our secret keys. Configured in wrangler.jsonc; deployed by `npx wrangler deploy` after `npm run build`.
 *
 *   /api/place-photo  -> a live Google photo for a place card (needs the secret GOOGLE_PLACES_KEY)
 *   /mbta/*           -> the MBTA API with our key added   (needs the secret MBTA_API_KEY)
 *   everything else   -> the site's files
 */
import { handleMbta, handlePlacePhoto } from '../server/handlers.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/place-photo') return handlePlacePhoto(request, env);
    if (pathname.startsWith('/mbta/')) return handleMbta(request, env, pathname.slice('/mbta/'.length));
    return env.ASSETS.fetch(request);
  },
};
