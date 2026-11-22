import { useEffect, useState } from 'react';
import { getPlaces } from '../../lib/api.js';
import { Icon } from '../../components/ui.jsx';
import { distanceM, formatDistance } from '../../lib/onboarding.js';
import { cuisineLabel } from '../../lib/placeLabels.js';
import { openStatus } from '../../lib/hours.js';

const RADIUS_M = 1609.34; // a mile from campus
const SHOWN = 4;

const MODES = [
  { id: 'cheap', label: 'Cheap eats', empty: 'No $ places listed within a mile yet.', pick: (p) => p.price_level === 1 },
  { id: 'open', label: 'Open now', empty: 'Nothing with listed hours is open right now within a mile.', pick: (p) => openStatus(p.opening_hours)?.open === true },
  { id: 'late', label: 'Open late', empty: 'Nothing open past 1 am within a mile yet.', pick: (p) => p.open_late },
];

/**
 * Student budget picks: the cheapest places ($) and the ones open after the T stops running,
 * within a mile of the user's school. Uses the price and hours the places already have.
 */
export default function NearCampus({ school, onExplore, onExploreCampus }) {
  const [places, setPlaces] = useState(null);
  const [mode, setMode] = useState('cheap');

  useEffect(() => {
    if (!school) return undefined;
    let cancelled = false;
    getPlaces().then((list) => {
      if (cancelled) return;
      setPlaces(
        list
          .map((p) => ({ ...p, away: distanceM(school, p) }))
          .filter((p) => p.away <= RADIUS_M)
          .sort((a, b) => a.away - b.away),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [school?.id]);

  if (!school || !places) return null;
  const current = MODES.find((m) => m.id === mode);
  const shown = places.filter(current.pick).slice(0, SHOWN);

  return (
    <section className="card area-near" aria-label="Near campus">
      <div className="sec-head">
        <h2>Near campus</h2>
        <button className="sec-link" onClick={onExploreCampus}>Open map</button>
      </div>
      <div className="chip-row filter-row" role="tablist" aria-label="What to show">
        {MODES.map((m) => (
          <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'chip-btn on' : 'chip-btn'} onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="muted small">{current.empty}</p>
      ) : (
        <ul className="next-list">
          {shown.map((p) => (
            <li key={p.id}>
              <button onClick={() => onExplore({ type: 'place', id: p.id, center: [p.lng, p.lat] })}>
                <span className="next-ico"><Icon name={mode === 'late' ? 'bolt' : 'meal'} size={18} /></span>
                <span>
                  <b>{p.name}</b>
                  <small>
                    {cuisineLabel(p.cuisine)}
                    {p.price_level ? ` · ${'$'.repeat(p.price_level)}` : ''}
                    {p.open_late ? ' · open late' : ''}
                    {` · ${formatDistance(p.away)}`}
                  </small>
                </span>
                <Icon name="next" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
