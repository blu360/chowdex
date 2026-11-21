# Chowdex

A web app for Boston college students to discover food spots by MBTA line. Collect places in a Pokedex-style dex, stamp T stations, and level up as you explore Boston and Cambridge. Built for BostonHacks ("Bos(tons) of Eats and Streets").

The look is a Boston blue theme; the only bold colors on the map besides that are the official MBTA line colors.

## Stack

- Frontend: React + Vite (PWA), MapLibre GL JS
- Backend: Supabase (Postgres + PostGIS, Auth with Google sign-in, Storage, Edge Functions)
- Data: OpenStreetMap (Overpass), MBTA V3 API, Google Places

## Run it locally

You need Node.js (LTS).

```
npm install
cp .env.example .env     # then fill in VITE_MAPTILER_KEY (free key from maptiler.com)
npm run dev              # http://localhost:5173
```

The app runs on mock data by default (`VITE_USE_MOCK=true`), so no backend is needed. Use "Load demo data" in the account menu (top right) to fill the dex. `npm run fetch:mbta` refreshes `src/lib/mock/mbta.json` from the MBTA API (Boston and Cambridge stations only). `npm run build:neighborhoods` rebuilds `src/lib/mock/neighborhoods.json`, the 24 colored neighborhood areas.

Keys:

- `VITE_MAPTILER_KEY` is used by the browser, so restrict it to your allowed origins in the MapTiler dashboard.
- `MBTA_API_KEY` (free from api-v3.mbta.com) is **not** sent to the browser. The Vite dev server adds it to requests made to `/mbta/...` (see `vite.config.js`), which is how live trains are fetched. Without a key the app falls back to the public API at a lower rate limit, and then to simulated trains. In production an edge function should do what the proxy does.
- `.env` is gitignored and must never be committed.

Design: a doodled transit-map look inspired by the BostonHacks site: a calm backdrop of soft pastel color washes (the MBTA line colors, very faint), thick line colors, black marker outlines with hard offset shadows, and yellow highlighter. Fonts (Akshar, Noto Sans, Permanent Marker) load from Google Fonts. Changing pages or signing in plays a train animation (`src/components/TrainTransition.jsx`): the Green, Red, Orange, and Blue Line trains take turns, drawn after the MBTA Green Line car. It is skipped for people who prefer reduced motion.

Map: the basemap is swappable in the layers panel (Clean, Soft, Streets, Classic, Night). Streets only appear once you zoom in, and panning is limited to the Boston area (`src/features/map/mapStyles.js`).

## Folder ownership

| Path | Owner | Contents |
|---|---|---|
| `supabase/migrations/` | Backend | SQL for tables, RLS, triggers |
| `supabase/functions/` | Backend | Edge functions (`place-details`, `mbta-arrivals`) |
| `scripts/` | Backend | Seed scripts (restaurants, MBTA stops) |
| `src/lib/` | Backend (shared contract) | `api.js` data layer, Supabase client, mock data |
| `src/features/map/`, `src/features/place/` | Map and place card | Map view, search, filters, legend, live trains, place details |
| `src/features/dex/`, `src/features/pet/`, `src/features/stamps/` | Dex and pet | Dex UI, check-in, pet XP and levels, station stamps and line badges |
| `src/styles/`, `src/components/` | Dex and pet | Theme and shared styles; trains, doodles, and the page transition |
| `docs/` | Everyone | Schema and notes |

## Rules

- UI code only talks to `src/lib/api.js`, never to Supabase directly.
- Set `VITE_USE_MOCK=true` to develop against mock data without the backend.
- Work on a branch (`feat/map`, `feat/dex`, `feat/data`) and merge to `main` through small pull requests.
- Never commit `.env`. Copy `.env.example` and fill in the values shared with you privately.
