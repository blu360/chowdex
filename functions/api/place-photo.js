/** Cloudflare Pages Function for /api/place-photo. The logic is in server/handlers.js (shared with the Worker). */
import { handlePlacePhoto } from '../../server/handlers.js';

export const onRequestGet = ({ request, env }) => handlePlacePhoto(request, env);
