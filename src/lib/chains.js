/**
 * Which places are big chains. Chowdex is for finding local spots, so national and international
 * chains are left out of the map, search, and spotlight. Chains that only exist around Boston
 * (Tasty Burger, Tatte, Clover...) are local and stay.
 *
 * Pure functions with no imports, so both the app (src/lib/api.js, supabaseApi.js) and the seed
 * script (scripts/seed.mjs) can use them. To change what is hidden, edit the two lists below.
 */

/** "Dunkin' Donuts (Kenmore Sq)" -> "dunkin donuts". Lowercase, no accents, no punctuation, no "(...)". */
export function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/['’`.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * National and international chains, written the way normalizeName() would output them.
 * A place matches when its name is one of these, or starts with one followed by a space
 * ("starbucks reserve", "dunkin donuts").
 */
export const BIG_CHAINS = [
  // Coffee, bakery, and donuts
  'dunkin', 'starbucks', 'peets coffee', 'peets', 'caffe nero', 'blue bottle coffee', 'la colombe', 'bluestone lane',
  'tim hortons', 'krispy kreme', 'panera', 'panera bread', 'au bon pain', 'pret a manger', 'einstein bros', 'capital one cafe',
  'paris baguette', 'tous les jours', '85c bakery cafe', 'joe and the juice', 'gregorys coffee',
  // Burgers, chicken, and fast food
  'mcdonalds', 'burger king', 'wendys', 'five guys', 'shake shack', 'smashburger', 'wahlburgers', 'sonic drive in', 'white castle',
  'kfc', 'popeyes', 'chick fil a', 'raising canes', 'wingstop', 'buffalo wild wings', 'zaxbys', 'bonchon', 'bb q chicken',
  'taco bell', 'chipotle', 'chipotle mexican grill', 'qdoba', 'moes southwest grill', 'baja fresh',
  'subway', 'jimmy johns', 'jersey mikes', 'jersey mikes subs', 'firehouse subs', 'potbelly', 'potbelly sandwich shop', 'quiznos',
  'arbys', 'panda express', 'pf changs', 'the halal guys', 'halal guys',
  // Pizza
  'dominos', 'dominos pizza', 'pizza hut', 'papa johns', 'papa johns pizza', 'little caesars', 'sbarro', 'blaze pizza', 'mod pizza',
  'uno pizzeria and grill', 'pizzeria uno', 'papa ginos', 'bertuccis',
  // Bowls, salads, and fast casual
  'sweetgreen', 'cava', 'dig inn', 'just salad', 'chopt', 'honeygrow', 'noodles and company', 'naf naf grill', 'nandos',
  'wagamama', 'pokeworks', 'playa bowls',
  // Sit-down chains
  'cheesecake factory', 'the cheesecake factory', 'olive garden', 'red lobster', 'applebees', 'chilis', 'tgi fridays', 'ihop', 'dennys',
  'outback steakhouse', 'texas roadhouse', 'longhorn steakhouse', 'ruths chris steak house', 'mortons the steakhouse', 'capital grille',
  'the capital grille', 'hard rock cafe', 'rainforest cafe', 'dave and busters', 'yard house', 'ninety nine restaurant', '99 restaurant',
  'cracker barrel', 'red robin', 'hooters', 'benihana', 'maggianos little italy', 'california pizza kitchen', 'bar louie',
  // Sweets, ice cream, tea, and juice
  'baskin robbins', 'dairy queen', 'cold stone creamery', 'ben and jerrys', 'haagen dazs', 'carvel', 'pinkberry', 'yogurtland',
  'insomnia cookies', 'crumbl', 'crumbl cookies', 'auntie annes', 'cinnabon', 'nothing bundt cakes', 'jenis splendid ice creams',
  'van leeuwen ice cream', 'jamba', 'jamba juice', 'smoothie king', 'tropical smoothie cafe', 'kung fu tea', 'gong cha', 'chatime',
  'sharetea', 'coco fresh tea and juice', 'tiger sugar', 'boba guys', 'lady m',
  // Convenience stores that show up as food places
  '7 eleven', 'wawa', 'cumberland farms',
];

/**
 * Boston-area originals with several locations. They are never treated as big chains, even when
 * OpenStreetMap tags them as a brand.
 */
export const LOCAL_FAVORITES = [
  'tasty burger', 'tatte bakery and cafe', 'tatte', 'flour bakery and cafe', 'flour bakery', 'clover food lab', 'clover',
  'annas taqueria', 'life alive', 'life alive organic cafe', 'pavement coffeehouse', 'george howell coffee', 'thinking cup',
  'jp licks', 'emack and bolios', 'toscaninis', 'toscaninis ice cream', 'legal sea foods', 'boloco', 'el jefes taqueria',
  'el pelon taqueria', 'saloniki', 'saloniki greek', 'bon me', 'mikes pastry', 'regina pizzeria', 'pizzeria regina', 'santarpios pizza',
  'mei mei', 'blackbird doughnuts', 'union square donuts', 'kanes donuts', 'mamalehs delicatessen', 'darwins ltd',
  'the friendly toast', 'sweet cheeks', 'new city microcreamery', 'fomu', 'honeycomb creamery', 'bgood',
  'dumpling house', 'gourmet dumpling house', 'pho pasteur', 'bovas bakery', 'modern pastry',
];

const matches = (list) => {
  const set = new Set(list);
  return (normalized) => {
    if (set.has(normalized)) return true;
    for (const entry of list) if (normalized.startsWith(`${entry} `)) return true;
    return false;
  };
};
const inBigChains = matches(BIG_CHAINS);
const inLocalFavorites = matches(LOCAL_FAVORITES);

/** A Boston-area original (kept no matter how many locations it has). */
export function isLocalFavorite(name) {
  return inLocalFavorites(normalizeName(name));
}

/**
 * Should this place be left out?
 * @param {string} name
 * @param {{brandWikidata?: string|null}} [osm]  when known (seed time): OpenStreetMap's `brand:wikidata` tag,
 *        which mappers put on branches of recognized brands. With it, chains missing from BIG_CHAINS are caught too.
 */
export function isBigChain(name, { brandWikidata = null } = {}) {
  const n = normalizeName(name);
  if (!n) return false;
  if (inLocalFavorites(n)) return false;
  if (inBigChains(n)) return true;
  return Boolean(brandWikidata);
}

/** normalized name -> how many places in the list share it (how many locations it has around here). */
export function locationCounts(places) {
  const counts = new Map();
  for (const p of places) {
    const n = normalizeName(p.name);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return counts;
}
