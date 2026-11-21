/** Basemap options, view limits, and the cleanup that makes any basemap work as a quiet backdrop. */
import { waterImage } from './sketch.js';

const KEY = import.meta.env.VITE_MAPTILER_KEY;
const maptiler = (id) => `https://api.maptiler.com/maps/${id}/style.json?key=${KEY}`;
const openfreemap = (id) => `https://tiles.openfreemap.org/styles/${id}`;

/**
 * Basemap choices shown in the style picker. With a MapTiler key we offer five; without one we
 * fall back to free keyless styles. `swatch` is [land, water] for the little preview tile.
 */
export const MAP_STYLES = KEY
  ? [
      { id: 'clean', label: 'Clean', url: maptiler('dataviz-light'), dark: false, tint: true, swatch: ['#faf6ea', '#bcd6f0'] },
      { id: 'soft', label: 'Soft', url: maptiler('backdrop-light'), dark: false, tint: true, swatch: ['#faf6ea', '#bcd6f0'] },
      { id: 'streets', label: 'Streets', url: maptiler('streets-v2-light'), dark: false, tint: true, swatch: ['#f1efe9', '#c5daf1'] },
      { id: 'classic', label: 'Classic', url: maptiler('basic-v2'), dark: false, tint: false, swatch: ['#e3e6d8', '#a8cce5'] },
      { id: 'night', label: 'Night', url: maptiler('dataviz-dark'), dark: true, tint: true, swatch: ['#0c1a2e', '#14407a'] },
    ]
  : [
      { id: 'clean', label: 'Clean', url: openfreemap('positron'), dark: false, tint: true, swatch: ['#faf6ea', '#bcd6f0'] },
      { id: 'streets', label: 'Streets', url: openfreemap('liberty'), dark: false, tint: false, swatch: ['#f1efe9', '#b9d6ea'] },
      { id: 'bright', label: 'Bright', url: openfreemap('bright'), dark: false, tint: false, swatch: ['#e9ecdf', '#a8cce5'] },
    ];

export const DEFAULT_STYLE_ID = 'clean';

/** The dark basemap. It is not in the style picker: the night-mode button in the top bar switches to it. */
export const NIGHT_STYLE_ID = MAP_STYLES.find((s) => s.dark)?.id ?? null;
/** The basemaps you can choose between (the daytime ones). */
export const PICKABLE_STYLES = MAP_STYLES.filter((s) => !s.dark);

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
  // A paper map: warm paper land and soft blue water with little wave doodles (navy at night).
  const land = style.dark ? '#0c1a2e' : '#faf6ea';
  const water = style.dark ? '#103258' : '#bcd6f0';
  const waterway = style.dark ? '#103258' : '#a9c8e8';
  const pencilLight = !style.dark && style.tint; // light tinted basemaps get pencil-toned streets and buildings
  // One wave image per look: a single shared one would keep the pale daytime ocean after switching to Night.
  const waterPattern = style.dark ? 'water-doodle-dark' : 'water-doodle-light';
  if (style.tint && !map.hasImage(waterPattern)) map.addImage(waterPattern, waterImage(water, style.dark), { pixelRatio: 2 });
  const paint = (id, prop, value) => {
    try {
      map.setPaintProperty(id, prop, value);
    } catch {
      // a basemap layer that does not take this property: leave it as it is
    }
  };

  for (const layer of map.getStyle().layers) {
    const sourceLayer = layer['source-layer'] ?? '';
    const hide = () => map.setLayoutProperty(layer.id, 'visibility', 'none');

    if (style.tint && layer.type === 'background') {
      map.setPaintProperty(layer.id, 'background-color', land);
    } else if (style.tint && sourceLayer === 'water' && layer.type === 'fill') {
      map.setPaintProperty(layer.id, 'fill-color', water);
      paint(layer.id, 'fill-pattern', waterPattern);
    } else if (style.tint && sourceLayer === 'waterway' && layer.type === 'line') {
      map.setPaintProperty(layer.id, 'line-color', waterway);
    }

    if (/^(poi|housenumber|aerodrome_label|boundary)$/.test(sourceLayer) || /(^|\W)poi(\W|$)/i.test(layer.id)) {
      hide();
    } else if (/^(landcover|landuse|landuse_overlay|globallandcover|park|building|aeroway)$/.test(sourceLayer) || layer.type === 'hillshade') {
      // Parks, land texture, buildings, and shading make the zoomed-out map look like a photo.
      // Keep one flat land color until you zoom in, then bring the detail back.
      map.setLayerZoomRange(layer.id, Math.max(layer.minzoom ?? 0, DETAIL_MIN_ZOOM), layer.maxzoom ?? 24);
      if (pencilLight && layer.type === 'fill') {
        if (sourceLayer === 'building') paint(layer.id, 'fill-color', '#efe7d3');
        else if (sourceLayer === 'park' || /park|wood|forest|grass|green|cemetery|pitch/i.test(layer.id)) paint(layer.id, 'fill-color', '#dcebc6');
      }
    } else if (sourceLayer === 'transportation' || sourceLayer === 'transportation_name') {
      if (/rail|transit|subway|cablecar|gondola|ferry/i.test(layer.id)) {
        hide();
      } else {
        const wanted = /highway|motorway|trunk|primary|major/i.test(layer.id) ? MAJOR_ROAD_MIN_ZOOM : ROAD_MIN_ZOOM;
        map.setLayerZoomRange(layer.id, Math.max(layer.minzoom ?? 0, wanted), layer.maxzoom ?? 24);
        // Streets in soft pencil instead of the usual gray-and-white road map.
        if (pencilLight && layer.type === 'line') paint(layer.id, 'line-color', /casing|outline/i.test(layer.id) ? '#c9bd9f' : '#e9dfc8');
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
