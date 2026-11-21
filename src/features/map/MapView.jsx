import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  getPlaces,
  getRoutes,
  getStations,
  getStamps,
  getDex,
  getNeighborhoods,
  getVehicles,
} from '../../lib/api.js';
import { DEFAULT_VIEW, MAX_BOUNDS, MIN_ZOOM, PLACE_MIN_ZOOM, pickLabelFont, styleById, tweakBasemap } from './mapStyles.js';
import { angleDiff, buildTracks, headingOnTrack, pointOnTrack, snapToTrack } from './trainTrack.js';
import { registerTrainIcons } from './trainIcons.js';
import { SKETCH_LEVELS, hatchImage, sketchOutlines } from './sketch.js';

// Vite serves dependencies from a different path than MapLibre expects, so tell it where its worker is.
setWorkerUrl(workerUrl);

const EMPTY = { type: 'FeatureCollection', features: [] };
const INK = '#111111';
/** Every neighborhood layer, for the show/hide toggle. */
const HOOD_LAYERS = ['neighborhoods-fill', 'neighborhoods-hatch', ...SKETCH_LEVELS.map((l) => `neighborhoods-outline-${l.id}`), 'neighborhood-labels'];
const ACCENT = '#A9D7F7'; // same baby blue as --accent in game.css
const NAVY = '#14407A';
const TRAIN_POLL_MS = 8000;
const TRAIN_ICON_MIN_ZOOM = 14.8; // trains are hidden below this zoom
const DEFAULT_GLIDE_MS = 12000;
const MIN_GLIDE_MS = 5000;
const MAX_GLIDE_MS = 25000;
const BACKWARD_NOISE_M = 120; // smaller "backward" moves are GPS noise
const MAX_JUMP_M = 1500; // bigger moves than this are stale data, not travel
const JOURNEY_ZOOM = 9.9; // opening zoom of the small journey maps

const stationsGeoJSON = (stations, stampedById, lineColors) => ({
  type: 'FeatureCollection',
  features: stations.map((s) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    properties: {
      id: s.id,
      name: s.name,
      color: s.lines.length === 1 ? lineColors[s.lines[0]] : '#1d2b45',
      stamped: stampedById[s.id] ? 1 : 0,
    },
  })),
});

const placesGeoJSON = (places, collected) => ({
  type: 'FeatureCollection',
  features: places.map((p) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    properties: { id: p.id, name: p.name, collected: collected.has(p.id) ? 1 : 0 },
  })),
});

/**
 * Adds all of our layers on top of whichever basemap is loaded. Runs again after every basemap
 * switch (switching styles wipes custom layers), reading the latest data from `ctx.data`.
 */
