import { useEffect, useState } from 'react';
import { deleteTrip, getTrips, getTripTally } from '../../lib/api.js';
import { Icon } from '../../components/ui.jsx';

const SHOWN = 3;
const fmt = (n, digits = 1) => (n < 0.05 && n > 0 ? '<0.1' : n.toFixed(digits));

/**
 * The green-trips tally: trips the rider chose to log from the directions panel, with the miles travelled
 * and the CO2 saved compared with driving. It stores no locations.
 */
export default function GreenTally({ version, onGo }) {
  const [tally, setTally] = useState(null);
  const [trips, setTrips] = useState([]);
  const [all, setAll] = useState(false);
  const [change, setChange] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getTripTally(), getTrips()]).then(([t, list]) => {
      if (cancelled) return;
      setTally(t);
      setTrips(list);
    });
    return () => {
      cancelled = true;
    };
  }, [version, change]);

  async function remove(id) {
    await deleteTrip(id);
    setChange((c) => c + 1);
  }

  if (!tally) return null;
  const shown = all ? trips : trips.slice(0, SHOWN);

  return (
    <section className="card green-tally area-green" aria-label="Green trips">
      <div className="sec-head">
        <h2>Green trips</h2>
        <button className="sec-link" onClick={() => onGo('explore')}>Find a trip</button>
      </div>

      {tally.trips === 0 ? (
        <p className="muted">
          Tap a restaurant on the <button className="link" onClick={() => onGo('explore')}>map</button>, open <b>Directions</b>, and tap <b>I took this trip</b> to start your tally.
          Only trips you choose to add are counted.
        </p>
      ) : (
        <>
          <div className="tally-grid">
            <div className="tally-stat big">
              <Icon name="check" size={18} />
              <strong>{fmt(tally.co2_saved_kg)}<small> kg</small></strong>
              <span>CO₂ saved vs driving</span>
            </div>
            <div className="tally-stat">
              <strong>{fmt(tally.miles)}<small> mi</small></strong>
              <span>travelled by T and on foot</span>
            </div>
            <div className="tally-stat">
              <strong>{tally.trips}</strong>
              <span>{tally.trips === 1 ? 'trip' : 'trips'} logged</span>
            </div>
          </div>
          <p className="muted small">
            {fmt(tally.transit_miles)} mi on the T · {fmt(tally.walk_miles)} mi walking · the same trips by car would have been {fmt(tally.car_miles_avoided)} mi.
          </p>

          <ul className="trip-list">
            {shown.map((t) => (
              <li key={t.id}>
                <span>
                  <b>{t.place_name}</b>
                  <small>
                    from {t.from_name} · {fmt(t.transit_miles + t.walk_miles)} mi · saved {fmt(t.co2_saved_kg)} kg
                  </small>
                </span>
                <button className="trip-remove" onClick={() => remove(t.id)} aria-label={`Remove trip to ${t.place_name}`} title="Remove this trip">
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
          </ul>
          {trips.length > SHOWN && (
            <button className="link" onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${trips.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
