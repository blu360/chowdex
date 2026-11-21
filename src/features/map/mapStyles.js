/** Basemap options, view limits, and the cleanup that makes any basemap work as a quiet backdrop. */

const KEY = import.meta.env.VITE_MAPTILER_KEY;
const maptiler = (id) => `https://api.maptiler.com/maps/${id}/style.json?key=${KEY}`;
const openfreemap = (id) => `https://tiles.openfreemap.org/styles/${id}`;

/**
 * Basemap choices shown in the style picker. With a MapTiler key we offer five; without one we
 * fall back to free keyless styles. `swatch` is [land, water] for the little preview tile.
 */
export const MAP_STYLES = KEY
  ? [
      { id: 'clean', label: 'Clean', url: maptiler('dataviz-light'), dark: false, tint: true, swatch: ['#f0f4f9', '#c5daf1'] },
      { id: 'soft', label: 'Soft', url: maptiler('backdrop-light'), dark: false, tint: true, swatch: ['#f0f4f9', '#c5daf1'] },
      { id: 'streets', label: 'Streets', url: maptiler('streets-v2-light'), dark: false, tint: true, swatch: ['#f1efe9', '#c5daf1'] },
      { id: 'classic', label: 'Classic', url: maptiler('basic-v2'), dark: false, tint: false, swatch: ['#e3e6d8', '#a8cce5'] },
      { id: 'night', label: 'Night', url: maptiler('dataviz-dark'), dark: true, tint: true, swatch: ['#0c1a2e', '#14407a'] },
    ]
  : [
      { id: 'clean', label: 'Clean', url: openfreemap('positron'), dark: false, tint: true, swatch: ['#f0f4f9', '#c5daf1'] },
      { id: 'streets', label: 'Streets', url: openfreemap('liberty'), dark: false, tint: false, swatch: ['#f1efe9', '#b9d6ea'] },
      { id: 'bright', label: 'Bright', url: openfreemap('bright'), dark: false, tint: false, swatch: ['#e9ecdf', '#a8cce5'] },
    ];

export const DEFAULT_STYLE_ID = 'clean';

export const styleById = (id) => MAP_STYLES.find((s) => s.id === id) ?? MAP_STYLES[0];

/** The default view the map opens at (and the one to return to): Boston and Cambridge, centered. */
export const DEFAULT_VIEW = { center: [-71.075, 42.335], zoom: 11.2, mobileZoom: 10.3 };

/** Restaurants only appear once you zoom in this far; search and the place card still work at any zoom. */
export const PLACE_MIN_ZOOM = 13;

/** The map can't be panned much past Boston: the same area plus roughly 8 km of margin. */
export const MAX_BOUNDS = [[-71.3, 42.14], [-70.84, 42.5]];

export const MIN_ZOOM = 9.5;

/** Land detail (parks, buildings, textures) stays hidden until you zoom in this far, so far-out views are flat and uniform. */
const DETAIL_MIN_ZOOM = 13;

/** Roads stay hidden until you zoom in this far (big highways appear a little earlier). */
const MAJOR_ROAD_MIN_ZOOM = 12;
const ROAD_MIN_ZOOM = 14;

/**
 * Turns any OpenMapTiles-style basemap into a quiet backdrop for our own layers:
 *  - hides the basemap's business markers, rail lines (we draw the T ourselves), and borders
 *  - shows streets only once you zoom in, so the zoomed-out map isn't a tangle of lines
 */
export function tweakBasemap(map, style) {
  // Boston blue: cool off-white land and soft blue water (navy at night).
  const land = style.dark ? '#0c1a2e' : '#f0f4f9';
  const water = style.dark ? '#103258' : '#c5daf1';
  const waterway = style.dark ? '#103258' : '#b3cdea';

  for (const layer of map.getStyle().layers) {
    const sourceLayer = layer['source-layer'] ?? '';
    const hide = () => map.setLayoutProperty(layer.id, 'visibility', 'none');

    if (style.tint && layer.type === 'background') {
      map.setPaintProperty(layer.id, 'background-color', land);
    } else if (style.tint && sourceLayer === 'water' && layer.type === 'fill') {
      map.setPaintProperty(layer.id, 'fill-color', water);
    } else if (style.tint && sourceLayer === 'waterway' && layer.type === 'line') {
      map.setPaintProperty(layer.id, 'line-color', waterway);
    }

    if (/^(poi|housenumber|aerodrome_label|boundary)$/.test(sourceLayer) || /(^|\W)poi(\W|$)/i.test(layer.id)) {
      hide();
    } else if (/^(landcover|landuse|landuse_overlay|globallandcover|park|building|aeroway)$/.test(sourceLayer) || layer.type === 'hillshade') {
      // Parks, land texture, buildings, and shading make the zoomed-out map look like a photo.
      // Keep one flat land color until you zoom in, then bring the detail back.
      map.setLayerZoomRange(layer.id, Math.max(layer.minzoom ?? 0, DETAIL_MIN_ZOOM), layer.maxzoom ?? 24);
    } else if (sourceLayer === 'transportation' || sourceLayer === 'transportation_name') {
      if (/rail|transit|subway|cablecar|gondola|ferry/i.test(layer.id)) {
        hide();
      } else {
        const wanted = /highway|motorway|trunk|primary|major/i.test(layer.id) ? MAJOR_ROAD_MIN_ZOOM : ROAD_MIN_ZOOM;
        map.setLayerZoomRange(layer.id, Math.max(layer.minzoom ?? 0, wanted), layer.maxzoom ?? 24);
      }
    }
  }
}

/** A regular-weight label font the basemap actually has glyphs for (so our labels always render). */
export function pickLabelFont(map) {
  const layers = map.getStyle().layers.filter(
    (l) => l.type === 'symbol' && Array.isArray(l.layout?.['text-font']) && !/italic/i.test(l.layout['text-font'].join()),
  );
  const preferred = layers.find((l) => l['source-layer'] === 'place') ?? layers[0];
  return preferred?.layout['text-font'] ?? ['Noto Sans Regular'];
}
