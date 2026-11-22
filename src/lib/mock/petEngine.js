/**
 * The pet rules, as a pure function of the user's dex (their food journal).
 * Mock only: the real backend computes the same things in SQL from `dex_entries`.
 *
 * Design goals: nothing here should push people to eat out more than they would anyway.
 *  - Only the first DAILY_FEED_LIMIT meals each day feed the pets. More are still logged, for no XP.
 *  - Levels are quick: a pet is fully grown at level 5, about 9 meals.
 *  - Badges have small targets, and many reward journaling or variety, not volume.
 *  - Nothing ever decays: no hunger, no streaks, no lost progress.
 */

/** How many meals a day can feed the pets. A third meal is still logged, it just gives no XP. */
export const DAILY_FEED_LIMIT = 2;

/** Cumulative XP needed for pet levels 1 to 5. A meal is 10 XP (+5 with a photo): about 9 meals to level 5. */
export const PET_LEVEL_XP = [10, 20, 40, 60, 90];
export const PET_MAX_LEVEL = PET_LEVEL_XP.length;

export const petLevelFromXp = (xp) => PET_LEVEL_XP.filter((t) => xp >= t).length;
/** XP for the next level, or null at the max level. */
export const nextPetLevelXp = (xp) => PET_LEVEL_XP[petLevelFromXp(xp)] ?? null;

/** Boston time decides what counts as "late night" or "breakfast". */
const TIME_ZONE = 'America/New_York';
const FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  hour: 'numeric',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** @returns {{day: string, hour: number, weekend: boolean}} Boston-local calendar day, hour (0 to 23), and weekend flag */
export function localParts(iso) {
  const p = Object.fromEntries(FORMAT.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekend: p.weekday === 'Sat' || p.weekday === 'Sun' };
}

const TIER_LABELS = { 1: ['Earned'], 2: ['Bronze', 'Gold'], 3: ['Bronze', 'Silver', 'Gold'] };

/**
 * @param {Object} deps
 * @param {Array} deps.places        mock places, each with `neighborhood`
 * @param {Array} deps.pets          the 25 pets
 * @param {Array} deps.neighborhoods neighborhood GeoJSON features
 * @param {Array} deps.lines         subway lines (with station_ids)
 * @param {(places: Array) => Object} deps.stampsFor   places -> { stationId: [placeIds] } (the stamp rule)
 * @param {(entry: Object) => number} deps.entryXp     XP one fed meal is worth
 */
