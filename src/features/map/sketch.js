/**
 * The hand-drawn look of the map: wobbly neighborhood borders, crayon hatching, and doodled water.
 * Everything here is generated in the browser from the same data the map already has, and it is
 * deterministic (seeded), so the "drawing" is the same every time.
 */

// Meters per degree at Boston's latitude: accurate enough for city-scale geometry.
const M_PER_DEG_LNG = 82400;
const M_PER_DEG_LAT = 111200;

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A small seeded random number generator: () => 0..1 */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * How wobbly the borders are at each zoom range. Far out, a wobble has to be tens of meters to
 * show at all; up close the same wobble would be huge, so each range gets its own drawing.
 */
export const SKETCH_LEVELS = [
  { id: 'far', minzoom: 0, maxzoom: 12, stepM: 300, ampM: 115 },
  { id: 'mid', minzoom: 12, maxzoom: 14, stepM: 100, ampM: 36 },
  { id: 'near', minzoom: 14, maxzoom: 24, stepM: 34, ampM: 10 },
];

/** Redraws a ring by hand: a point every `stepM` meters, each nudged sideways by a slow random drift. */
function wobbleRing(ring, rand, stepM, ampM) {
  const out = [];
  let drift = 0;
  let phase = rand() * Math.PI * 2;
  let sinceLast = stepM; // so the first point is always drawn
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const dx = (b[0] - a[0]) * M_PER_DEG_LNG;
    const dy = (b[1] - a[1]) * M_PER_DEG_LAT;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const nx = -dy / len;
    const ny = dx / len;
    const pieces = Math.max(1, Math.round(len / stepM));
    for (let k = 0; k < pieces; k++) {
      sinceLast += len / pieces;
      if (sinceLast < stepM * 0.6) continue; // skip crowded points: a pen would not draw every tiny corner
      sinceLast = 0;
      drift = Math.max(-ampM, Math.min(ampM, (drift + (rand() - 0.5) * ampM * 1.1) * 0.7));
      phase += 0.9;
      const off = drift + Math.sin(phase) * ampM * 0.25;
      const t = k / pieces;
      out.push([a[0] + (dx * t + nx * off) / M_PER_DEG_LNG, a[1] + (dy * t + ny * off) / M_PER_DEG_LAT]);
    }
  }
  if (out.length < 3) return null;
  out.push(out[0]);
  return out;
}

/** "#rrggbb" mixed toward dark ink, for a colored-pencil outline that still reads as the area's color. */
export function pencil(hex, amount = 0.42) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c * (1 - amount) + 24 * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const outlineCache = new WeakMap();

/**
 * Hand-drawn borders for the neighborhoods, one drawing per zoom range.
 * @param {{features: Array}} collection the neighborhoods FeatureCollection
 * @returns {Object<string, {type: 'FeatureCollection', features: Array}>} keyed by SKETCH_LEVELS id
 */
export function sketchOutlines(collection) {
  if (outlineCache.has(collection)) return outlineCache.get(collection);
  const out = {};
  for (const level of SKETCH_LEVELS) {
    const features = [];
    for (const f of collection.features) {
      const { id, color } = f.properties;
      const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      // Two passes of the pen: a firm line and a lighter second go that wanders a little differently.
      for (const pass of [1, 2]) {
        const rand = rng(hash(`${id}:${level.id}:${pass}`));
        polygons.forEach((rings) =>
          rings.forEach((ring) => {
            const coordinates = wobbleRing(ring, rand, level.stepM * (pass === 2 ? 1.3 : 1), level.ampM * (pass === 2 ? 0.8 : 1));
            if (coordinates) {
              features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { id, pass, color: pencil(color) } });
            }
          }),
        );
      }
    }
    out[level.id] = { type: 'FeatureCollection', features };
  }
  outlineCache.set(collection, out);
  return out;
}

function canvas(width, height) {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  return [el, el.getContext('2d')];
}

/**
 * A seamless tile of diagonal crayon strokes in one color, for hatching a neighborhood.
 * Strokes vary a little in weight, the way a hand-colored map does.
 */
export function hatchImage(color, seed) {
  const size = 64;
  const spacing = 16;
  const [, ctx] = canvas(size, size);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let k = -size; k <= size; k += spacing) {
    // A stroke and its wrapped copy (k and k ± size) must look the same, or the tile shows a seam.
    const rand = rng(hash(`${seed}:${((k % size) + size) % size}`));
    ctx.globalAlpha = 0.5 + rand() * 0.4;
    ctx.lineWidth = 1.6 + rand() * 1.6;
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k + size, size);
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, size, size);
}

/** A tile of water with a few little wave doodles on it. */
export function waterImage(base, dark) {
  const width = 128;
  const height = 96;
  const [, ctx] = canvas(width, height);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.4;
  const wave = (x, y, color) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 6, y - 7, x + 12, y);
    ctx.quadraticCurveTo(x + 18, y + 7, x + 24, y);
    ctx.quadraticCurveTo(x + 30, y - 7, x + 36, y);
    ctx.stroke();
  };
  const light = dark ? 'rgba(160, 200, 255, 0.22)' : 'rgba(255, 255, 255, 0.85)';
  const deep = dark ? 'rgba(4, 14, 30, 0.35)' : 'rgba(86, 136, 196, 0.38)';
  wave(14, 22, light);
  wave(76, 44, deep);
  wave(30, 72, deep);
  wave(84, 84, light);
  return ctx.getImageData(0, 0, width, height);
}
