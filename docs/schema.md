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
| `active_pet_id` | text, FK to `pets.id` | the pet shown on the dashboard; default `starter`; must be one the user has unlocked |
| `xp` | int | trainer XP, updated by a trigger on `dex_entries` (all entries) |
| `created_at` | timestamptz | |

### `neighborhoods`
The 24 areas (23 Boston neighborhoods plus Cambridge). Public read, no client writes. Seeded from `src/lib/mock/neighborhoods.json`.

| Column | Type | Notes |
|---|---|---|
| `id` | text, PK | slug, e.g. `chinatown-leather-district` |
| `name` | text | |
| `city` | text | `Boston` or `Cambridge` |
| `color` | text | hex |
| `boundary` | geography(MultiPolygon) | for the point-in-polygon join that sets `places.neighborhood_id` |

### `pets`
The 25 pets: one per neighborhood plus the starter. Public read, no client writes. Art lives in `public/pets/`.

| Column | Type | Notes |
|---|---|---|
| `id` | text, PK | the neighborhood id (`allston`, ...) or `starter` |
| `name` | text | the animal, e.g. `Raccoon` (pets have no preset names) |
| `neighborhood_id` | text, nullable, FK to `neighborhoods.id` | null for the starter |
| `is_starter` | bool | |
| `image`, `svg` | text | e.g. `/pets/png/allston.png` |

### `pet_nicknames`
Names users give their pets. Users can only read and write their own rows.

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid, FK to `profiles.id` | primary key together with `pet_id` |
| `pet_id` | text, FK to `pets.id` | |
| `nickname` | text | up to 24 characters |

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
| `neighborhood_id` | text, nullable, FK to `neighborhoods.id` | set by the seed script with a PostGIS point-in-polygon join; null if outside all 24 areas |

### `dex_entries`
A user's collected places. Users can only read and write their own rows.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `user_id` | uuid, FK to `profiles.id` | |
| `place_id` | uuid, FK to `places.id` | unique together with `user_id` |
| `favorite_dish` | text, nullable | up to 80 characters |
| `my_rating` | int, nullable | 1 to 5, the user's own rating |
| `note` | text, nullable | free-text journal note, up to 280 characters |
| `photo_path` | text, nullable | path in the `dex-photos` storage bucket |
| `visited_at` | timestamptz | set by the server when the meal is logged (never by the client), so history can't be backdated |

This table is the food journal. Feeding, levels, badges, and history are all derived from it, so nothing about them is stored.

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
| `addToDex(placeId, {favoriteDish, myRating, note, photo})` | `DexEntry` | logs a meal (this is the feeding). Throws `NOT_SIGNED_IN`, `NOT_FOUND`, or `ALREADY_IN_DEX`. The result also says what the meal did: `fed`, `xp_gained`, `unlocked_pet`, `level_ups`, `new_badges` |
| `updateDexEntry(entryId, {favoriteDish, myRating, note, photo})` | `DexEntry` | edit a journal entry later; `null` clears a field. Throws `NOT_SIGNED_IN`, `NOT_FOUND`, or `INVALID` (rating not 1 to 5) |
| `getFeedingStatus()` | `FeedingStatus` | `meals_today`, `fed_today`, `remaining`, `full` (Boston time) |
| `getPets()` | `Pet[]` | all 25 pets with `unlocked`, `entries`, `xp`, `level`, `max_level`, `next_level_xp`, `badges`, `nickname`, `display_name`, and `active`. Signed out: only the starter is unlocked |
| `setActivePet(petId)` | `Pet` | throws `NOT_SIGNED_IN`, `NOT_FOUND`, or `NOT_UNLOCKED` |
| `setPetNickname(petId, nickname)` | `Pet` | trimmed to 24 characters, empty clears it; same errors as `setActivePet` |
| `getBadges()` | `Badge[]` | all 40 badges with `tier`, `value`, `next_target`, and `tier_earned_at`; includes locked ones so the UI can show progress |
| `getPetHistory(petId)` | `PetHistoryEvent[]` | the pet's story, newest first; `[]` for a locked pet |
| `getPetJournal(petId)` | `PetJournal` | the food-journal entries that fed this pet (the starter sees all), with place, dish, rating, photo, XP, and stats |
| `getNeighborhoodProgress()` | `NeighborhoodProgress[]` | the 24 areas with `entries`, `visited`, and `pet_id`; the dashboard's "7 of 24" is the count of `visited` |
| `getProfile()` | `Profile` or `null` | `null` when signed out. `pet_name` is the active pet's display name |
| `getCurrentUser()` | `User` or `null` | |
| `signInWithGoogle()`, `signOut()` | | |

## Pets