export function createPetEngine({ places, pets, neighborhoods, lines, stampsFor, entryXp }) {
  const placeById = new Map(places.map((p) => [p.id, p]));
  const starter = pets.find((p) => p.is_starter);
  const petById = new Map(pets.map((p) => [p.id, p]));
  const hoodProps = Object.fromEntries(neighborhoods.map((f) => [f.properties.id, f.properties]));

  /* ------------------------------ Badge catalog ------------------------------ */

  const def = (id, name, description, category, tiers, metric, pet_id = starter.id) => ({
    id, name, description, category, tiers, metric, pet_id,
    tier_labels: TIER_LABELS[tiers.length],
  });

  const badgeDefs = [
    // Visits: modest on purpose
    def('first-bite', 'First Bite', 'Log your first meal.', 'visits', [1], (c) => c.entries.length),
    def('getting-around', 'Getting Around', 'Try different places.', 'visits', [5, 12, 25], (c) => c.placeIds.size),

    // Where you have been
    def('neighborhood-hopper', 'Neighborhood Hopper', 'Eat in different neighborhoods.', 'places', [3, 6, 10], (c) => c.hoods.size),
    def('both-sides', 'Both Sides of the River', 'Eat in both Boston and Cambridge.', 'places', [2], (c) => c.cities.size),

    // When you eat
    def('night-owl', 'Night Owl', 'Log 3 meals after 10 pm.', 'time', [3], (c) => c.late),
    def('early-bird', 'Early Bird', 'Log 3 meals between 5 and 9 am.', 'time', [3], (c) => c.early),
    def('weekend-brunch', 'Weekend Brunch', 'Log 3 meals on weekend mornings and early afternoons (9 am to 2 pm).', 'time', [3], (c) => c.brunch),

    // Your food journal
    def('food-diary', 'Food Diary', 'Write down what you ate.', 'journal', [5, 15], (c) => c.dishes),
    def('photographer', 'Photographer', 'Add photos of your meals.', 'journal', [3, 10], (c) => c.photos),
    def('critic', 'Critic', 'Rate the places you try.', 'journal', [5, 15], (c) => c.rated),

    // Variety, not volume
    def('taste-tourist', 'Taste Tourist', 'Try different kinds of food.', 'variety', [4, 8], (c) => c.cuisines.size),
    def('budget-eater', 'Budget Eater', 'Find cheap eats ($).', 'variety', [3, 8], (c) => c.cheap),

    // One per T line: stamp stations by eating near them
    ...lines.map((line) => {
      const total = line.station_ids.length;
      const silver = Math.max(4, Math.round(total * 0.3));
      const gold = Math.max(silver + 1, Math.round(total * 0.5));
      return def(
        `rider-${line.id.toLowerCase()}`,
        `${line.name} Rider`,
        `Stamp stations on the ${line.name} by eating within 400 m of them.`,
        'transit',
        [3, silver, gold],
        (c) => line.station_ids.filter((id) => c.byStation[id]).length,
      );
    }),

    // One per neighborhood, worn by that neighborhood's pet
    ...neighborhoods.map((f) =>
      def(
        `local-${f.properties.id}`,
        `${f.properties.name} Regular`,
        `Eat at 3 different places in ${f.properties.name}.`,
        'neighborhood',
        [3],
        (c) => c.byHood[f.properties.id]?.size ?? 0,
        f.properties.id,
      ),
    ),
  ];
  const badgeDefById = new Map(badgeDefs.map((b) => [b.id, b]));

  function context(entries) {
    const c = {
      entries, placeIds: new Set(), hoods: new Set(), cities: new Set(), cuisines: new Set(), byHood: {},
      cheap: 0, late: 0, early: 0, brunch: 0, dishes: 0, photos: 0, rated: 0, byStation: {},
    };
    const visited = [];
    for (const e of entries) {
      const p = placeById.get(e.place_id);
      if (!p) continue;
      visited.push(p);
      c.placeIds.add(p.id);
      c.cuisines.add(p.cuisine);
      const hood = p.neighborhood?.id;
      if (hood) {
        c.hoods.add(hood);
        c.cities.add(hoodProps[hood].city);
        (c.byHood[hood] ??= new Set()).add(p.id);
      }
      if (p.price_level === 1) c.cheap += 1;
      const t = localParts(e.visited_at);
      if (t.hour >= 22 || t.hour < 4) c.late += 1;
      if (t.hour >= 5 && t.hour < 9) c.early += 1;
      if (t.weekend && t.hour >= 9 && t.hour < 14) c.brunch += 1;
      if (e.favorite_dish?.trim()) c.dishes += 1;
      if (e.photo_url) c.photos += 1;
      if (e.my_rating) c.rated += 1;
    }
    c.byStation = stampsFor(visited);
    return c;
  }

  /** { badgeId: { tier, value } } for a set of entries. */
  function badgeStates(entries) {
    const c = context(entries);
    const out = {};
    for (const b of badgeDefs) {
      const value = b.metric(c);
      out[b.id] = { tier: b.tiers.filter((t) => value >= t).length, value };
    }
    return out;
  }

  /* --------------------------------- Replay --------------------------------- */

  /**
   * Replays the dex in order and works out everything: who got fed (and how much), levels, badges,
   * and the full history.
   */
  function analyze(dex) {
    const sorted = [...dex].sort((a, b) => a.visited_at.localeCompare(b.visited_at));
    const xpBy = {};
    const entriesBy = {};
    const firstBy = {};
    const mealsByDay = {};
    const entryInfo = {};
    const events = [];
    let prevBadges = badgeStates([]);
    const seen = [];

    const push = (event) => events.push({ ...event, seq: events.length });

    for (const e of sorted) {
      seen.push(e);
      const place = placeById.get(e.place_id);
      const hoodId = place?.neighborhood?.id ?? null;
      const hoodPet = hoodId && petById.has(hoodId) ? petById.get(hoodId) : null;
      const day = localParts(e.visited_at).day;
      const fed = (mealsByDay[day] ?? 0) < DAILY_FEED_LIMIT;
      mealsByDay[day] = (mealsByDay[day] ?? 0) + 1;
      const xp = fed ? entryXp(e) : 0;
      const base = { at: e.visited_at, entry_id: e.id, place: place ? { id: place.id, name: place.name } : null };
      entryInfo[e.id] = { fed, xp, pet_ids: [starter.id, ...(hoodPet ? [hoodPet.id] : [])] };

      // Each meal feeds the starter (who eats everywhere) and the pet of the neighborhood it was in.
      for (const pet of [hoodPet, starter].filter(Boolean)) {
        entriesBy[pet.id] = (entriesBy[pet.id] ?? 0) + 1;
        if (!pet.is_starter && !firstBy[pet.id]) {
          firstBy[pet.id] = e.visited_at;
          push({ ...base, type: 'unlocked', pet_id: pet.id, text: `${pet.name} joined you after your first meal in ${place.neighborhood.name}.` });
        }
        const before = xpBy[pet.id] ?? 0;
        xpBy[pet.id] = before + xp;
        if (fed) {
          push({ ...base, type: 'fed', pet_id: pet.id, xp, text: `Fed at ${place?.name ?? 'a restaurant'} (+${xp} XP).` });
        } else {
          push({ ...base, type: 'full', pet_id: pet.id, xp: 0, text: `Meal at ${place?.name ?? 'a restaurant'}. Full for today, so no XP.` });
        }
        const lb = petLevelFromXp(before);
        const la = petLevelFromXp(xpBy[pet.id]);
        if (la > lb) push({ ...base, type: 'level_up', pet_id: pet.id, level: la, from: lb, text: `Reached level ${la}.` });
      }

      const badges = badgeStates(seen);
      for (const b of badgeDefs) {
        for (let tier = prevBadges[b.id].tier + 1; tier <= badges[b.id].tier; tier++) {
          push({
            ...base, type: 'badge', pet_id: b.pet_id, badge_id: b.id, tier,
            text: `Earned ${b.name} (${b.tier_labels[tier - 1]}).`,
          });
        }
      }
      prevBadges = badges;
    }

    return { sorted, xpBy, entriesBy, firstBy, mealsByDay, entryInfo, events, badges: prevBadges };
  }

  /* -------------------------------- Read helpers -------------------------------- */

  /** Progress numbers for one pet. */
  function petStats(analysis, pet) {
    const xp = analysis.xpBy[pet.id] ?? 0;
    const level = petLevelFromXp(xp);
    const badges = badgeDefs
      .filter((b) => b.pet_id === pet.id && analysis.badges[b.id].tier > 0)
      .map((b) => ({
        id: b.id,
        name: b.name,
        tier: analysis.badges[b.id].tier,
        tier_label: b.tier_labels[analysis.badges[b.id].tier - 1],
      }));
    return {
      unlocked: pet.is_starter || (analysis.entriesBy[pet.id] ?? 0) > 0,
      unlocked_at: analysis.firstBy[pet.id] ?? null,
      entries: analysis.entriesBy[pet.id] ?? 0,
      xp,
      level,
      next_level_xp: nextPetLevelXp(xp),
      max_level: PET_MAX_LEVEL,
      badges,
    };
  }

  /** Every badge with the user's progress. */
  function badgeList(analysis) {
    return badgeDefs.map((b) => {
      const state = analysis.badges[b.id];
      const tierEarnedAt = b.tiers.map(
        (_, i) => analysis.events.find((ev) => ev.type === 'badge' && ev.badge_id === b.id && ev.tier === i + 1)?.at ?? null,
      );
      return {
        id: b.id, name: b.name, description: b.description, category: b.category, pet_id: b.pet_id,
        tiers: b.tiers, tier_labels: b.tier_labels,
        tier: state.tier, earned: state.tier > 0, value: state.value,
        next_target: b.tiers[state.tier] ?? null,
        tier_earned_at: tierEarnedAt,
      };
    });
  }

  return { analyze, petStats, badgeList, badgeDefs, badgeDefById, placeById, starter };
}
