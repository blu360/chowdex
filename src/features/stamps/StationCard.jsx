import { useEffect, useState } from 'react';
import { getArrivals, getStations, getStamps, getPlaces } from '../../lib/api.js';
import { LineChips } from '../place/PlaceCard.jsx';

export default function StationCard({ stationId, onClose, onSelectPlace }) {
  const [station, setStation] = useState(null);
  const [arrivals, setArrivals] = useState(null);
  const [stampedBy, setStampedBy] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setStation(null);
    setArrivals(null);
    Promise.all([getStations(), getArrivals(stationId), getStamps(), getPlaces()]).then(
      ([stations, arr, stamps, places]) => {
        if (cancelled) return;
        setStation(stations.find((s) => s.id === stationId) ?? null);
        setArrivals(arr);
        const ids = stamps.by_station[stationId] ?? [];
        setStampedBy(ids.map((id) => places.find((p) => p.id === id)).filter(Boolean));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [stationId]);

  return (
    <aside className="panel" aria-label="Station details">
      <button className="panel-close" onClick={onClose} aria-label="Close">×</button>
      {!station ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <h2>{station.name}</h2>
          <LineChips lines={station.lines} />

          <div className={stampedBy.length ? 'stamp-status got' : 'stamp-status'}>
            {stampedBy.length ? (
              <>
                <strong>Stamped</strong>
                <span>
                  via{' '}
                  {stampedBy.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ', '}
                      <button className="link" onClick={() => onSelectPlace(p.id)}>{p.name}</button>
                    </span>
                  ))}
                </span>
              </>
            ) : (
              <>
                <strong>Not stamped yet</strong>
                <span>Add a restaurant within 400 m of this station to your dex.</span>
              </>
            )}
          </div>

          <h3>Next trains</h3>
          {arrivals === null ? (
            <p className="muted">Loading…</p>
          ) : arrivals.length === 0 ? (
            <p className="muted">No trains are predicted right now. Service may be off or the live feed is unavailable.</p>
          ) : (
            <ul className="arrivals">
              {arrivals.map((a) => (
                <li key={`${a.route}-${a.direction}`}>
                  <span>{a.route} to {a.direction}</span>
                  <strong>{a.minutes} min</strong>
                </li>
              ))}
            </ul>
          )}
          {arrivals?.length > 0 && <p className="muted small">Live predictions from the MBTA.</p>}
        </>
      )}
    </aside>
  );
}
