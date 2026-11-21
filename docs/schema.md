# Data contract

The agreement between backend, map/place, and dex/pet. Names and shapes here are what `src/lib/api.js` returns. If you need a change, tell the team before editing.

> `src/lib/mock/places.json` is illustrative data for development. Names are real Boston spots, but coordinates, hours, ratings, and distances are approximate and not verified. The real data comes from the seed script and live API calls.

## Tables (Supabase / Postgres)

### `profiles`
One row per user, created automatically on first Google sign-in.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | same as `auth.users.id` |
| `display_name` | text | from the Google profile |
| `pet_name` | text | user-chosen, default set on signup |
| `xp` | int | updated by a trigger on `dex_entries`; the pet's level is derived from it |
| `created_at` | timestamptz | |

### `places`
Seeded from OpenStreetMap. Public read, no client writes.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `osm_id` | text, unique | e.g. `node/123456` |
| `name` | text | |
| `lat`, `lng` | float | |
| `cuisine` | text | lowercase, e.g. `pizza`, `ramen`, `cafe` |
| `price_level` | int, nullable | 1 to 4, null if unknown |
| `opening_hours` | text, nullable | OSM `opening_hours` syntax |
| `open_late` | bool | open past 1am (after the T stops running); computed by the seed script |
| `website` | text, nullable | |
| `google_place_id` | text, nullable | the only Google data we store |
| `nearest_stop_id` | text, FK to `mbta_stops.id` | computed by the seed script |
| `nearest_stop_distance_m` | int | |

### `dex_entries`
A user's collected places. Users can only read and write their own rows.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `user_id` | uuid, FK to `profiles.id` | |
| `place_id` | uuid, FK to `places.id` | unique together with `user_id` |
| `favorite_dish` | text, nullable | |
| `my_rating` | int, nullable | 1 to 5, the user's own rating |
| `photo_path` | text, nullable | path in the `dex-photos` storage bucket |
| `visited_at` | timestamptz | |

### `mbta_stops`
Reference data. Public read, no client writes.

| Column | Type | Notes |
|---|---|---|
| `id` | text, PK | MBTA id, e.g. `place-chncl` |
| `name` | text | |
| `lat`, `lng` | float | |
| `lines` | text[] | e.g. `{Orange,Red}` |

## What `api.js` returns

### `Place` (from `getPlaces()` and `getPlace()`)

```json
{
  "id": "mock-001",
  "name": "Pho Pasteur",
  "lat": 42.3512,
  "lng": -71.0625,
  "cuisine": "vietnamese",
  "price_level": 2,
  "opening_hours": "Mo-Su 10:00-22:00",
  "open_late": false,
  "website": null,
  "google_place_id": null,
  "nearest_stop": { "id": "place-chncl", "name": "Chinatown", "lines": ["Orange"], "distance_m": 120 }
}
```

`nearest_stop` is the `mbta_stops` row joined onto the place plus `nearest_stop_distance_m`.

### `PlaceDetails` (only on `getPlace()`)

