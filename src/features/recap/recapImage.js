/**
 * Draws the semester recap as a 1080 x 1350 PNG (a portrait size that works for stories and posts).
 * Plain canvas drawing, no libraries. The fonts are the ones the page already loaded.
 */
import { titleCase } from '../../lib/game.js';

const W = 1080;
const H = 1350;
const INK = '#111111';
const PAPER = '#faf6ea';
const ACCENT = '#a9d7f7';
const MUTED = '#5d6673';
const HEAD = "'Cabin Sketch', 'DM Sans', sans-serif";
const BODY = "'DM Sans', system-ui, sans-serif";

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // a missing picture should not stop the whole card
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Shrinks the font until the text fits on one line. */
function fitText(ctx, text, maxWidth, weight, size, family) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${family}`;
    s -= 2;
  } while (ctx.measureText(text).width > maxWidth && s > 18);
}

/**
 * @param {Object} input
 * @param {ReturnType<import('../../lib/semester.js').buildRecap>} input.recap
 * @param {string} input.name
 * @param {string|null} input.school
 * @returns {Promise<Blob>} a PNG
 */
export async function drawRecapImage({ recap, name, school }) {
  await document.fonts?.ready;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Paper, with an inked card on a blue offset shadow
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = INK;
  roundRect(ctx, 74, 74, W - 120, H - 120, 56);
  ctx.fill();
  ctx.fillStyle = PAPER;
  roundRect(ctx, 54, 54, W - 120, H - 120, 56);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = INK;
  ctx.stroke();

  const left = 120;
  const right = W - 132;
  const width = right - left;
  ctx.textBaseline = 'alphabetic';

  // Header: the clam and the wordmark
  const logo = await loadImage('/logo.png');
  if (logo) ctx.drawImage(logo, left - 12, 96, 96, 96);
  ctx.fillStyle = INK;
  ctx.font = `700 60px ${HEAD}`;
  ctx.fillText('howdex', left + 84, 168);
  ctx.font = `600 26px ${BODY}`;
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'right';
  ctx.fillText('SEMESTER RECAP', right, 160);
  ctx.textAlign = 'left';

  // Title
  ctx.fillStyle = INK;
  ctx.font = `700 132px ${HEAD}`;
  ctx.fillText(recap.semester.label, left, 330);
  const by = [name, school].filter(Boolean).join('  ·  ');
  ctx.fillStyle = MUTED;
  fitText(ctx, by, width, 500, 34, BODY);
  ctx.fillText(by, left, 384);

  // Four big numbers
  const stats = [
    [recap.meals, recap.meals === 1 ? 'meal' : 'meals'],
    [recap.places, recap.places === 1 ? 'place' : 'places'],
    [recap.neighborhoods.length, recap.neighborhoods.length === 1 ? 'neighborhood' : 'neighborhoods'],
    [recap.stamps, recap.stamps === 1 ? 'T stamp' : 'T stamps'],
  ];
  const top = 436;
  const cell = width / 4;
  ctx.lineWidth = 6;
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.moveTo(left, top + 190);
  ctx.lineTo(right, top + 190);
  ctx.stroke();
  stats.forEach(([value, label], i) => {
    const x = left + i * cell + (i ? 22 : 0);
    if (i) {
      ctx.beginPath();
      ctx.moveTo(left + i * cell, top);
      ctx.lineTo(left + i * cell, top + 190);
      ctx.stroke();
    }
    ctx.fillStyle = INK;
    ctx.font = `700 104px ${HEAD}`;
    ctx.fillText(String(value), x, top + 116);
    ctx.fillStyle = MUTED;
    fitText(ctx, label, cell - 30, 500, 30, BODY);
    ctx.fillText(label, x, top + 162);
  });

  // New friends: the pets that joined this semester
  let y = top + 262;
  const pets = recap.newPets.slice(0, 5);
  if (pets.length) {
    ctx.fillStyle = MUTED;
    ctx.font = `600 26px ${BODY}`;
    ctx.fillText('NEW FRIENDS', left, y);
    const size = Math.min(170, (width - (pets.length - 1) * 16) / pets.length);
    const images = await Promise.all(pets.map((p) => loadImage(p.image)));
    images.forEach((img, i) => {
      const x = left + i * (size + 16);
      ctx.fillStyle = '#e3f2fd';
      ctx.beginPath();
      ctx.ellipse(x + size / 2, y + 30 + size * 0.56, size * 0.46, size * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      if (img) ctx.drawImage(img, x, y + 22, size, size);
    });
    y += size + 78;
  }

  // Facts
  const facts = [];
  if (recap.topCuisines.length) facts.push(['Top tastes', recap.topCuisines.map((c) => titleCase(c.cuisine)).join(', ')]);
  if (recap.favorite) facts.push(['Favorite', `${recap.favorite.name}  ${'★'.repeat(recap.favorite.rating)}`]);
  if (recap.topNeighborhood) facts.push(['Home turf', recap.topNeighborhood]);
  if (recap.badges.length) facts.push(['Badges', `${recap.badges.slice(0, 3).join(', ')}${recap.badges.length > 3 ? ` +${recap.badges.length - 3}` : ''}`]);
  if (recap.greenTrips) facts.push(['Green trips', `${recap.greenTrips}, saving ${recap.co2SavedKg} kg of CO2`]);
  for (const [label, value] of facts) {
    if (y > H - 190) break;
    ctx.fillStyle = MUTED;
    ctx.font = `600 26px ${BODY}`;
    ctx.fillText(label.toUpperCase(), left, y);
    ctx.fillStyle = INK;
    fitText(ctx, value, width, 600, 40, BODY);
    ctx.fillText(value, left, y + 46);
    y += 104;
  }

  // Footer
  ctx.fillStyle = MUTED;
  ctx.font = `500 26px ${BODY}`;
  ctx.fillText('Eat local. Stamp the T. Collect them all.', left, H - 118);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no image'))), 'image/png'));
}
