import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

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

  return {
    plugins: [react()],
    server: { proxy: mbtaProxy },
    preview: { proxy: mbtaProxy },
  };
});