Ratings come live from Google Places when a user opens a place, and are not stored in our database (Google's terms). So `getPlaces()` never includes `details`; only `getPlace(id)` does.

```json
"details": { "rating": 4.4, "rating_count": 1280, "open_now": true }
```

Any of these can be `null` (new place, no data). Handle loading, error, and null states in the UI.

### Other shapes

See the JSDoc typedefs at the top of `src/lib/api.js` for `DexEntry`, `Profile`, `User`, `Arrival`, and `PlaceFilters`.

## Functions

| Function | Returns | Notes |
|---|---|---|
| `getPlaces(filters)` | `Place[]` | filters: `query`, `cuisine`, `maxPrice`, `line`, `openLate`, `bounds` |
| `getPlace(id)` | `Place` + `details` | throws `NOT_FOUND` |
| `getArrivals(stopId)` | `Arrival[]` | live MBTA predictions via an edge function |
| `getRoutes()` | `Line[]` | the four subway lines: official `color`, `station_ids`, and `shapes` (polylines of `[lng, lat]`) |
| `getStations()` | `Station[]` | every subway station in Boston and Cambridge: `id`, `name`, `lat`, `lng`, `lines` |
| `getNeighborhoods()` | GeoJSON `FeatureCollection` | the 24 neighborhood areas with boundary and `color` |
| `getVehicles({simulate})` | `VehicleSnapshot` | live subway trains from the MBTA `/vehicles` feed, only those on the drawn lines. `vehicles` is `null` with `error: true` when the feed is unreachable; `simulate: true` returns made-up, sped-up trains for demos |
| `getStamps()` | `StampSummary` | station stamps and per-line progress, all zeros when signed out |
| `getDex()` | `DexEntry[]` | `[]` when signed out |
| `addToDex(placeId, {favoriteDish, myRating, photo})` | `DexEntry` | throws `NOT_SIGNED_IN` or `ALREADY_IN_DEX` |
| `getProfile()` | `Profile` or `null` | `null` when signed out |
| `getCurrentUser()` | `User` or `null` | |
| `signInWithGoogle()`, `signOut()` | | |

## Game rules

The trigger on `dex_entries` and the mock in `api.js` must agree:

- +10 XP per dex entry, +5 more if it has a photo
- `level = floor(sqrt(xp / 10))`, exported as `levelFromXp()` (0 XP is level 0, 10 is level 1, 40 is level 2, 90 is level 3)

## Station stamps

Stamps are derived from the dex, nothing extra is stored:

- A station is **stamped** when any place in the user's dex is within `STAMP_RADIUS_M` (400 m) of it. In Postgres this is a `ST_DWithin` join between `dex_entries` -> `places` and `mbta_stops`.
- A line's progress is `stamped stations / total stations` on that line. Badge tiers: bronze at 25%, silver at 50%, gold at 100% (`tierFromPercent()`).
- Green is one line made of the B, C, D, and E branches.
- `src/lib/mock/mbta.json` is real MBTA data generated by `npm run fetch:mbta`: 4 lines, **75 stations**, simplified shapes. The real backend should seed `mbta_stops` from the same script's output.

## Coverage: Boston and Cambridge only

The app only covers Boston and Cambridge. `fetch-mbta.mjs` keeps a station only if the MBTA API lists its `municipality` as Boston (69 stations) or Cambridge (6), and drops the other 43 (Somerville, Brookline, Newton, Quincy, Malden, and so on). Each line is cut off at its last in-bounds station, for example Orange ends at Sullivan Square and Blue at Suffolk Downs. The stretch between two kept stations stays, so the Red Line is still continuous through Davis. Seed only Boston and Cambridge restaurants too.

## Live trains

`getVehicles()` returns `{ vehicles, simulated, updated_at }`. Each `Vehicle` has `id`, `line` (Red, Orange, Green, Blue), `route` (for example `Green-B`), `lat`, `lng`, `bearing`, `status`, and `label`. The map polls every 8 seconds and glides each train from its old position to its new one. A train is kept only if it is within 300 m of a drawn line, so nothing shows up outside Boston and Cambridge. On the map each train is snapped onto its line's path (`src/features/map/trainTrack.js`, using `Line.shape_routes` so a Green-B train stays on the B branch) and animated by distance along that path, so it can never cut corners or drift off the track. Small backward GPS wobble is ignored. In the real backend this is an edge function that holds the MBTA key and caches the response for a few seconds.

## Neighborhoods

24 areas: 23 Boston neighborhoods plus Cambridge. `getNeighborhoods()` returns a GeoJSON FeatureCollection; each feature has `properties: { id, name, city, color }`. `color` is a unique hex color (touching neighborhoods get colors far apart on the color wheel); the map draws it as a translucent fill (about 28% opacity) with a thin outline.

`src/lib/mock/neighborhoods.json` is generated by `npm run build:neighborhoods` from:

- City of Boston, *Boston Neighborhood Boundaries* (data.boston.gov). Its names don't match our list one to one, so we merge Chinatown + Leather District, Fenway + Longwood, and South Boston + South Boston Waterfront, and skip Harbor Islands.
- Cambridge's city boundary from OpenStreetMap (ODbL).
- **Wharf District** is not in the city file. It is an approximate, hand-drawn outline cut out of Downtown, so treat its edges as rough.

Two stations (Boston College, Brigham Circle) fall just outside the drawn boundaries because of simplification and water edges. Nothing depends on that yet. When the neighborhood pets are built, assign places to neighborhoods with a PostGIS point-in-polygon join and store `places.neighborhood_id`.

```json
{
  "by_station": { "place-chncl": ["mock-001"] },
  "lines": [{ "id": "Orange", "name": "Orange Line", "color": "#ED8B00", "stamped": 3, "total": 20, "percent": 15, "tier": "none" }],
  "stamped_total": 8,
  "station_total": 118
}
```

## Security (row-level security)

- `places`, `mbta_stops`: anyone can read, nobody writes from the client
- `profiles`, `dex_entries`: users can read and write only rows where the owner is `auth.uid()`
- The service-role key is used only by `scripts/` and edge functions, never in the frontend