function installLayers(map, { data, dark, layers }) {
  if (map.getSource('lines')) return;

  const fonts = pickLabelFont(map);
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  const ink = dark ? '#dbe7fb' : '#12305a';
  const halo = dark ? 'rgba(8,16,30,0.85)' : 'rgba(255,255,255,0.92)';
  const casing = dark ? '#0a1526' : INK; // the T lines are outlined in marker ink, like the rest of the app
  const hoodVisibility = layers.neighborhoods ? 'visible' : 'none';
  const trainVisibility = layers.trains ? 'visible' : 'none';
  const hover = ['boolean', ['feature-state', 'hover'], false];
  // Journey mode (dashboard and pet profile maps): explored neighborhoods are lit, the rest are dimmed.
  const lit = ['boolean', ['feature-state', 'lit'], false];
  const dim = ['boolean', ['feature-state', 'dim'], false];

  // Neighborhoods: soft color washes that fade as you zoom in, so streets take over up close.
  map.addSource('neighborhoods', { type: 'geojson', data: data.neighborhoods, promoteId: 'id' });
  map.addLayer(
    {
      id: 'neighborhoods-fill',
      type: 'fill',
      source: 'neighborhoods',
      layout: { visibility: hoodVisibility },
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          10, ['case', dim, 0.07, lit, 0.46, hover, 0.44, 0.24],
          15.5, ['case', dim, 0.04, lit, 0.14, hover, 0.28, 0.08],
        ],
      },
    },
    firstSymbol,
  );
  // Crayon hatching over the wash, like a hand-colored map. One small tile per neighborhood color.
  for (const f of data.neighborhoods.features) {
    const name = `hatch-${f.properties.id}`;
    if (!map.hasImage(name)) map.addImage(name, hatchImage(f.properties.color, f.properties.id), { pixelRatio: 2 });
  }
  map.addLayer(
    {
      id: 'neighborhoods-hatch',
      type: 'fill',
      source: 'neighborhoods',
      layout: { visibility: hoodVisibility },
      paint: {
        'fill-pattern': ['concat', 'hatch-', ['get', 'id']],
        'fill-opacity': [
          'interpolate', ['linear'], ['zoom'],
          10, ['case', dim, 0.1, lit, 0.7, hover, 0.62, 0.34],
          15.5, ['case', dim, 0.05, lit, 0.3, hover, 0.3, 0.12],
        ],
      },
    },
    firstSymbol,
  );

  // Hand-drawn borders in colored pencil: a wobbly redraw of each outline, one drawing per zoom range.
  // Neighbors each draw their own side of a shared border, so those get the doubled line of a sketch.
  const outlines = sketchOutlines(data.neighborhoods);
  for (const level of SKETCH_LEVELS) {
    map.addSource(`neighborhood-sketch-${level.id}`, { type: 'geojson', data: outlines[level.id] });
    map.addLayer(
      {
        id: `neighborhoods-outline-${level.id}`,
        type: 'line',
        source: `neighborhood-sketch-${level.id}`,
        minzoom: level.minzoom,
        maxzoom: level.maxzoom,
        layout: { visibility: hoodVisibility, 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['==', ['get', 'pass'], 2], 0.9, 1.5], 16, ['case', ['==', ['get', 'pass'], 2], 1.5, 2.6]],
          'line-opacity': ['case', ['==', ['get', 'pass'], 2], 0.5, 0.9],
        },
      },
      firstSymbol,
    );
  }

  // Subway lines
  map.addSource('lines', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: data.routes.flatMap((r) =>
        r.shapes.map((coordinates) => ({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates },
          properties: { color: r.color },
        })),
      ),
    },
  });
  map.addLayer({
    id: 'lines-casing',
    type: 'line',
    source: 'lines',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 10], 'line-opacity': dark ? 0.9 : 1 },
  });
  map.addLayer({
    id: 'lines',
    type: 'line',
    source: 'lines',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 6] },
  });

  // A directions route: train segments in their line color with a dark outline, and walking as a dashed line.
  map.addSource('route', { type: 'geojson', data: data.route });
  const isRide = ['==', ['get', 'kind'], 'ride'];
  const isWalk = ['==', ['get', 'kind'], 'walk'];
  map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', isRide, dark ? '#0a1526' : INK, dark ? '#0a1526' : '#ffffff'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', isRide, 8, 6], 16, ['case', isRide, 16, 11]],
    },
  });
  map.addLayer({
    id: 'route-ride',
    type: 'line',
    source: 'route',
    filter: isRide,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 10] },
  });
  map.addLayer({
    id: 'route-walk',
    type: 'line',
    source: 'route',
    filter: isWalk,
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': dark ? '#dbe7fb' : INK,
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 16, 5],
      'line-dasharray': [1.1, 1.5],
    },
  });

  map.addLayer({
    id: 'neighborhood-labels',
    type: 'symbol',
    source: 'neighborhoods',
    minzoom: 10.5,
    layout: {
      visibility: hoodVisibility,
      'text-field': ['get', 'name'],
      'text-font': fonts,
      'text-size': ['interpolate', ['linear'], ['zoom'], 10.5, 10, 14, 14],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.06,
      'text-max-width': 6,
      'text-optional': true,
    },
    paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.6, 'text-opacity': 0.85 },
  });

  // Stations
  map.addSource('stations', { type: 'geojson', data: data.stations });
  map.addLayer({
    id: 'stations',
    type: 'circle',
    source: 'stations',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 8],
      'circle-color': ['case', ['==', ['get', 'stamped'], 1], ['get', 'color'], dark ? '#16233b' : '#ffffff'],
      'circle-stroke-color': dark ? '#dbe7fb' : INK,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 3],
    },
  });
  map.addLayer({
    id: 'station-labels',
    type: 'symbol',
    source: 'stations',
    minzoom: 12.5,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': fonts,
      'text-size': 11,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.5 },
  });

  // Live trains
  map.addSource('trains', { type: 'geojson', data: data.trains });
  // Trains only appear once you zoom in close, as a little car that faces the way it is going.
  registerTrainIcons(map, Object.fromEntries(data.routes.map((r) => [r.id, r.color])));
  map.addLayer({
    id: 'trains',
    type: 'symbol',
    source: 'trains',
    minzoom: TRAIN_ICON_MIN_ZOOM,
    layout: {
      visibility: trainVisibility,
      'icon-image': ['concat', 'train-', ['get', 'line'], ['case', ['==', ['get', 'left'], 1], '-l', '-r']],
      'icon-rotate': ['get', 'rot'],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], TRAIN_ICON_MIN_ZOOM, 0.7, 17, 1.2],
    },
  });

  // Restaurants, on top of everything
  map.addSource('places', { type: 'geojson', data: data.places });
  map.addLayer({
    id: 'places',
    type: 'circle',
    source: 'places',
    minzoom: PLACE_MIN_ZOOM,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4.5, 15, 9],
      'circle-color': ['case', ['==', ['get', 'collected'], 1], ACCENT, dark ? '#dbe7fb' : NAVY],
      'circle-stroke-color': dark ? '#0a1526' : INK,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 15, 2.5],
    },
  });
  map.addLayer({
    id: 'place-labels',
    type: 'symbol',
    source: 'places',
    minzoom: 14,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': fonts,
      'text-size': 12,
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: { 'text-color': ink, 'text-halo-color': halo, 'text-halo-width': 1.6 },
  });
}

