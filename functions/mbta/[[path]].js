/** Cloudflare Pages Function for /mbta/*. The logic is in server/handlers.js (shared with the Worker). */
import { handleMbta } from '../../server/handlers.js';

export const onRequestGet = ({ request, env, params }) => handleMbta(request, env, [].concat(params.path ?? []).join('/'));
