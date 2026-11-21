/**
 * Species flavor text: a short personality and a few traits for each of the 25 pets.
 *
 * FRONTEND CONTENT ONLY. The API's `Pet` shape has no personality fields yet, so this lives here,
 * keyed by pet id, and is merged in at display time. When the backend adds something like
 * `pets.personality` and `pets.traits`, delete this file and read those instead.
 * Nothing here is user data: favorites and history always come from the API.
 */
export const PET_LORE = {
  starter: {
    blurb: 'Loyal, dapper, and always hungry. The starter tags along to every meal, wherever in the city it is.',
    traits: ['Eats everywhere', 'Bow tie', 'First companion'],
  },
  allston: {
    blurb: 'A scrappy collector who furnishes its den from the curb and never misses a basement show.',
    traits: ['Lampshade hat', 'Night owl', 'Thrifty'],
  },
  'back-bay': {
    blurb: 'Graceful and a little fancy. Glides through the Public Garden like it owns the lagoon.',
    traits: ['Elegant', 'Marathon medal', 'Window shopper'],
  },
  'bay-village': {
    blurb: 'Tiny and stylish, with a soft spot for old theaters and anything from the 1920s.',
    traits: ['Pearls', 'Small but bold', 'Theater fan'],
  },
  'beacon-hill': {
    blurb: 'A dignified duck who waddles the cobblestones by lantern light, golden dome hat and all.',
    traits: ['Gold dome', 'Proper', 'Lamplighter'],
  },
  brighton: {
    blurb: 'Gentle and easygoing, a nod to the cattle market that Brighton once was.',
    traits: ['Cowbell', 'Laid back', 'Bandana'],
  },
  cambridge: {
    blurb: 'A round, well-read owl that stays up far too late studying. Asks a lot of questions.',
    traits: ['Graduation cap', 'Curious', 'Night studier'],
  },
  charlestown: {
    blurb: 'Carries a tiny wooden warship on its back and takes harbor history very seriously.',
    traits: ['Ship shell', 'Steadfast', 'Old salt'],
  },
  'chinatown-leather-district': {
    blurb: 'A soft-hearted baby dragon that never goes anywhere without a warm bun.',
    traits: ['Bun in hand', 'Gentle', 'Curly whiskers'],
  },
  dorchester: {
    blurb: 'Friendly and proud of the biggest neighborhood in town. Runs on coffee.',
    traits: ['Coffee cup', 'Neighborly', 'Triple-decker home'],
  },
  downtown: {
    blurb: 'A golden-green grasshopper modeled on the weathervane, always keeping an eye on the wind.',
    traits: ['Tricorn hat', 'History buff', 'Good balance'],
  },
  'east-boston': {
    blurb: 'An adventurous gull with aviator goggles who watches the planes from a harbor piling.',
    traits: ['Goggles', 'Frequent flyer', 'Harbor views'],
  },
  'fenway-kenmore': {
    blurb: 'A big, cheerful bullfrog from the Fens marsh who never turns down a ballpark hot dog.',
    traits: ['Red cap', 'Loud cheerer', 'Hot dog fan'],
  },
  'hyde-park': {
    blurb: 'A proud wild turkey in a ranger hat. Has never once yielded to traffic.',
    traits: ['Ranger hat', 'Fearless', 'Woods walker'],
  },
  'jamaica-plain': {
    blurb: 'Calm and patient, wading at the edge of the pond with a crown of lilacs.',
    traits: ['Lilac crown', 'Patient', 'Pond regular'],
  },
  mattapan: {
    blurb: 'Part caterpillar, part vintage trolley. Slow, steady, and endlessly charming.',
    traits: ['Trolley pole', 'Takes its time', 'Headlight'],
  },
  'mission-hill': {
    blurb: 'Sure-footed on the steepest streets, with horns like twin spires and a scrub cap from the hospitals nearby.',
    traits: ['Spire horns', 'Climber', 'Scrub cap'],
  },
  'north-end': {
    blurb: 'Comes out at night with two little lanterns and a cannoli tucked under one arm.',
    traits: ['Two lanterns', 'Sweet tooth', 'Flat cap'],
  },
  roslindale: {
    blurb: 'A cheerful rabbit who never leaves the farmers market empty-handed.',
    traits: ['Market basket', 'Early riser', 'Carrot expert'],
  },
  roxbury: {
    blurb: 'Sturdy and unhurried, with a shell of speckled puddingstone and a little moss on top.',
    traits: ['Stone shell', 'Wise', 'Park dweller'],
  },
  'south-boston': {
    blurb: 'A happy clam in a knit beanie that loves the beach in every season.',
    traits: ['Green beanie', 'Beach bum', 'Cold-water brave'],
  },
  'south-end': {
    blurb: 'An artsy peacock in a beret that paints every chance it gets.',
    traits: ['Beret', 'Paintbrush', 'Gallery hopper'],
  },
  'west-end': {
    blurb: 'Crackling with static and always buzzing after a big game or a science show.',
    traits: ['Static hair', 'Sweatband', 'High energy'],
  },
  'west-roxbury': {
    blurb: 'A quiet, thoughtful lamb that would rather read in a meadow than do almost anything else.',
    traits: ['Bookworm', 'Daydreamer', 'Meadow napper'],
  },
  'wharf-district': {
    blurb: 'A cheerful lobster in a sailor cap who knows every ferry and every dock on the harbor.',
    traits: ['Sailor cap', 'Sea legs', 'Harbor guide'],
  },
};

export const loreFor = (petId) => PET_LORE[petId] ?? { blurb: '', traits: [] };
