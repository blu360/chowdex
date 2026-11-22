# Chowdex

![Chowdex](public/banner.png)

Find local food in Boston by T line. Log places to your dex, stamp stations, and collect a pet in every neighborhood. 

Built for: BostonHacks ("Bos(tons) of Eats and Streets track") and submitted to the GoDaddy track.

Live at [chowdex.boston](https://chowdex.boston).

## Features

- A map of about 1,600 local places (chains and dining halls are left out), with live MBTA trains
- A dex, station stamps, and 25 pets that level up as you eat around the city
- Directions by T with live wait times and a carbon comparison against driving
- Pick your school to see nearby picks, a campus leaderboard, and what classmates log
- Photos, Google ratings, estimated prices, and open or closed right now

## Built with

React, Vite, MapLibre GL, Supabase (Postgres, PostGIS, Google sign-in), Cloudflare Workers, the MBTA V3 API, OpenStreetMap, and Google Places.

## Run it locally

You need Node.js.

```
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173. With `VITE_USE_MOCK=true` in `.env`, the app runs on sample data and needs no backend. Add a free MapTiler key as `VITE_MAPTILER_KEY` for the map.

To use the real backend, set `VITE_USE_MOCK=false` and fill in the Supabase values. Apply `supabase/migrations/` in order, then run `npm run seed`.

## Data credits

Places and hours from OpenStreetMap contributors. Transit data from the MBTA. Photos and ratings from Google Maps.

## License

[MIT](LICENSE)
