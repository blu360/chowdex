import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createPlacePhotoHandler } from './server/placePhoto.js';

export default defineConfig(({ mode }) => {
  // MBTA_API_KEY has no VITE_ prefix on purpose, so it is never sent to the browser.
  // The dev server adds it to MBTA requests made through /mbta. In production, an edge function does this.
  const env = loadEnv(mode, process.cwd(), '');
  const mbtaProxy = {
    '/mbta': {
      target: 'https://api-v3.mbta.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/mbta/, ''),
      headers: env.MBTA_API_KEY ? { 'x-api-key': env.MBTA_API_KEY } : {},
    },
  };

  // /api/place-photo holds the Google key on the server side (see server/placePhoto.js). GOOGLE_PLACES_KEY has no VITE_
  // prefix on purpose. PHOTO_DAILY_CAP limits how many Google requests it may make per day.
  const photos = createPlacePhotoHandler({ key: env.GOOGLE_PLACES_KEY, dailyCap: Number(env.PHOTO_DAILY_CAP) || 500 });
  const photoRoute = {
    name: 'place-photo-route',
    configureServer: (server) => void server.middlewares.use('/api/place-photo', photos),
    configurePreviewServer: (server) => void server.middlewares.use('/api/place-photo', photos),
  };

  return {
    plugins: [react(), photoRoute],
    server: { proxy: mbtaProxy },
    preview: { proxy: mbtaProxy },
  };
});
