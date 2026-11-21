/**
 * Display helpers for the dashboard and pet screens. Everything here is derived from what
 * src/lib/api.js returns: no game rules live in this file, and nothing is stored.
 */
import { levelFromXp } from './api.js';

/** Trainer levels follow levelFromXp(): level L starts at 10 * L^2 XP. */
export const xpForTrainerLevel = (level) => 10 * level * level;

/** @returns {{level: number, xp: number, next: number, percent: number}} progress toward the next trainer level */
export function trainerProgress(xp) {
  const level = levelFromXp(xp);
  const next = xpForTrainerLevel(level + 1);
  return { level, xp, next, percent: Math.min(100, Math.round((100 * xp) / next)) };
}

/** @returns {{percent: number, max: boolean, label: string}} a pet's XP bar */
export function petProgress(pet) {
  if (pet.next_level_xp == null) return { percent: 100, max: true, label: `${pet.xp} XP · fully grown` };
  return {
    percent: Math.min(100, Math.round((100 * pet.xp) / pet.next_level_xp)),
    max: false,
    label: `${pet.xp} / ${pet.next_level_xp} XP`,
  };
}

const DAY_MS = 86400000;
const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const DATE_YEAR = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export const formatDate = (iso) => DATE.format(new Date(iso));
export const formatFullDate = (iso) => DATE_YEAR.format(new Date(iso));

/** "today", "yesterday", "3 days ago", then a plain date. */
export function timeAgo(iso) {
  const then = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(then).setHours(0, 0, 0, 0)) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return formatDate(iso);
}

export const titleCase = (s) => String(s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** "A", "A and B", "A, B, and C" */
export function listNames(names) {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/** [[west, south], [east, north]] around a neighborhood GeoJSON feature. */
export function boundsOfFeature(feature) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      west = Math.min(west, c[0]); east = Math.max(east, c[0]);
      south = Math.min(south, c[1]); north = Math.max(north, c[1]);
    } else c.forEach(walk);
  };
  walk(feature.geometry.coordinates);
  return [[west, south], [east, north]];
}

/** [[west, south], [east, north]] around a list of things with lat/lng, or null if there are none. */
export function boundsOfPoints(points) {
  if (!points.length) return null;
  const lngs = points.map((p) => p.lng);
  const lats = points.map((p) => p.lat);
  const pad = 0.004;
  return [[Math.min(...lngs) - pad, Math.min(...lats) - pad], [Math.max(...lngs) + pad, Math.max(...lats) + pad]];
}

/** station id -> ISO time it was first stamped (the earliest meal within range of it). */
export function stampTimes(stamps, entries) {
  const visitedAt = Object.fromEntries(entries.map((e) => [e.place_id, e.visited_at]));
  const out = {};
  for (const [stationId, placeIds] of Object.entries(stamps.by_station)) {
    const times = placeIds.map((id) => visitedAt[id]).filter(Boolean).sort();
    if (times.length) out[stationId] = times[0];
  }
  return out;
}

const RANK = { level: 0, badge: 1, pet: 2, stamp: 3, meal: 4 };

/**
 * One merged "recent activity" list, newest first, built from the pets' histories and the stamps.
 * @param {Object} input
 * @param {import('./api.js').Pet[]} input.pets
 * @param {import('./api.js').PetHistoryEvent[]} input.events   histories of every unlocked pet, concatenated
 * @param {import('./api.js').StampSummary} input.stamps
 * @param {import('./api.js').Station[]} input.stations
 * @param {import('./api.js').DexEntry[]} input.entries
 */
export function buildActivity({ pets, events, stamps, stations, entries }) {
  const petById = Object.fromEntries(pets.map((p) => [p.id, p]));
  const items = [];
  events.forEach((ev, i) => {
    const pet = petById[ev.pet_id];
    if (!pet) return;
    const base = { key: `${ev.type}-${ev.pet_id}-${ev.entry_id}-${i}`, at: ev.at, pet, place: ev.place };
    if (ev.type === 'fed' && pet.is_starter) {
      items.push({ ...base, kind: 'meal', title: `Ate at ${ev.place?.name ?? 'a restaurant'}`, gain: `+${ev.xp} XP` });
    } else if (ev.type === 'full' && pet.is_starter) {
      items.push({ ...base, kind: 'meal', title: `Ate at ${ev.place?.name ?? 'a restaurant'}`, sub: 'Pets were full, so no XP' });
    } else if (ev.type === 'unlocked') {
      items.push({ ...base, kind: 'pet', title: `${pet.display_name} joined you`, sub: `New area explored: ${pet.neighborhood?.name}` });
    } else if (ev.type === 'level_up') {
      items.push({ ...base, kind: 'level', title: `${pet.display_name} reached level ${ev.level}` });
    } else if (ev.type === 'badge') {
      items.push({ ...base, kind: 'badge', title: ev.text.replace(/\.$/, '').replace(' (Earned)', ''), sub: `Worn by ${pet.display_name}` });
    }
  });

  const stationById = Object.fromEntries(stations.map((s) => [s.id, s]));
  for (const [stationId, at] of Object.entries(stampTimes(stamps, entries))) {
    const station = stationById[stationId];
    if (station) items.push({ key: `stamp-${stationId}`, at, kind: 'stamp', title: `Stamped ${station.name}`, lines: station.lines });
  }

  return items.sort((a, b) => b.at.localeCompare(a.at) || RANK[a.kind] - RANK[b.kind]);
}