/**
 * The map: a quiet basemap, colored neighborhoods, the T, live trains, and restaurants.
 * `version` changes whenever the dex changes, which refreshes stamps and collected markers.
 */
export default function MapView({
  version,
  filters,
  focus,
  styleId,
  layers,
  onSelectPlace,
  onSelectStation,
  onTrainsInfo,
  route = null, // optional: a directions route as GeoJSON (see routeToGeoJSON), drawn on top of the lines
  journey = null, // optional: { hoodIds: string[], placeIds: string[]|null } turns this into a small "where I've been" map
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const dataRef = useRef({ routes: [], neighborhoods: EMPTY, stations: EMPTY, places: EMPTY, trains: EMPTY, route: EMPTY });
  const lineColorsRef = useRef({});
  const tracksRef = useRef([]);
  const hoveredRef = useRef(null);
  const appliedStyleRef = useRef(styleId);
  const [ready, setReady] = useState(false);

  // Latest props, readable from map event handlers that outlive a render.
  const latest = useRef({});
  latest.current = { styleId, layers, onSelectPlace, onSelectStation, onTrainsInfo, journey };

  useEffect(() => {
    let cancelled = false;
    let map = null;

    (async () => {
      const [routes, neighborhoods] = await Promise.all([getRoutes(), getNeighborhoods()]);
      if (cancelled) return;
      dataRef.current.routes = routes;
      dataRef.current.neighborhoods = neighborhoods;
      lineColorsRef.current = Object.fromEntries(routes.map((r) => [r.id, r.color]));
      tracksRef.current = buildTracks(routes);

      appliedStyleRef.current = latest.current.styleId;
      map = new MapLibreMap({
        container: containerRef.current,
        style: styleById(latest.current.styleId).url,
        center: DEFAULT_VIEW.center,
        zoom: latest.current.journey ? JOURNEY_ZOOM : window.innerWidth < 700 ? DEFAULT_VIEW.mobileZoom : DEFAULT_VIEW.zoom,
        // A small map inside a scrolling page must not hijack the scroll: two fingers (or ctrl + wheel) move it.
        cooperativeGestures: Boolean(latest.current.journey),
        maxBounds: MAX_BOUNDS,
        minZoom: MIN_ZOOM,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      if (import.meta.env.DEV) window.__chowdexMap = map; // handy for debugging in the browser console
      map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
      map.on('error', (e) => console.warn('Map:', e.error?.message ?? e));

      // Runs for the first basemap and again after every basemap switch.
      map.on('style.load', () => {
        const style = styleById(appliedStyleRef.current);
        tweakBasemap(map, style);
        hoveredRef.current = null;
        installLayers(map, {
          data: dataRef.current,
          dark: style.dark,
          layers: latest.current.layers,
        });
        setReady(true);
      });

      const tip = new Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'hover-tip' });
      let tipKey = null;
      const interactive = ['places', 'stations', 'trains'];
      const hit = (point) =>
        map.queryRenderedFeatures(point, { layers: interactive.filter((l) => map.getLayer(l)) });

      map.on('click', (e) => {
        const features = hit(e.point);
        const place = features.find((f) => f.layer.id === 'places');
        const station = features.find((f) => f.layer.id === 'stations');
        if (place) latest.current.onSelectPlace(place.properties.id);
        else if (station) latest.current.onSelectStation(station.properties.id);
      });

      map.on('mousemove', (e) => {
        const features = hit(e.point);
        const top = features[0];
        map.getCanvas().style.cursor = top && !top.layer.id.startsWith('trains') ? 'pointer' : '';

        // A small name tag on hover.
        if (top) {
          const key = `${top.layer.id}:${top.properties.id}`;
          if (key !== tipKey) {
            tipKey = key;
            const text = top.layer.id.startsWith('trains') ?`${top.properties.line} Line train` : top.properties.name;
            tip.setLngLat(top.geometry.coordinates).setText(text).addTo(map);
          }
        } else if (tipKey) {
          tipKey = null;
          tip.remove();
        }

        // Brighten the neighborhood under the cursor.
        const hood =
          !top && map.getLayer('neighborhoods-fill') && map.getLayoutProperty('neighborhoods-fill', 'visibility') !== 'none'
            ? map.queryRenderedFeatures(e.point, { layers: ['neighborhoods-fill'] })[0]
            : null;
        const id = hood?.properties.id ?? null;
        if (id === hoveredRef.current) return;
        if (hoveredRef.current) map.setFeatureState({ source: 'neighborhoods', id: hoveredRef.current }, { hover: false });
        if (id) map.setFeatureState({ source: 'neighborhoods', id }, { hover: true });
        hoveredRef.current = id;
      });
    })();

    return () => {
      cancelled = true;
      if (map) map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Basemap switch
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || appliedStyleRef.current === styleId) return;
    appliedStyleRef.current = styleId;
    map.setStyle(styleById(styleId).url);
  }, [ready, styleId]);

  // Neighborhood layer toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const visibility = layers.neighborhoods ? 'visible' : 'none';
    for (const id of HOOD_LAYERS) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    }
  }, [ready, layers.neighborhoods]);

  // Stations (stamps) and restaurants (filters, collected)
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return undefined;
    let cancelled = false;
    (async () => {
      const [stations, places, stamps, dex] = await Promise.all([
        getStations(),
        getPlaces(JSON.parse(filterKey)),
        getStamps(),
        getDex(),
      ]);
      if (cancelled || !mapRef.current) return;
      const collected = new Set(dex.map((e) => e.place_id));
      dataRef.current.stations = stationsGeoJSON(stations, stamps.by_station, lineColorsRef.current);
      dataRef.current.places = placesGeoJSON(places, collected);
      map.getSource('stations')?.setData(dataRef.current.stations);
      map.getSource('places')?.setData(dataRef.current.places);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, version, filterKey]);

  // Moving trains: poll the feed, then glide each train from its old position to its new one.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return undefined;
    const visibility = layers.trains ? 'visible' : 'none';
    for (const id of ['trains']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    }
    if (!layers.trains) {
      latest.current.onTrainsInfo?.(null);
      return undefined;
    }

    let stopped = false;
    let hadSnapshot = false;
    // id -> { trackKey, from, to, startedAt, duration, lastChangeAt, line, color }
    // `from` and `to` are meters along the train's track, so it can only ever move along the line.
    const live = new Map();
    const tracks = tracksRef.current;
    const trackByKey = new Map(tracks.map((t) => [t.key, t]));

    const distanceOf = (t, now) => t.from + (t.to - t.from) * Math.min(1, (now - t.startedAt) / t.duration);

    async function poll() {
      let snap;
      try {
        snap = await getVehicles({ simulate: layers.simulate });
      } catch {
        snap = { vehicles: null, error: true };
      }
      // Offline or blocked on the very first try: fall back to made-up trains so the map still moves.
      if (snap.error && !hadSnapshot) snap = await getVehicles({ simulate: true });
      if (stopped) return;
      if (!snap.vehicles) {
        latest.current.onTrainsInfo?.({ count: live.size, simulated: false, error: true });
        return;
      }
      hadSnapshot = true;
      const now = performance.now();
      const seen = new Set();
      for (const v of snap.vehicles) {
        const prev = live.get(v.id);
        const hit = snapToTrack(tracks, v, prev?.trackKey);
        if (!hit) continue;
        seen.add(v.id);
        const color = lineColorsRef.current[v.line] ?? '#1d2b45';
        const place = () => {
          // Which way along the track is it headed? Compare the feed's bearing with the track's direction.
          const along = headingOnTrack(hit.track, hit.s);
          const dir = v.bearing != null && angleDiff(v.bearing, along) > 90 ? -1 : 1;
          live.set(v.id, {
            trackKey: hit.track.key, from: hit.s, to: hit.s, startedAt: now,
            duration: DEFAULT_GLIDE_MS, lastChangeAt: now, line: v.line, color, dir,
          });
        };

        // New train, or it moved onto another track (a branch): put it there without animating.
        if (!prev || prev.trackKey !== hit.track.key) {
          place();
          continue;
        }
        // GPS wobble can report a train a little behind where it was. Trains don't back up, so ignore it.
        let target = hit.s;
        if (target < prev.to && prev.to - target < BACKWARD_NOISE_M) target = prev.to;
        // No new position yet: keep gliding toward the last one.
        if (Math.abs(target - prev.to) < 3) continue;

        const current = distanceOf(prev, now);
        if (Math.abs(target - current) > MAX_JUMP_M) {
          place(); // too far to be one step of real travel (stale data): don't animate it
          continue;
        }
        // Glide over about as long as this train took to report its last move, so it keeps moving smoothly.
        const duration = Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, now - prev.lastChangeAt));
        live.set(v.id, {
          ...prev, from: current, to: target, startedAt: now, duration, lastChangeAt: now, color,
          dir: target > prev.to ? 1 : -1,
        });
      }
      for (const id of [...live.keys()]) if (!seen.has(id)) live.delete(id);
      latest.current.onTrainsInfo?.({ count: live.size, simulated: snap.simulated, error: false });
    }

    const render = () => {
      if (document.hidden) return;
      const now = performance.now();
      const fc = {
        type: 'FeatureCollection',
        features: [...live].map(([id, t]) => {
          const track = trackByKey.get(t.trackKey);
          const s = distanceOf(t, now);
          // The icon points right or left (never upside down) and is rotated to follow the track.
          const heading = (headingOnTrack(track, s) + (t.dir < 0 ? 180 : 0)) % 360;
          const left = heading >= 180;
          return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: pointOnTrack(track, s) },
            properties: { id, line: t.line, color: t.color, left: left ? 1 : 0, rot: left ? heading - 270 : heading - 90 },
          };
        }),
      };
      dataRef.current.trains = fc;
      map.getSource('trains')?.setData(fc);
    };

    poll();
    const pollTimer = setInterval(poll, TRAIN_POLL_MS);
    const renderTimer = setInterval(render, 66);
    return () => {
      stopped = true;
      clearInterval(pollTimer);
      clearInterval(renderTimer);
      dataRef.current.trains = EMPTY;
      map.getSource('trains')?.setData(EMPTY);
    };
  }, [ready, layers.trains, layers.simulate]);

  // Journey mode: light up the explored neighborhoods and show only the given restaurants, at any zoom.
  const journeyKey = journey ? JSON.stringify(journey) : null;
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !journeyKey) return;
    const { hoodIds = [], placeIds = null } = JSON.parse(journeyKey);
    const explored = new Set(hoodIds);
    // On a small map the credits start collapsed behind the (i) button, so they don't cover the map.
    const collapseCredits = () => {
      const el = containerRef.current?.querySelector('.maplibregl-ctrl-attrib');
      el?.classList.remove('maplibregl-compact-show');
      el?.removeAttribute('open');
    };
    collapseCredits();
    const creditsTimer = setTimeout(collapseCredits, 600);
    for (const f of dataRef.current.neighborhoods.features) {
      const on = explored.has(f.properties.id);
      map.setFeatureState({ source: 'neighborhoods', id: f.properties.id }, { lit: on, dim: !on });
    }
    for (const level of SKETCH_LEVELS) {
      const id = `neighborhoods-outline-${level.id}`;
      if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', ['case', ['in', ['get', 'id'], ['literal', hoodIds]], ['case', ['==', ['get', 'pass'], 2], 0.55, 1], 0.25]);
    }
    const only = placeIds ? ['in', ['get', 'id'], ['literal', placeIds]] : ['==', ['get', 'collected'], 1];
    for (const id of ['places', 'place-labels']) {
      if (!map.getLayer(id)) continue;
      map.setFilter(id, only);
      if (id === 'places') map.setLayerZoomRange(id, 0, 24);
    }
    return () => clearTimeout(creditsTimer);
  }, [ready, journeyKey]);

  // Directions route: draw it, and frame the whole trip.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const fc = route ?? EMPTY;
    dataRef.current.route = fc;
    map.getSource('route')?.setData(fc);
    if (!route?.features.length || latest.current.journey) return;
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const f of route.features) {
      for (const [lng, lat] of f.geometry.coordinates) {
        west = Math.min(west, lng); east = Math.max(east, lng);
        south = Math.min(south, lat); north = Math.max(north, lat);
      }
    }
    // Leave room for the search panel on the left and the place card on the right, but never so much that nothing fits.
    const width = window.innerWidth;
    const wide = width > 800;
    const side = wide ? Math.min(400, Math.round(width * 0.3)) : 40;
    // The map keeps whatever padding an earlier "fly to" set, and fitBounds adds to it, so set it here once and
    // use only a small extra margin (otherwise the two together can leave no room and the move is skipped).
    map.setPadding({ top: 40, bottom: wide ? 40 : 280, left: side, right: side });
    map.fitBounds([[west, south], [east, north]], { padding: 24, maxZoom: 15.5, duration: 900 });
  }, [ready, route]);

  // Fly to a search result
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    const wide = window.innerWidth > 800;
    const padding = latest.current.journey
      ? 36
      : { top: 40, bottom: 40, left: wide ? 400 : 40, right: wide ? 380 : 40 };
    if (focus.bounds) map.fitBounds(focus.bounds, { padding, maxZoom: 14.5, duration: 900 });
    else if (focus.center) map.flyTo({ center: focus.center, zoom: Math.max(map.getZoom(), 14.5), padding, duration: 900, essential: true });
  }, [ready, focus]);

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
    </div>
  );
}
