/**
 * The real backend: the same functions and shapes as the mock in api.js, backed by Supabase.
 * Only api.js imports this file. Everything it needs from api.js (error helper, game rules, static
 * data) is passed in, so there is no import cycle and it can be tested on its own.
 *
 * Reads come from the tables and views in supabase/migrations/. The views are only readable by signed-in
 * users, so every signed-in-only function checks the session first and returns the "signed out" answer
 * without hitting the database.
 */
import { PET_LEVEL_XP, PET_MAX_LEVEL, petLevelFromXp } from './mock/petEngine.js';
import { arrivalsQuery, parseArrivals } from './mbtaLive.js';
import { isBigChain } from './chains.js';

const BUCKET = 'dex-photos';
const PHOTO_URL_SECONDS = 3600;
const PAGE = 1000; // PostgREST returns at most 1000 rows per request

const CATEGORY_ORDER = ['visits', 'places', 'time', 'journal', 'variety', 'transit', 'neighborhood'];
const STATIC_BADGE_ORDER = [
  'first-bite', 'getting-around', 'neighborhood-hopper', 'both-sides', 'night-owl', 'early-bird',
  'weekend-brunch', 'food-diary', 'photographer', 'critic', 'taste-tourist', 'budget-eater',
];
const TIER_LABELS = { 1: ['Earned'], 2: ['Bronze', 'Gold'], 3: ['Bronze', 'Silver', 'Gold'] };

/**
 * @param {Object} deps
 * @param {(code: string, message: string) => Error} deps.apiError
 * @param {(xp: number) => number} deps.levelFromXp
 * @param {(percent: number) => string} deps.tierFromPercent
 * @param {number} deps.dailyFeedLimit
 * @param {{url?: string, anonKey?: string}} deps.config   Supabase project URL and the public anon key
 * @param {(query: string) => Promise<any>} deps.fetchMbta  MBTA V3 JSON, e.g. "predictions?..."
 * @param {Object} deps.staticApi   getRoutes, getStations, getNeighborhoods, getVehicles (bundled map data and the live feed)
 * @param {Object} deps.data        { mbta, neighborhoods, pets }: the bundled reference data
 */
