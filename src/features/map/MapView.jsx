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
import { MAX_BOUNDS, MIN_ZOOM, VIEW_BOUNDS, pickLabelFont, styleById, tweakBasemap } from './mapStyles.js';
import { buildTracks, pointOnTrack, snapToTrack } from './trainTrack.js';

// Vite serves dependencies from a different path than MapLibre expects, so tell it where its worker is.
setWorkerUrl(workerUrl);

const EMPTY = { type: 'FeatureCollection', features: [] };
const NAVY = '#14407A';
const GOLD = '#F2B01E';
const TRAIN_POLL_MS = 8000;
const DEFAULT_GLIDE_MS = 12000;
const MIN_GLIDE_MS = 5000;
const MAX_GLIDE_MS = 25000;
const BACKWARD_NOISE_M = 120; // smaller "backward" moves are GPS noise
const MAX_JUMP_M = 1500; // bigger moves than this are stale data, not travel

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
  const casing = dark ? '#0a1526' : '#ffffff';
  const hoodVisibility = layers.neighborhoods ? 'visible' : 'none';
  const trainVisibility = layers.trains ? 'visible' : 'none';
  const hover = ['boolean', ['feature-state', 'hover'], false];

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
          10, ['case', hover, 0.5, 0.3],
          15.5, ['case', hover, 0.28, 0.08],
        ],
      },
    },
    firstSymbol,
  );
  map.addLayer(
    {
      id: 'neighborhoods-outline',
      type: 'line',
      source: 'neighborhoods',
      layout: { visibility: hoodVisibility },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 15, 2],
        'line-opacity': 0.7,
      },
    },
    firstSymbol,
  );

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
    paint: { 'line-color': casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4.5, 15, 10], 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'lines',
    type: 'line',
    source: 'lines',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 6] },
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
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 15, 2.5],
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
  map.addLayer({
    id: 'trains-halo',
    type: 'circle',
    source: 'trains',
    layout: { visibility: trainVisibility },
    paint: {
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.25,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 7, 15, 17],
    },
  });
  map.addLayer({
    id: 'trains',
    type: 'circle',
    source: 'trains',
    layout: { visibility: trainVisibility },
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 15, 7],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
    },
  });

  // Restaurants, on top of everything
  map.addSource('places', { type: 'geojson', data: data.places });
  map.addLayer({
    id: 'places',
    type: 'circle',
    source: 'places',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4.5, 15, 9],
      'circle-color': ['case', ['==', ['get', 'collected'], 1], GOLD, NAVY],
      'circle-stroke-color': dark ? '#0a1526' : '#ffffff',
      'circle-stroke-width': 2,
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
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const dataRef = useRef({ routes: [], neighborhoods: EMPTY, stations: EMPTY, places: EMPTY, trains: EMPTY });
  const lineColorsRef = useRef({});
  const tracksRef = useRef([]);
  const hoveredRef = useRef(null);
  const appliedStyleRef = useRef(styleId);
  const [ready, setReady] = useState(false);

  // Latest props, readable from map event handlers that outlive a render.
  const latest = useRef({});
  latest.current = { styleId, layers, onSelectPlace, onSelectStation, onTrainsInfo };

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
        bounds: VIEW_BOUNDS,
        fitBoundsOptions: { padding: 24 },
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
        map.getCanvas().style.cursor = top && top.layer.id !== 'trains' ? 'pointer' : '';

        // A small name tag on hover.
        if (top) {
          const key = `${top.layer.id}:${top.properties.id}`;
          if (key !== tipKey) {
            tipKey = key;
            const text = top.layer.id === 'trains' ? `${top.properties.line} Line train` : top.properties.name;
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
    for (const id of ['neighborhoods-fill', 'neighborhoods-outline', 'neighborhood-labels']) {
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
    for (const id of ['trains-halo', 'trains']) {
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
    const positionOf = (t, now) => pointOnTrack(trackByKey.get(t.trackKey), distanceOf(t, now));

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
        const place = () =>
          live.set(v.id, {
            trackKey: hit.track.key, from: hit.s, to: hit.s, startedAt: now,
            duration: DEFAULT_GLIDE_MS, lastChangeAt: now, line: v.line, color,
          });

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
        live.set(v.id, { ...prev, from: current, to: target, startedAt: now, duration, lastChangeAt: now, color });
      }
      for (const id of [...live.keys()]) if (!seen.has(id)) live.delete(id);
      latest.current.onTrainsInfo?.({ count: live.size, simulated: snap.simulated, error: false });
    }

    const render = () => {
      if (document.hidden) return;
      const now = performance.now();
      const fc = {
        type: 'FeatureCollection',
        features: [...live].map(([id, t]) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: positionOf(t, now) },
          properties: { id, line: t.line, color: t.color },
        })),
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

  // Fly to a search result
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    const wide = window.innerWidth > 800;
    const padding = { top: 40, bottom: 40, left: wide ? 400 : 40, right: wide ? 380 : 40 };
    if (focus.bounds) map.fitBounds(focus.bounds, { padding, maxZoom: 14.5, duration: 900 });
    else if (focus.center) map.flyTo({ center: focus.center, zoom: Math.max(map.getZoom(), 14.5), padding, duration: 900, essential: true });
  }, [ready, focus]);

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
    </div>
  );
}
