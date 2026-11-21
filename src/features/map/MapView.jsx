import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { getPlaces, getRoutes, getStations, getStamps, getDex } from '../../lib/api.js';

// Vite serves dependencies from a different path than MapLibre expects, so tell it where its worker is.
setWorkerUrl(workerUrl);

const KEY = import.meta.env.VITE_MAPTILER_KEY;
// MapTiler when a key is configured, otherwise a free keyless style so the app still works.
const STYLE = KEY
  ? `https://api.maptiler.com/maps/basic-v2/style.json?key=${KEY}`
  : 'https://tiles.openfreemap.org/styles/positron';

const EMPTY = { type: 'FeatureCollection', features: [] };

const stationsGeoJSON = (stations, stampedById, lineColors) => ({
  type: 'FeatureCollection',
  features: stations.map((s) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    properties: {
      id: s.id,
      name: s.name,
      color: s.lines.length === 1 ? lineColors[s.lines[0]] : '#2b2b2b',
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
 * Map of Boston: subway lines and stations underneath, restaurants on top.
 * `version` changes whenever the dex changes, which refreshes stamps and collected markers.
 */
export default function MapView({ version, onSelectPlace, onSelectStation }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const lineColorsRef = useRef({});
  const handlersRef = useRef({});
  const [ready, setReady] = useState(false);

  // Keep the latest callbacks reachable from map event handlers.
  handlersRef.current = { onSelectPlace, onSelectStation };

  useEffect(() => {
    let cancelled = false;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: STYLE,
      center: [-71.09, 42.355],
      zoom: 11.6,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('error', (e) => console.warn('Map:', e.error?.message ?? e));

    map.on('load', async () => {
      // The basemap's own business markers would compete with ours, so hide them.
      for (const layer of map.getStyle().layers) {
        if (/poi/i.test(layer.id)) map.setLayoutProperty(layer.id, 'visibility', 'none');
      }

      const routes = await getRoutes();
      if (cancelled) return;
      lineColorsRef.current = Object.fromEntries(routes.map((r) => [r.id, r.color]));

      map.addSource('lines', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: routes.flatMap((r) =>
            r.shapes.map((coordinates) => ({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates },
              properties: { color: r.color },
            })),
          ),
        },
      });
      map.addSource('stations', { type: 'geojson', data: EMPTY });
      map.addSource('places', { type: 'geojson', data: EMPTY });

      map.addLayer({
        id: 'lines-casing',
        type: 'line',
        source: 'lines',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 10] },
      });
      map.addLayer({
        id: 'lines',
        type: 'line',
        source: 'lines',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 6] },
      });
      map.addLayer({
        id: 'stations',
        type: 'circle',
        source: 'stations',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 8],
          'circle-color': ['case', ['==', ['get', 'stamped'], 1], ['get', 'color'], '#ffffff'],
          'circle-stroke-color': ['get', 'color'],
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'station-labels',
        type: 'symbol',
        source: 'stations',
        minzoom: 13,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': '#2b2b2b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      });
      map.addLayer({
        id: 'places',
        type: 'circle',
        source: 'places',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 9],
          'circle-color': ['case', ['==', ['get', 'collected'], 1], '#f5b301', '#d6322c'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });

      setReady(true);
    });

    const hit = (point) =>
      map.queryRenderedFeatures(point, { layers: ['places', 'stations'].filter((l) => map.getLayer(l)) });

    map.on('click', (e) => {
      const features = hit(e.point);
      const place = features.find((f) => f.layer.id === 'places');
      const station = features.find((f) => f.layer.id === 'stations');
      if (place) handlersRef.current.onSelectPlace(place.properties.id);
      else if (station) handlersRef.current.onSelectStation(station.properties.id);
    });
    map.on('mousemove', (e) => {
      map.getCanvas().style.cursor = hit(e.point).length ? 'pointer' : '';
    });

    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return undefined;
    let cancelled = false;
    (async () => {
      const [stations, places, stamps, dex] = await Promise.all([
        getStations(),
        getPlaces(),
        getStamps(),
        getDex(),
      ]);
      if (cancelled || !map.getSource('stations')) return;
      const collected = new Set(dex.map((e) => e.place_id));
      map.getSource('stations').setData(stationsGeoJSON(stations, stamps.by_station, lineColorsRef.current));
      map.getSource('places').setData(placesGeoJSON(places, collected));
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, version]);

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      <div className="legend" aria-label="Map legend">
        <span><i className="dot dot-place" /> Restaurant</span>
        <span><i className="dot dot-collected" /> In your dex</span>
        <span><i className="dot dot-stamped" /> Stamped station</span>
        <span><i className="dot dot-station" /> Station</span>
      </div>
    </div>
  );
}
