/**
 * Opening hours from OpenStreetMap's `opening_hours` text ("Mo-Fr 07:00-19:00; Sa,Su 08:00-17:00").
 *
 * The full syntax is huge, so this reads the common shapes (day ranges and lists, one or more time ranges, past
 * midnight, "24/7", "off") and gives up on the rest (holidays, months, sunrise, week numbers) by returning null,
 * which the app shows as "Hours not listed" instead of guessing.
 */
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK = 7 * 24 * 60;

/** Parses to a list of [start, end) minute ranges counted from Monday 00:00 (end can pass into the next day), or null. */
export function parseHours(text) {
  if (!text || typeof text !== 'string') return null;
  const clean = text.trim();
  if (/^24\/7$/i.test(clean)) return [[0, WEEK]];
  // Rules this reader does not understand make the whole string unreliable, so say "unknown" rather than half-right.
  if (/(PH|SH|sunrise|sunset|dawn|dusk|week|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\[|\bopen\b|"|\+)/i.test(clean)) return null;

  const dayMinutes = Array.from({ length: 7 }, () => []); // per day: [start, end] within that day (end may exceed 1440)
  // Rules are separated by ";", and often by a comma that comes right after a time and before a day ("..-22:00, Su 11:00-18:00").
  const rules = clean.replace(/(?<=\d|off|closed)\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/gi, ';').split(';').map((s) => s.trim()).filter(Boolean);
  for (const rule of rules) {
    const m = rule.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?\s*,?\s*)*)\s*(.*)$/);
    if (!m) return null;
    const dayPart = m[1].trim().replace(/,$/, '');
    const rest = m[2].trim();
    const days = new Set();
    if (!dayPart) DAYS.forEach((_, i) => days.add(i));
    else {
      for (const piece of dayPart.split(',').map((s) => s.trim()).filter(Boolean)) {
        const r = piece.match(/^(Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su))?$/);
        if (!r) return null;
        const a = DAYS.indexOf(r[1]);
        const b = r[2] ? DAYS.indexOf(r[2]) : a;
        for (let i = a; ; i = (i + 1) % 7) {
          days.add(i);
          if (i === b) break;
        }
      }
    }
    if (/^(off|closed)$/i.test(rest)) {
      for (const d of days) dayMinutes[d] = []; // a later rule overrides an earlier one for that day
      continue;
    }
    const spans = [];
    for (const t of rest.split(',').map((s) => s.trim()).filter(Boolean)) {
      const r = t.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
      if (!r) return null;
      const start = Number(r[1]) * 60 + Number(r[2]);
      let end = Number(r[3]) * 60 + Number(r[4]);
      if (start > 24 * 60 || end > 48 * 60) return null;
      if (end <= start) end += 24 * 60; // closes after midnight
      spans.push([start, end]);
    }
    if (!spans.length) return null;
    for (const d of days) dayMinutes[d] = spans;
  }

  const out = [];
  dayMinutes.forEach((spans, d) => spans.forEach(([s, e]) => out.push([d * 1440 + s, d * 1440 + e])));
  return out.length ? out : null;
}

function clock(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Minutes since Monday 00:00 for a Date. */
const weekMinute = (d) => ((d.getDay() + 6) % 7) * 1440 + d.getHours() * 60 + d.getMinutes();

/**
 * Is it open right now? Returns null when the hours are unknown, otherwise
 * { open: true, text: "Open · closes 10 PM" } or { open: false, text: "Closed · opens 11 AM Tue" }.
 */
export function openStatus(text, now = new Date()) {
  const spans = parseHours(text);
  if (!spans) return null;
  const t = weekMinute(now);
  for (const [s, e] of spans) {
    // A span can also be reached from the previous week (a Sunday night that runs past midnight into Monday).
    for (const shift of [0, WEEK]) {
      if (t + shift >= s && t + shift < e) {
        const closes = e - shift;
        const left = closes - t;
        const soon = left <= 60 ? ` (in ${left} min)` : '';
        return { open: true, closingSoon: left <= 60, text: `Open · closes ${clock(closes)}${soon}` };
      }
    }
  }
  // Closed: find the next opening, today or later this week.
  let next = null;
  for (const [s] of spans) {
    const wait = (s - t + WEEK) % WEEK;
    if (wait > 0 && (next === null || wait < next.wait)) next = { wait, s };
  }
  if (!next) return { open: false, closingSoon: false, text: 'Closed' };
  const day = Math.floor(next.s / 1440);
  const sameDay = next.wait < 1440 && day === (t / 1440 | 0);
  return { open: false, closingSoon: false, text: `Closed · opens ${clock(next.s)}${sameDay ? '' : ` ${DAY_NAMES[day]}`}` };
}

/** One line per run of days with the same hours, for the place card: [{ days: "Mon–Fri", hours: "7 AM – 7 PM" }]. */
export function weeklyLines(text) {
  const spans = parseHours(text);
  if (!spans) return null;
  const perDay = DAYS.map((_, d) => spans.filter(([s]) => Math.floor(s / 1440) === d)
    .map(([s, e]) => (e - s >= 1440 ? 'Open 24 hours' : `${clock(s)} – ${clock(e)}`)).join(', ') || 'Closed');
  const lines = [];
  for (let d = 0; d < 7; d++) {
    const last = lines[lines.length - 1];
    if (last && last.hours === perDay[d]) last.to = d;
    else lines.push({ from: d, to: d, hours: perDay[d] });
  }
  return lines.map((l) => ({ days: l.from === l.to ? DAY_NAMES[l.from] : `${DAY_NAMES[l.from]}–${DAY_NAMES[l.to]}`, hours: l.hours }));
}
