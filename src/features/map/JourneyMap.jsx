import { useMemo } from 'react';
import MapView from './MapView.jsx';
import { DEFAULT_STYLE_ID } from './mapStyles.js';

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

  return (
    <div className="journey-map" role="group" aria-label={label ?? 'Map of where you have explored'}>
      <MapView
        version={version}
        filters={NO_FILTERS}
        focus={focus}
        styleId={DEFAULT_STYLE_ID}
        layers={LAYERS}
        journey={journey}
        onSelectPlace={onSelectPlace ?? noop}
        onSelectStation={onSelectStation ?? noop}
        onTrainsInfo={noop}
      />
    </div>
  );
}
