/**
 * A rough price level (1 = $ to 3 = $$$) for places that have no real one. It is a guess from the kind of place
 * (a doughnut shop is cheap, a steakhouse is not), so it is only used when the data has nothing better, and the
 * app shows it like any other level. Never 4: nothing here can honestly say "splurge".
 */
const CHEAP = new Set([
  'donut', 'coffee_shop', 'cafe', 'tea', 'bubble_tea', 'juice', 'smoothie', 'ice_cream', 'frozen_yogurt', 'bakery', 'bagel',
  'pretzel', 'waffle', 'crepe', 'snack', 'dessert', 'pastry', 'cake', 'chocolate', 'fast_food', 'pizza', 'italian_pizza',
  'sandwich', 'burger', 'hot_dog', 'sausage', 'chicken', 'wings', 'deli', 'shawarma', 'tacos', 'diner', 'breakfast',
]);
const PRICEY = new Set(['steak_house', 'seafood', 'french', 'oyster', 'tapas', 'fusion', 'new_american', 'seasonal', 'fish']);
const NAME_PRICEY = /\b(steak\s?house|oyster|ristorante|trattoria|brasserie|bistro|wine bar|chophouse|prime|fine dining)\b/i;
const NAME_CHEAP = /\b(pizza|pizzeria|bakery|donuts?|doughnuts?|bagels?|deli|sub|subs|grill cheese|coffee|cafe|café|tea|juice|ice cream|gelato|creamery|bubble)\b/i;

/** @returns {1|2|3} */
export function estimatePriceLevel(cuisine, name = '') {
  const key = String(cuisine ?? '').toLowerCase();
  if (PRICEY.has(key) || NAME_PRICEY.test(name)) return 3;
  if (CHEAP.has(key) || NAME_CHEAP.test(name)) return 1;
  return 2;
}

/** The real level when there is one, otherwise the estimate. */
export const priceLevelOf = (place) => place.price_level ?? estimatePriceLevel(place.cuisine, place.name);
