/**
 * Keeps trains on the rails. A live train position is a noisy GPS point, so instead of drawing it
 * directly we snap it onto the line's path and describe it as "meters along this track". Moving a
 * train is then just changing that number, which always lands on the line, curves included.
 */

const M_PER_DEG_LNG = 82400;
const M_PER_DEG_LAT = 111200;

/** Stay on the track a train was already on unless another one is clearly closer than this (meters). */
const STICKY_MARGIN_M = 40;

/**
 * @typedef {Object} Track
 * @property {string}     key      "<line>:<index>"
 * @property {string}     line
 * @property {string[]}   routes   routes that run along it, e.g. ["Green-B"]
 * @property {number[][]} pts      [lng, lat] pairs
 * @property {number[]}   cum      cumulative length at each point, meters
 * @property {number}     length   total length, meters
 */

/** @param {import('../../lib/api.js').Line[]} lines @returns {Track[]} */
export function buildTracks(lines) {
  const tracks = [];
  for (const line of lines) {
    line.shapes.forEach((pts, i) => {
      const cum = [0];
      for (let j = 1; j < pts.length; j++) {
        cum.push(
          cum[j - 1] +
            Math.hypot((pts[j][0] - pts[j - 1][0]) * M_PER_DEG_LNG, (pts[j][1] - pts[j - 1][1]) * M_PER_DEG_LAT),
        );
      }
      tracks.push({
        key: `${line.id}:${i}`,
        line: line.id,
        routes: line.shape_routes?.[i] ?? [],
        pts,
        cum,
        length: cum[cum.length - 1],
      });
    });
  }
  return tracks;
}

/** Closest point on a track to (lng, lat): its distance along the track and how far off it was. */
function project(track, lng, lat) {
  const px = lng * M_PER_DEG_LNG;
  const py = lat * M_PER_DEG_LAT;
  let best = { s: 0, dist: Infinity };
  for (let i = 0; i < track.pts.length - 1; i++) {
    const ax = track.pts[i][0] * M_PER_DEG_LNG;
    const ay = track.pts[i][1] * M_PER_DEG_LAT;
    const dx = track.pts[i + 1][0] * M_PER_DEG_LNG - ax;
    const dy = track.pts[i + 1][1] * M_PER_DEG_LAT - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const dist = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (dist < best.dist) best = { s: track.cum[i] + t * Math.sqrt(len2), dist };
  }
  return best;
}

/**
 * Finds the track a train is on and how far along it is.
 * It prefers tracks of the train's own route (so a Green-B train stays on the B branch), and
 * sticks with the track it was on before when that is still about as close as any other.
 * @returns {{ track: Track, s: number, dist: number } | null}
 */
export function snapToTrack(tracks, vehicle, previousKey) {
  const ofLine = tracks.filter((t) => t.line === vehicle.line);
  const ofRoute = ofLine.filter((t) => t.routes.includes(vehicle.route));
  const candidates = ofRoute.length ? ofRoute : ofLine;

  let best = null;
  let previous = null;
  for (const track of candidates) {
    const hit = project(track, vehicle.lng, vehicle.lat);
    const result = { track, s: hit.s, dist: hit.dist };
    if (!best || hit.dist < best.dist) best = result;
    if (track.key === previousKey) previous = result;
  }
  if (previous && best && previous.dist <= best.dist + STICKY_MARGIN_M) return previous;
  return best;
}

/** Smallest angle between two compass bearings, 0 to 180 degrees. */
export function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** The direction of the track `s` meters along it, in degrees clockwise from north (as if traveling forward). */
export function headingOnTrack(track, s) {
  const d = Math.max(0, Math.min(track.length, s));
  let lo = 0;
  let hi = track.cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.cum[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  const dx = (track.pts[lo + 1][0] - track.pts[lo][0]) * M_PER_DEG_LNG;
  const dy = (track.pts[lo + 1][1] - track.pts[lo][1]) * M_PER_DEG_LAT;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** The [lng, lat] point `s` meters along a track (clamped to its ends). */
export function pointOnTrack(track, s) {
  const d = Math.max(0, Math.min(track.length, s));
  // Binary search for the segment containing d.
  let lo = 0;
  let hi = track.cum.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.cum[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  const segLen = track.cum[lo + 1] - track.cum[lo];
  const t = segLen === 0 ? 0 : (d - track.cum[lo]) / segLen;
  return [
    track.pts[lo][0] + (track.pts[lo + 1][0] - track.pts[lo][0]) * t,
    track.pts[lo][1] + (track.pts[lo + 1][1] - track.pts[lo][1]) * t,
  ];
}