25 pets: one per neighborhood plus the starter Boston Terrier (`id: "starter"`). Pets have no preset names: they are called by their animal, and users nickname them. The art and the pet-by-neighborhood list are in `public/pets/` (see its README); `src/lib/mock/pets.json` is the API's copy, with `id` set to the neighborhood id.

**Design rule: nothing should push anyone to eat out more than they would anyway.** There are no streaks, no hunger, no decay, and nothing is ever lost. Progress is small, capped, and based on when and how you log meals as much as how many.

The mock logic is `src/lib/mock/petEngine.js`, a pure function of the dex. The real backend does the same in SQL (a view over `dex_entries`).

### 1. Feeding and levels

- **Logging a meal feeds the pets.** Each meal feeds the **starter** (who eats everywhere) and the pet of the **neighborhood** the place is in. A neighborhood's pet **unlocks** with your first meal there.
- **A meal is 10 XP, +5 with a photo.** Trainer XP and level (`levelFromXp`, `floor(sqrt(xp/10))`) use the same fed meals.
- **Daily limit: only the first 2 meals per day (Boston time) feed the pets** (`DAILY_FEED_LIMIT`). A third meal is still logged in the journal, can unlock a pet and count toward badges, but gives no XP. So visiting 20 places in a day is worth the same as 2.
- **Levels are quick and capped at 5.** Cumulative XP for levels 1 to 5 is `10, 20, 40, 60, 90` (`PET_LEVEL_XP`), so a pet is fully grown after about 9 meals in its area. `next_level_xp` is `null` at the max.
- A place can only be logged once, so revisiting the same spot can't farm XP.

### 2. Badges

40 badges, all derived from the journal. Neighborhood badges are **worn by that neighborhood's pet**; all the others are worn by the **starter**. Targets are deliberately small, and many reward journaling or variety, not volume. A badge with 2 or 3 tiers shows Bronze / Silver / Gold; one tier shows "Earned".

| Category | Badge | What it takes (tiers) |
|---|---|---|
| Visits | First Bite | log 1 meal |
| Visits | Getting Around | 5 / 12 / 25 different places |
| Where | Neighborhood Hopper | 3 / 6 / 10 different neighborhoods |
| Where | Both Sides of the River | a place in Boston and one in Cambridge |
| When | Night Owl | 3 meals after 10 pm |
| When | Early Bird | 3 meals between 5 and 9 am |
| When | Weekend Brunch | 3 meals on weekends, 9 am to 2 pm |
| Journal | Food Diary | 5 / 15 meals with a dish written down |
| Journal | Photographer | 3 / 10 meals with a photo |
| Journal | Critic | 5 / 15 meals with a rating |
| Variety | Taste Tourist | 4 / 8 different cuisines |
| Variety | Budget Eater | 3 / 8 cheap ($) places |
| Transit | Red, Orange, Green, Blue Line Rider | stamp 3 stations, then about 30% and 50% of the line (Red 3/5/8, Orange 3/5/8, Green 3/12/20, Blue 3/4/5) |
| Neighborhood (24) | `<Area>` Regular | 3 different places in that neighborhood (worn by its pet) |

"Late", "early", and "weekend" use Boston time. `getBadges()` returns every badge with `tier`, `value` (progress), `next_target`, and `tier_earned_at` (the meal that crossed each target).

### 3. Pet history

`getPetHistory(petId)` is the pet's story, newest first, rebuilt by replaying the journal in order. Event types: `unlocked` (it joined), `fed` (a meal fed it, with the XP), `full` (a meal was logged but the pets were full that day, no XP), `level_up`, and `badge`. Every event has a ready-to-show `text`, the `at` time, and the `entry_id` and `place` that caused it. The starter's history is every meal; a neighborhood pet's is its own area plus its badge.

### 4. Food journal

The food journal is `dex_entries`, extended with a free-text `note`. `updateDexEntry()` edits an entry later. `getPetJournal(petId)` shows the journal as one pet sees it: each meal that fed it, with the place, dish, rating, note, photo, whether it was `fed`, and the `xp_gained`, plus stats (meals, photos, rated, average rating, top cuisines, recent dishes, first and last meal). Journaling is the thing rewarded most (photo XP, three journal badges), since it is the part people actually want to keep.

### SQL notes
- `fed` is `row_number() over (partition by user_id, (visited_at at time zone 'America/New_York')::date order by visited_at) <= 2`.
- Pet XP is `sum(case when fed then 10 + (photo_path is not null)::int * 5 else 0 end)` grouped by `places.neighborhood_id` (and over everything for the starter).
- Badge values are `count(distinct ...)` or `count(*) filter (where ...)` over the same rows; `tier_earned_at` needs the replay, or a small `pet_events` table written by a trigger if you want it cheap.

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