export function createSupabaseApi({ apiError, levelFromXp, tierFromPercent, dailyFeedLimit, config, fetchMbta, staticApi, data }) {
  const { mbta, neighborhoods, pets } = data;
  const hoodById = Object.fromEntries(neighborhoods.features.map((f) => [f.properties.id, f.properties]));
  const petById = new Map(pets.map((p) => [p.id, p]));

  /* -------------------------------- Client -------------------------------- */

  let clientPromise;
  const client = () =>
    (clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) => {
      if (!config.url || !config.anonKey) {
        throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env (or set VITE_USE_MOCK=true).');
      }
      return createClient(config.url, config.anonKey, {
        // `config.storage` is only for tests; in the browser the default (localStorage) is used.
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: config.storage },
      });
    }));

  async function currentSession() {
    const sb = await client();
    const { data: result } = await sb.auth.getSession();
    return result.session;
  }

  async function requireSession(message) {
    const session = await currentSession();
    if (!session) throw apiError('NOT_SIGNED_IN', message);
    return session;
  }

  /** Unwraps a Supabase result, turning database errors into API errors. */
  function must({ data: result, error }) {
    if (!error) return result;
    if (error.code === '42501') throw apiError('NOT_SIGNED_IN', 'Sign in first');
    if (error.message?.startsWith('NOT_UNLOCKED')) throw apiError('NOT_UNLOCKED', error.message.replace(/^NOT_UNLOCKED:\s*/, ''));
    throw Object.assign(new Error(error.message), { code: error.code });
  }

  /* -------------------------------- Helpers -------------------------------- */

  const clean = (text, max) => String(text ?? '').trim().slice(0, max) || null;
  const hoodRef = (id) => (id && hoodById[id] ? { id, name: hoodById[id].name } : null);

  /** Signed, expiring links for private photos: path -> url. */
  async function signPhotos(paths) {
    const unique = [...new Set(paths.filter(Boolean))];
    if (!unique.length) return {};
    const sb = await client();
    const signed = must(await sb.storage.from(BUCKET).createSignedUrls(unique, PHOTO_URL_SECONDS));
    return Object.fromEntries(signed.filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  }

  async function uploadPhoto(userId, file) {
    const sb = await client();
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    must(await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg' }));
    return path;
  }

  async function removePhotos(paths) {
    const list = paths.filter(Boolean);
    if (!list.length) return;
    try {
      const sb = await client();
      await sb.storage.from(BUCKET).remove(list);
    } catch {
      // an orphaned file is harmless; the entry change already succeeded
    }
  }

  const toEntry = (row, urls) => ({
    id: row.id,
    place_id: row.place_id,
    favorite_dish: row.favorite_dish ?? null,
    my_rating: row.my_rating ?? null,
    note: row.note ?? null,
    photo_url: row.photo_path ? urls[row.photo_path] ?? null : null,
    visited_at: row.visited_at,
  });

  /* -------------------------------- Places -------------------------------- */

  const PLACE_COLUMNS =
    'id,name,lat,lng,cuisine,price_level,opening_hours,open_late,website,google_place_id,nearest_stop_distance_m,neighborhood_id,rating,rating_count,rating_fetched_at,stop:mbta_stops(id,name,lines)';

  /** Cached Google ratings are only shown for this long after they were fetched (Google's terms limit storing them). */
  const RATING_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
  const ratingsById = new Map(); // place id -> { rating, rating_count } (only fresh ones)

  let placesPromise;
  /** All ~2,000 places, loaded once and filtered in the browser (the list is small and public). */
  function allPlaces() {
    placesPromise ??= (async () => {
      const sb = await client();
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        const page = must(await sb.from('places').select(PLACE_COLUMNS).order('id').range(from, from + PAGE - 1));
        rows.push(...page);
        if (page.length < PAGE) break;
      }
      ratingsById.clear();
      for (const r of rows) {
        const fresh = r.rating != null && r.rating_fetched_at && Date.now() - new Date(r.rating_fetched_at).getTime() < RATING_MAX_AGE_MS;
        if (fresh) ratingsById.set(r.id, { rating: Number(r.rating), rating_count: r.rating_count ?? null });
      }
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        cuisine: r.cuisine,
        price_level: r.price_level,
        opening_hours: r.opening_hours,
        open_late: r.open_late,
        website: r.website,
        google_place_id: r.google_place_id,
        nearest_stop: r.stop
          ? { id: r.stop.id, name: r.stop.name, lines: r.stop.lines, distance_m: r.nearest_stop_distance_m }
          : null,
        neighborhood: hoodRef(r.neighborhood_id),
      }));
    })().catch((err) => {
      placesPromise = undefined; // let the next call retry
      throw err;
    });
    return placesPromise;
  }

  /* ---------------------------- Pets, badges, history ---------------------------- */

  const badgeSort = (a, b) => {
    const rank = (x) => CATEGORY_ORDER.indexOf(x.category);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.category === 'neighborhood') return a.name.localeCompare(b.name);
    const order = (x) => {
      if (x.category === 'transit') return mbta.lines.findIndex((l) => `rider-${l.id.toLowerCase()}` === x.id);
      return STATIC_BADGE_ORDER.indexOf(x.id);
    };
    return order(a) - order(b);
  };

  let defsPromise;
  const badgeDefs = () =>
    (defsPromise ??= client()
      .then(async (sb) => must(await sb.from('badge_defs').select('id,name,description,category,tiers,pet_id')))
      .catch((err) => {
        defsPromise = undefined;
        throw err;
      }));

  function toBadge(def, row) {
    const tiers = def.tiers;
    const value = row?.value ?? 0;
    const tier = tiers.filter((t) => value >= t).length;
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      category: def.category,
      pet_id: def.pet_id,
      tiers,
      tier_labels: TIER_LABELS[tiers.length],
      tier,
      earned: tier > 0,
      value,
      next_target: tiers[tier] ?? null,
      tier_earned_at: tiers.map((_, i) => row?.tier_earned_at?.[i] ?? null),
    };
  }

  async function loadBadges() {
    const defs = await badgeDefs();
    const session = await currentSession();
    let rows = [];
    if (session) {
      const sb = await client();
      rows = must(await sb.from('user_badges').select('badge_id,value,tier_earned_at'));
    }
    const byId = new Map(rows.map((r) => [r.badge_id, r]));
    return defs.map((d) => toBadge(d, byId.get(d.id))).sort(badgeSort);
  }

  /** Every pet with this user's progress. Signed out: only the starter is unlocked. */
  async function loadPets() {
    const session = await currentSession();
    let stats = [];
    let unlocks = [];
    let nicknames = [];
    let active = 'starter';
    let badges = [];
    if (session) {
      const sb = await client();
      const [s, u, n, p, b] = await Promise.all([
        sb.from('pet_stats').select('pet_id,entries,xp'),
        sb.from('pet_events').select('pet_id,at').eq('type', 'unlocked'),
        sb.from('pet_nicknames').select('pet_id,nickname'),
        sb.from('profiles').select('active_pet_id').maybeSingle(),
        loadBadges(),
      ]);
      stats = must(s);
      unlocks = must(u);
      nicknames = must(n);
      active = must(p)?.active_pet_id ?? 'starter';
      badges = b;
    }
    const statOf = Object.fromEntries(stats.map((r) => [r.pet_id, r]));
    const unlockedAt = Object.fromEntries(unlocks.map((r) => [r.pet_id, r.at]));
    const nick = Object.fromEntries(nicknames.map((r) => [r.pet_id, r.nickname]));

    return pets.map((p) => {
      const stat = statOf[p.id];
      const xp = stat?.xp ?? 0;
      const level = petLevelFromXp(xp);
      const entries = stat?.entries ?? 0;
      return {
        ...p,
        nickname: nick[p.id] ?? null,
        display_name: nick[p.id] ?? p.name,
        neighborhood: hoodRef(p.neighborhood_id),
        unlocked: p.is_starter || entries > 0,
        unlocked_at: unlockedAt[p.id] ?? null,
        entries,
        xp,
        level,
        next_level_xp: PET_LEVEL_XP[level] ?? null,
        max_level: PET_MAX_LEVEL,
        badges: badges
          .filter((b) => b.pet_id === p.id && b.tier > 0)
          .map((b) => ({ id: b.id, name: b.name, tier: b.tier, tier_label: b.tier_labels[b.tier - 1] })),
        active: p.id === active,
      };
    });
  }

  /** A row of the pet_events view -> a PetHistoryEvent. */
  function toEvent(r) {
    const event = {
      type: r.type,
      pet_id: r.pet_id,
      at: r.at,
      text: r.text,
      entry_id: r.entry_id,
      place: r.place_id ? { id: r.place_id, name: r.place_name } : null,
    };
    if (r.type === 'fed' || r.type === 'full') event.xp = r.xp ?? 0;
    if (r.type === 'level_up') Object.assign(event, { level: r.level, from: r.from_level });
    if (r.type === 'badge') Object.assign(event, { badge_id: r.badge_id, tier: r.tier });
    return event;
  }

  const byNewest = (query) => query.order('at', { ascending: false }).order('sort_key', { ascending: false });

  /* ------------------------------- The API ------------------------------- */

  const api = {
    // Bundled map data and the live train feed work the same in both modes.
    getRoutes: staticApi.getRoutes,
    getStations: staticApi.getStations,
    getNeighborhoods: staticApi.getNeighborhoods,
    getVehicles: staticApi.getVehicles,

    async getPlaces(filters = {}) {
      const { query, cuisine, maxPrice, line, openLate, bounds } = filters;
      const cuisines = cuisine ? [].concat(cuisine) : null;
      const q = query ? query.trim().toLowerCase() : '';
      return (await allPlaces()).filter((p) => {
        // Chowdex is for local spots, so big chains are left out of the map and search (see chains.js).
        // getPlace() still finds them, so a chain someone already logged keeps working in their dex.
        if (isBigChain(p.name)) return false;
        if (q && !p.name.toLowerCase().includes(q)) return false;
        if (cuisines && !cuisines.includes(p.cuisine)) return false;
        if (maxPrice && p.price_level != null && p.price_level > maxPrice) return false;
        if (line && !p.nearest_stop?.lines.includes(line)) return false;
        if (openLate && !p.open_late) return false;
        if (bounds) {
          if (p.lat < bounds.south || p.lat > bounds.north) return false;
          if (p.lng < bounds.west || p.lng > bounds.east) return false;
        }
        return true;
      });
    },

    async getPlace(id) {
      const place = (await allPlaces()).find((p) => p.id === id);
      if (!place) throw apiError('NOT_FOUND', `Place not found: ${id}`);
      // Ratings are a cache saved by scripts/fetch-ratings.mjs (never fetched while someone is using the app).
      // Places without a fresh cached rating show "No ratings yet".
      const cached = ratingsById.get(id);
      return { ...place, details: { rating: cached?.rating ?? null, rating_count: cached?.rating_count ?? null, open_now: null } };
    },

    async getArrivals(stopId) {
      try {
        return parseArrivals(await fetchMbta(arrivalsQuery(stopId)));
      } catch {
        return [];
      }
    },

    async getStamps() {
      const session = await currentSession();
      const rows = session ? must(await (await client()).from('user_stamps').select('stop_id,place_ids')) : [];
      const by_station = Object.fromEntries(rows.map((r) => [r.stop_id, r.place_ids]));
      const lines = mbta.lines.map((l) => {
        const total = l.station_ids.length;
        const stamped = l.station_ids.filter((id) => by_station[id]).length;
        const percent = total ? Math.floor((100 * stamped) / total) : 0;
        return { id: l.id, name: l.name, color: l.color, stamped, total, percent, tier: tierFromPercent(percent) };
      });
      return { by_station, lines, stamped_total: Object.keys(by_station).length, station_total: mbta.stations.length };
    },

    async getDex() {
      if (!(await currentSession())) return [];
      const sb = await client();
      const rows = must(
        await sb.from('dex_entries').select('id,place_id,favorite_dish,my_rating,note,photo_path,visited_at').order('visited_at'),
      );
      const urls = await signPhotos(rows.map((r) => r.photo_path));
      return rows.map((r) => toEntry(r, urls));
    },

    getPets: loadPets,

    async setActivePet(petId) {
      const session = await requireSession('Sign in to choose a pet');
      const pet = petById.get(petId);
      if (!pet) throw apiError('NOT_FOUND', `Pet not found: ${petId}`);
      const sb = await client();
      must(await sb.from('profiles').update({ active_pet_id: petId }).eq('id', session.user.id));
      return (await loadPets()).find((p) => p.id === petId);
    },

    async setPetNickname(petId, nickname) {
      const session = await requireSession('Sign in to name a pet');
      if (!petById.has(petId)) throw apiError('NOT_FOUND', `Pet not found: ${petId}`);
      const sb = await client();
      const name = clean(nickname, 24);
      if (name) {
        must(await sb.from('pet_nicknames').upsert({ user_id: session.user.id, pet_id: petId, nickname: name }));
      } else {
        must(await sb.from('pet_nicknames').delete().eq('user_id', session.user.id).eq('pet_id', petId));
      }
      return (await loadPets()).find((p) => p.id === petId);
    },

    async getNeighborhoodProgress() {
      const session = await currentSession();
      const rows = session ? must(await (await client()).from('neighborhood_progress').select('neighborhood_id,entries')) : [];
      const counts = Object.fromEntries(rows.map((r) => [r.neighborhood_id, r.entries]));
      return neighborhoods.features
        .map((f) => ({
          id: f.properties.id,
          name: f.properties.name,
          city: f.properties.city,
          color: f.properties.color,
          entries: counts[f.properties.id] ?? 0,
          visited: Boolean(counts[f.properties.id]),
          pet_id: pets.find((p) => p.neighborhood_id === f.properties.id).id,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async addToDex(placeId, { favoriteDish = null, myRating = null, note = null, photo = null } = {}) {
      const session = await requireSession('Sign in to add to your dex');
      const userId = session.user.id;
      const place = (await allPlaces()).find((p) => p.id === placeId);
      if (!place) throw apiError('NOT_FOUND', `Place not found: ${placeId}`);
      if (myRating != null && !(myRating >= 1 && myRating <= 5)) throw apiError('INVALID', 'Rating must be 1 to 5');

      const sb = await client();
      const photo_path = photo ? await uploadPhoto(userId, photo) : null;
      const { data: row, error } = await sb
        .from('dex_entries')
        .insert({
          user_id: userId,
          place_id: placeId,
          favorite_dish: clean(favoriteDish, 80),
          my_rating: myRating ?? null,
          note: clean(note, 280),
          photo_path,
        })
        .select('id,place_id,favorite_dish,my_rating,note,photo_path,visited_at')
        .single();
      if (error) {
        await removePhotos([photo_path]);
        if (error.code === '23505') throw apiError('ALREADY_IN_DEX', 'This place is already in your dex');
        if (error.code === '23503') throw apiError('NOT_FOUND', `Place not found: ${placeId}`);
        must({ error });
      }

      // What did this meal do? The history view replays the journal, so ask it about this entry.
      const events = must(await sb.from('pet_events').select('*').eq('entry_id', row.id));
      const defs = await badgeDefs();
      const mine = (type) => events.filter((e) => e.type === type);
      const meal = mine('fed')[0] ?? mine('full')[0];
      const unlocked = mine('unlocked')[0];
      const urls = await signPhotos([row.photo_path]);

      return {
        ...toEntry(row, urls),
        fed: meal ? meal.type === 'fed' : false,
        xp_gained: meal?.xp ?? 0,
        unlocked_pet: unlocked ? (await loadPets()).find((p) => p.id === unlocked.pet_id) : null,
        level_ups: mine('level_up').map((e) => ({ pet_id: e.pet_id, from: e.from_level, to: e.level })),
        new_badges: mine('badge').map((e) => {
          const def = defs.find((d) => d.id === e.badge_id);
          return {
            badge_id: e.badge_id,
            name: def.name,
            tier: e.tier,
            tier_label: TIER_LABELS[def.tiers.length][e.tier - 1],
            pet_id: e.pet_id,
          };
        }),
      };
    },

    async updateDexEntry(entryId, { favoriteDish, myRating, note, photo } = {}) {
      const session = await requireSession('Sign in to edit your journal');
      const sb = await client();
      const patch = {};
      if (favoriteDish !== undefined) patch.favorite_dish = clean(favoriteDish, 80);
      if (myRating !== undefined) {
        if (myRating !== null && !(myRating >= 1 && myRating <= 5)) throw apiError('INVALID', 'Rating must be 1 to 5');
        patch.my_rating = myRating;
      }
      if (note !== undefined) patch.note = clean(note, 280);

      const existing = must(await sb.from('dex_entries').select('photo_path').eq('id', entryId).maybeSingle());
      if (!existing) throw apiError('NOT_FOUND', `Journal entry not found: ${entryId}`);
      let oldPhoto = null;
      if (photo !== undefined) {
        oldPhoto = existing.photo_path;
        patch.photo_path = photo ? await uploadPhoto(session.user.id, photo) : null;
      }

      let row = null;
      if (Object.keys(patch).length) {
        const result = await sb
          .from('dex_entries')
          .update(patch)
          .eq('id', entryId)
          .select('id,place_id,favorite_dish,my_rating,note,photo_path,visited_at')
          .maybeSingle();
        if (result.error) await removePhotos([patch.photo_path]);
        row = must(result);
      } else {
        row = must(
          await sb.from('dex_entries').select('id,place_id,favorite_dish,my_rating,note,photo_path,visited_at').eq('id', entryId).maybeSingle(),
        );
      }
      if (!row) throw apiError('NOT_FOUND', `Journal entry not found: ${entryId}`);
      if (photo !== undefined) await removePhotos([oldPhoto]);
      return toEntry(row, await signPhotos([row.photo_path]));
    },

    async deleteDexEntry(entryId) {
      await requireSession('Sign in to edit your journal');
      const sb = await client();
      const row = must(await sb.from('dex_entries').select('photo_path').eq('id', entryId).maybeSingle());
      if (!row) throw apiError('NOT_FOUND', `Journal entry not found: ${entryId}`);
      must(await sb.from('dex_entries').delete().eq('id', entryId));
      await removePhotos([row.photo_path]);
    },

    async getActivity({ limit = 40 } = {}) {
      if (!(await currentSession())) return [];
      const sb = await client();
      return must(await byNewest(sb.from('pet_events').select('*')).limit(limit)).map(toEvent);
    },

    async getFeedingStatus() {
      const session = await currentSession();
      let row = null;
      if (session) row = must(await (await client()).from('feeding_status').select('meals_today,fed_today,remaining,full').maybeSingle());
      const meals = row?.meals_today ?? 0;
      return {
        daily_limit: dailyFeedLimit,
        meals_today: meals,
        fed_today: row?.fed_today ?? 0,
        remaining: row?.remaining ?? dailyFeedLimit,
        full: row?.full ?? false,
      };
    },

    getBadges: loadBadges,

    async getPetHistory(petId) {
      if (!petById.has(petId)) throw apiError('NOT_FOUND', `Pet not found: ${petId}`);
      if (!(await currentSession())) return [];
      const sb = await client();
      return must(await byNewest(sb.from('pet_events').select('*').eq('pet_id', petId))).map(toEvent);
    },

    async getPetJournal(petId) {
      if (!petById.has(petId)) throw apiError('NOT_FOUND', `Pet not found: ${petId}`);
      let rows = [];
      if (await currentSession()) {
        const sb = await client();
        rows = must(await sb.from('pet_journal').select('*').eq('pet_id', petId).order('visited_at', { ascending: false }));
      }
      const urls = await signPhotos(rows.map((r) => r.photo_path));
      const entries = rows.map((r) => ({
        id: r.entry_id,
        place_id: r.place_id,
        favorite_dish: r.favorite_dish ?? null,
        my_rating: r.my_rating ?? null,
        note: r.note ?? null,
        photo_url: r.photo_path ? urls[r.photo_path] ?? null : null,
        visited_at: r.visited_at,
        place: { id: r.place_id, name: r.place_name, cuisine: r.cuisine, price_level: r.price_level, neighborhood: hoodRef(r.neighborhood_id) },
        fed: r.fed,
        xp_gained: r.xp_gained,
      }));

      const ratings = entries.map((e) => e.my_rating).filter(Boolean);
      const cuisineCounts = {};
      for (const e of entries) cuisineCounts[e.place.cuisine] = (cuisineCounts[e.place.cuisine] ?? 0) + 1;
      return {
        pet_id: petId,
        entries,
        stats: {
          meals: entries.length,
          photos: entries.filter((e) => e.photo_url).length,
          rated: ratings.length,
          average_rating: ratings.length ? Math.round((10 * ratings.reduce((a, b) => a + b, 0)) / ratings.length) / 10 : null,
          top_cuisines: Object.entries(cuisineCounts)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 3)
            .map(([cuisine, count]) => ({ cuisine, count })),
          recent_dishes: [...new Set(entries.map((e) => e.favorite_dish).filter(Boolean))].slice(0, 5),
          first_meal_at: entries.length ? entries[entries.length - 1].visited_at : null,
          last_meal_at: entries.length ? entries[0].visited_at : null,
        },
      };
    },

    async getProfile() {
      const session = await currentSession();
      if (!session) return null;
      const sb = await client();
      const [profile, stats, nicknames] = await Promise.all([
        sb.from('profiles').select('id,display_name,active_pet_id').maybeSingle(),
        sb.from('profile_stats').select('xp').maybeSingle(),
        sb.from('pet_nicknames').select('pet_id,nickname'),
      ]);
      const p = must(profile);
      if (!p) return null;
      const xp = must(stats)?.xp ?? 0;
      const nick = must(nicknames).find((n) => n.pet_id === p.active_pet_id)?.nickname;
      return {
        id: p.id,
        display_name: p.display_name,
        pet_name: nick ?? petById.get(p.active_pet_id)?.name ?? 'Boston Terrier',
        active_pet_id: p.active_pet_id,
        xp,
        level: levelFromXp(xp),
      };
    },

    async getCurrentUser() {
      const session = await currentSession();
      if (!session) return null;
      const u = session.user;
      const meta = u.user_metadata ?? {};
      return {
        id: u.id,
        email: u.email ?? '',
        display_name: meta.full_name || meta.name || (u.email ?? 'Explorer').split('@')[0],
      };
    },

    async signInWithGoogle() {
      const sb = await client();
      must(await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } }));
    },

    async signOut() {
      const sb = await client();
      must(await sb.auth.signOut());
    },

    // Demo data is a mock-only feature: meal times are set by the server, so a real account can't be backfilled.
    async loadDemoData() {
      throw apiError('INVALID', 'Demo data is only available in mock mode');
    },
    async resetDemoData() {
      throw apiError('INVALID', 'Demo data is only available in mock mode');
    },
  };

  return api;
}
