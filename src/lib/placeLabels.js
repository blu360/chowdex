/**
 * Plain-English descriptions for places. The data only has a raw map tag per place ("juice", "coffee_shop",
 * "latin_american"), which should never be shown as is. These helpers turn it into words a person would use.
 */

/** Tags that already name the kind of place (or the dish it is known for). */
const LABELS = {
  restaurant: 'Restaurant', a_a: 'Restaurant', regional: 'Regional restaurant', international: 'International restaurant',
  fusion: 'Fusion restaurant', seasonal: 'Seasonal restaurant', organic: 'Organic restaurant', new_american: 'New American restaurant',
  soul_food: 'Soul food restaurant', asian: 'Asian restaurant', latin_american: 'Latin American restaurant',
  middle_eastern: 'Middle Eastern restaurant', tex_mex: 'Tex-Mex restaurant',
  coffee_shop: 'Coffee shop', cafe: 'Café', tea: 'Tea shop', bubble_tea: 'Bubble tea shop', juice: 'Juice bar', smoothie: 'Smoothie bar',
  bakery: 'Bakery', donut: 'Doughnut shop', bagel: 'Bagel shop', pretzel: 'Pretzel shop', waffle: 'Waffle shop', crepe: 'Crêperie',
  cake: 'Cake shop', pastry: 'Pastry shop', chocolate: 'Chocolate shop', dessert: 'Dessert spot', ice_cream: 'Ice cream shop',
  frozen_yogurt: 'Frozen yogurt shop', fast_food: 'Fast food', snack: 'Snack shop', deli: 'Deli', diner: 'Diner', bistro: 'Bistro',
  breakfast: 'Breakfast spot', brunch: 'Brunch spot', sandwich: 'Sandwich shop', burger: 'Burger joint', pizza: 'Pizzeria',
  italian_pizza: 'Pizzeria', chicken: 'Chicken spot', wings: 'Wing spot', hot_dog: 'Hot dog stand', sausage: 'Sausage spot',
  salad: 'Salad spot', sushi: 'Sushi restaurant', ramen: 'Ramen shop', noodle: 'Noodle shop', hotpot: 'Hot pot restaurant',
  seafood: 'Seafood restaurant', fish: 'Seafood spot', oyster: 'Oyster bar', steak_house: 'Steakhouse', barbecue: 'Barbecue restaurant',
  grill: 'Grill', bar_and_grill: 'Bar and grill', tapas: 'Tapas bar', tacos: 'Taqueria', shawarma: 'Shawarma shop', hookah: 'Hookah lounge',
};

const titleCase = (text) => String(text ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** "juice" -> "Juice bar", "vietnamese" -> "Vietnamese restaurant", "coffee_shop" -> "Coffee shop". */
export function cuisineLabel(tag) {
  const key = String(tag ?? '').toLowerCase();
  if (!key) return 'Restaurant';
  return LABELS[key] ?? `${titleCase(key)} restaurant`;
}

const PRICE_WORDS = { 1: 'Budget-friendly', 2: 'Moderately priced', 3: 'Pricier', 4: 'Splurge-worthy' };

/** The one-line description under a place's name: what it is, how pricey it is, and where. */
export function placeSubtitle(place) {
  return [cuisineLabel(place.cuisine), place.price_level ? '$'.repeat(place.price_level) : null, place.neighborhood?.name]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A short sentence about the place, built from what we know (never invented):
 * "Budget-friendly juice bar in Back Bay, open late."
 */
export function placeBlurb(place) {
  const kind = cuisineLabel(place.cuisine);
  const price = PRICE_WORDS[place.price_level];
  const lead = price ? `${price} ${kind.charAt(0).toLowerCase()}${kind.slice(1)}` : kind;
  const where = place.neighborhood ? ` in ${place.neighborhood.name}` : '';
  const late = place.open_late ? ', open late' : '';
  return `${lead}${where}${late}.`;
}
