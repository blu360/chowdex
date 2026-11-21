/**
 * What a pet says in its speech bubble. Every line is built from real state the API already
 * returns (feeding status, level, the journal, where you have not explored yet). Nothing here is stored, and there is no backend for "moods" yet:
 * if the API ever adds one, this is the file to replace.
 */

/**
 * @param {Object} input
 * @param {import('../../lib/api.js').Pet} input.pet
 * @param {boolean} input.signedIn
 * @param {import('../../lib/api.js').FeedingStatus} [input.feeding]
 * @param {{name: string}|null} [input.nextHood]   a neighborhood the user has not eaten in yet
 * @param {Array} [input.entries]   journal entries (newest first) that fed this pet
 * @returns {{lines: string[], mood: 'happy'|'eager'|'full'}}
 */
export function petVoice({ pet, signedIn, feeding, nextHood = null, entries = [] }) {
  const lines = [];
  let mood = 'happy';

  if (!signedIn) {
    return {
      mood: 'eager',
      lines: ["Hi! I'm your starter. Sign in and let's eat our way around Boston.", 'Every neighborhood has a pet like me waiting to meet you.'],
    };
  }

  const last = entries[0];
  if (feeding?.full) {
    mood = 'full';
    lines.push("I'm stuffed for today. Meals you log now still go in the dex.");
  } else if (!entries.length) {
    mood = 'eager';
    lines.push(pet.is_starter ? "I'm hungry! Find us a first meal on the map." : `Come back to ${pet.neighborhood?.name} soon?`);
  } else if (nextHood && pet.is_starter) {
    mood = 'eager';
    lines.push(`I wonder who lives in ${nextHood.name}. Want to go find out?`);
  } else if (pet.next_level_xp != null) {
    mood = 'eager';
    const need = pet.next_level_xp - pet.xp;
    lines.push(
      pet.is_starter
        ? `Only ${need} XP until I reach level ${pet.level + 1}!`
        : `${need} more XP in ${pet.neighborhood?.name} and I reach level ${pet.level + 1}!`,
    );
  } else {
    lines.push("I'm fully grown, and very proud of it.");
  }

  if (last?.favorite_dish) lines.push(`Still thinking about the ${last.favorite_dish.toLowerCase()} at ${last.place.name}.`);
  else if (last) lines.push(`${last.place.name} was a good one.`);
  if (feeding && !feeding.full && lines.length < 3) {
    lines.push(`${feeding.remaining} ${feeding.remaining === 1 ? 'feeding' : 'feedings'} left today. Where are we eating?`);
  }

  return { lines, mood };
}
