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
| `getStations()` | `Station[]` | every subway station: `id`, `name`, `lat`, `lng`, `lines` |
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
- `src/lib/mock/mbta.json` is real MBTA data (4 lines, 118 stations, simplified shapes) generated by `npm run fetch:mbta`. The real backend should seed `mbta_stops` from the same script's output.

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
