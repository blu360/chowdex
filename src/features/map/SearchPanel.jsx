import { useEffect, useMemo, useState } from 'react';
import { getPlaces, getStations, getNeighborhoods } from '../../lib/api.js';
import { LINE_COLORS } from '../../lib/lines.js';
import { MAP_STYLES } from './mapStyles.js';

/** [[west, south], [east, north]] of a GeoJSON geometry. */
function geometryBounds(geometry) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      w = Math.min(w, c[0]); e = Math.max(e, c[0]);
      s = Math.min(s, c[1]); n = Math.max(n, c[1]);
    } else c.forEach(walk);
  };
  walk(geometry.coordinates);
  return [[w, s], [e, n]];
}

const rank = (text, q) => {
  const i = text.toLowerCase().indexOf(q);
  return i === -1 ? Infinity : i;
};

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" />
    </svg>
  );
}

export default function SearchPanel({ filters, onFilters, layers, onLayers, styleId, onStyleId, trainsInfo, onPick }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [data, setData] = useState({ places: [], stations: [], hoods: [] });

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPlaces(), getStations(), getNeighborhoods()]).then(([places, stations, hoods]) => {
      if (!cancelled) setData({ places, stations, hoods: hoods.features });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    const by = (key) => (a, b) => rank(key(a), q) - rank(key(b), q);
    const places = data.places
      .filter((p) => p.name.toLowerCase().includes(q) || p.cuisine.replace('_', ' ').includes(q))
      .sort(by((p) => p.name))
      .slice(0, 5);
    const stations = data.stations.filter((s) => s.name.toLowerCase().includes(q)).sort(by((s) => s.name)).slice(0, 4);
    const hoods = data.hoods.filter((h) => h.properties.name.toLowerCase().includes(q)).sort(by((h) => h.properties.name)).slice(0, 4);
    return { places, stations, hoods, total: places.length + stations.length + hoods.length };
  }, [q, data]);

  const pick = (target) => {
    onPick(target);
    setQuery('');
    setFocused(false);
    document.activeElement?.blur?.();
  };
  const pickPlace = (p) => pick({ type: 'place', id: p.id, center: [p.lng, p.lat] });
  const pickStation = (s) => pick({ type: 'station', id: s.id, center: [s.lng, s.lat] });
  const pickHood = (h) => pick({ type: 'neighborhood', id: h.properties.id, bounds: geometryBounds(h.geometry) });

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      setQuery('');
      e.currentTarget.blur();
    } else if (e.key === 'Enter' && results?.total) {
      if (results.places[0]) pickPlace(results.places[0]);
      else if (results.stations[0]) pickStation(results.stations[0]);
      else pickHood(results.hoods[0]);
    }
  };

  const activeCount = Number(Boolean(filters.openLate)) + Number(Boolean(filters.maxPrice)) + Number(Boolean(filters.line));
  const toggle = (key, value) => onFilters({ ...filters, [key]: filters[key] === value ? undefined : value });

  const trainsText = !trainsInfo
    ? null
    : trainsInfo.error
      ? 'Live feed unavailable'
      : trainsInfo.simulated
        ? `${trainsInfo.count} simulated (sped up)`
        : `${trainsInfo.count} running now`;

  return (
    <div className="search-card">
      <div className="search-row">
        <div className="search-input">
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onKeyDown={onKeyDown}
            placeholder="Search food, stations, areas"
            aria-label="Search the map"
          />
          {query && (
            <button className="clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>
          )}
        </div>
        <button
          className={layersOpen ? 'icon-btn on' : 'icon-btn'}
          onClick={() => setLayersOpen((o) => !o)}
          aria-expanded={layersOpen}
          aria-label="Map layers and style"
          title="Map layers and style"
        >
          <LayersIcon />
        </button>
      </div>

      {results && focused && (
        <div className="results" role="listbox">
          {results.total === 0 && <p className="muted result-empty">No matches for “{query.trim()}”</p>}
          {results.places.length > 0 && (
            <div className="result-group">
              <h4>Restaurants</h4>
              {results.places.map((p) => (
                <button key={p.id} className="result" onClick={() => pickPlace(p)}>
                  <i className="sym sym-place" />
                  <span>{p.name}<small>{p.cuisine.replace('_', ' ')} · near {p.nearest_stop.name}</small></span>
                </button>
              ))}
            </div>
          )}
          {results.stations.length > 0 && (
            <div className="result-group">
              <h4>T stations</h4>
              {results.stations.map((s) => (
                <button key={s.id} className="result" onClick={() => pickStation(s)}>
                  <i className="sym sym-station" />
                  <span>
                    {s.name}
                    <small className="line-dots">
                      {s.lines.map((l) => <b key={l} style={{ background: LINE_COLORS[l] }} title={`${l} Line`} />)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
          {results.hoods.length > 0 && (
            <div className="result-group">
              <h4>Neighborhoods</h4>
              {results.hoods.map((h) => (
                <button key={h.properties.id} className="result" onClick={() => pickHood(h)}>
                  <i className="sym sym-hood" style={{ background: h.properties.color }} />
                  <span>{h.properties.name}<small>{h.properties.city}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="chip-row" aria-label="Filters">
        <button className={filters.openLate ? 'chip-btn on' : 'chip-btn'} onClick={() => toggle('openLate', true)}>
          Open late
        </button>
        <button className={filters.maxPrice ? 'chip-btn on' : 'chip-btn'} onClick={() => toggle('maxPrice', 1)}>
          $ Cheap eats
        </button>
        {activeCount > 0 && (
          <button className="chip-clear" onClick={() => onFilters({})}>Clear</button>
        )}
        <div className="chip-group">
          <span className="chip-label">Near</span>
          {Object.entries(LINE_COLORS).map(([line, color]) => (
            <button
              key={line}
              className={filters.line === line ? 'chip-btn on line' : 'chip-btn line'}
              style={filters.line === line ? { background: color, borderColor: color } : undefined}
              onClick={() => toggle('line', line)}
              aria-pressed={filters.line === line}
            >
              <b style={{ background: color }} />
              {line}
            </button>
          ))}
        </div>
      </div>

      {layersOpen && (
        <div className="layers-panel">
          <label className="switch-row">
            <input type="checkbox" checked={layers.neighborhoods} onChange={(e) => onLayers({ ...layers, neighborhoods: e.target.checked })} />
            <span>Neighborhoods</span>
          </label>
          <label className="switch-row">
            <input type="checkbox" checked={layers.trains} onChange={(e) => onLayers({ ...layers, trains: e.target.checked })} />
            <span>Live trains {layers.trains && trainsText && <small className="muted">· {trainsText}</small>}</span>
          </label>
          {layers.trains && (
            <label className="switch-row sub">
              <input type="checkbox" checked={layers.simulate} onChange={(e) => onLayers({ ...layers, simulate: e.target.checked })} />
              <span>Simulate trains <small className="muted">(for demos, when service is off)</small></span>
            </label>
          )}
          <h4>Map style</h4>
          <div className="style-grid">
            {MAP_STYLES.map((s) => (
              <button
                key={s.id}
                className={s.id === styleId ? 'style-tile on' : 'style-tile'}
                onClick={() => onStyleId(s.id)}
                aria-pressed={s.id === styleId}
              >
                <span className="swatch" style={{ background: `linear-gradient(135deg, ${s.swatch[0]} 55%, ${s.swatch[1]} 55%)` }} />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
