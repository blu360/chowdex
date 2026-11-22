import { useEffect, useMemo, useState } from 'react';
import MapView from './MapView.jsx';
import { DEFAULT_STYLE_ID, MAP_STYLES } from './mapStyles.js';

/** True while the whole app is in night mode (App.jsx sets data-theme on <html>). */
function useNight() {
  const read = () => document.documentElement.dataset.theme === 'night';
  const [night, setNight] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setNight(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    setNight(read());
    return () => observer.disconnect();
  }, []);
  return night;
}

const NO_FILTERS = {};
const LAYERS = { neighborhoods: true, trains: false, simulate: false };
/** All 24 neighborhoods, so the whole city fits whatever the size of the map. */
const CITY_BOUNDS = [[-71.192, 42.227], [-70.985, 42.405]];

/**
 * A small "where I've been" map. It is the same MapView as the Explore screen, in journey mode:
 * explored neighborhoods are lit, the rest are dimmed, and only the given restaurants are shown.
 *
 * @param {Object} props
 * @param {number}   props.version      bumps when the dex changes
 * @param {string[]} props.hoodIds      neighborhoods to light up
 * @param {string[]|null} [props.placeIds]  restaurants to show; null shows everything in the dex
 * @param {number[][]|null} [props.bounds]  [[west, south], [east, north]] to zoom to; null keeps the city view
 * @param {(id: string) => void} [props.onSelectPlace]
 * @param {(id: string) => void} [props.onSelectStation]
 */
export default function JourneyMap({ version, hoodIds, placeIds = null, bounds = null, onSelectPlace, onSelectStation, label }) {
  const boundsKey = JSON.stringify(bounds ?? CITY_BOUNDS);
  const focus = useMemo(() => ({ bounds: JSON.parse(boundsKey) }), [boundsKey]);
  const journey = useMemo(() => ({ hoodIds, placeIds }), [JSON.stringify(hoodIds), JSON.stringify(placeIds)]);
  const noop = () => {};
  const night = useNight();
  const darkStyle = MAP_STYLES.find((s) => s.dark);
  const styleId = night && darkStyle ? darkStyle.id : DEFAULT_STYLE_ID;

  return (
    <div className="journey-map" role="group" aria-label={label ?? 'Map of where you have explored'}>
      <MapView
        version={version}
        filters={NO_FILTERS}
        focus={focus}
        styleId={styleId}
        layers={LAYERS}
        journey={journey}
        onSelectPlace={onSelectPlace ?? noop}
        onSelectStation={onSelectStation ?? noop}
        onTrainsInfo={noop}
      />
    </div>
  );
}
