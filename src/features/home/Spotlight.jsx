import { useEffect, useState } from 'react';
import { getDex, getNeighborhoodProgress, getPlace, getPlaces, getStamps } from '../../lib/api.js';
import { Icon } from '../../components/ui.jsx';
import { titleCase } from '../../lib/game.js';
import { pickSpotlight } from '../../lib/spotlight.js';

/**
 * Local spotlight: three small, local places the user has not tried yet, each with the reasons it
 * was picked. The picks change daily. How places are scored is in src/lib/spotlight.js.
 */
export default function Spotlight({ version, onExplore }) {
  const [picks, setPicks] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [places, dex, hoods, stamps] = await Promise.all([getPlaces(), getDex(), getNeighborhoodProgress(), getStamps()]);
      const chosen = await pickSpotlight({ places, dex, hoods, stamps, getPlace });
      if (!cancelled) setPicks(chosen);
    })().catch(() => !cancelled && setPicks([]));
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!picks || picks.length === 0) return null;

  return (
    <section className="card area-spotlight" aria-label="Local spotlight">
      <div className="sec-head">
        <h2>Local spotlight</h2>
        <span className="muted small">Small places, new picks daily</span>
      </div>
      <ul className="spot-list">
        {picks.map((p) => (
          <li key={p.id}>
            <button onClick={() => onExplore({ type: 'place', id: p.id, center: [p.lng, p.lat] })}>
              <span className="spot-main">
                <b>{p.name}</b>
                <small>
                  {titleCase(p.cuisine)}
                  {p.price_level ? ` · ${'$'.repeat(p.price_level)}` : ''}
                  {p.neighborhood ? ` · ${p.neighborhood.name}` : ''}
                  {p.details?.rating != null ? ` · ★ ${p.details.rating.toFixed(1)}` : ''}
                </small>
                <span className="spot-why">
                  {p.reasons.slice(0, 3).map((r) => <i key={r}>{r}</i>)}
                </span>
              </span>
              <Icon name="next" size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
