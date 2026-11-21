# Bos(tons) of Eats and Streets

A web app for Boston college students to discover food spots and things to do by MBTA line. Collect places in a Pokedex-style dex and level up a pet as you explore.

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

The app runs on mock data by default (`VITE_USE_MOCK=true`), so no backend is needed. Use "Load demo data" in the header to fill the dex. `npm run fetch:mbta` refreshes `src/lib/mock/mbta.json` from the MBTA API.

Restrict your MapTiler key to your allowed origins in the MapTiler dashboard. `.env` is gitignored and must never be committed.

## Folder ownership

| Path | Owner | Contents |
|---|---|---|
| `supabase/migrations/` | Backend | SQL for tables, RLS, triggers |
| `supabase/functions/` | Backend | Edge functions (`place-details`, `mbta-arrivals`) |
| `scripts/` | Backend | Seed scripts (restaurants, MBTA stops) |
| `src/lib/` | Backend (shared contract) | `api.js` data layer, Supabase client, mock data |
| `src/features/map/`, `src/features/place/` | Map and place card | Map view, filters, place details |
| `src/features/dex/`, `src/features/pet/`, `src/features/stamps/` | Dex and pet | Dex UI, check-in, pet XP and levels, station stamps and line badges |
| `src/styles/` | Dex and pet | Theme and shared styles |
| `docs/` | Everyone | Schema and notes |

## Rules

- UI code only talks to `src/lib/api.js`, never to Supabase directly.
- Set `VITE_USE_MOCK=true` to develop against mock data without the backend.
- Work on a branch (`feat/map`, `feat/dex`, `feat/data`) and merge to `main` through small pull requests.
- Never commit `.env`. Copy `.env.example` and fill in the values shared with you privately.
