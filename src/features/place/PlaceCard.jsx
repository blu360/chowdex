import { useEffect, useState } from 'react';
import { getPlace, getDex, addToDex, getStamps, getStations } from '../../lib/api.js';
import { LINE_COLORS } from '../../lib/lines.js';

export function LineChips({ lines }) {
  return (
    <span className="chips">
      {lines.map((l) => (
        <span key={l} className="chip" style={{ background: LINE_COLORS[l] }}>{l}</span>
      ))}
    </span>
  );
}

export default function PlaceCard({ placeId, signedIn, onClose, onDexChange, onSignIn }) {
  const [place, setPlace] = useState(null);
  const [status, setStatus] = useState('loading');
  const [collected, setCollected] = useState(false);
  const [dish, setDish] = useState('');
  const [rating, setRating] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setMessage(null);
    setDish('');
    setRating(0);
    Promise.all([getPlace(placeId), getDex()])
      .then(([p, dex]) => {
        if (cancelled) return;
        setPlace(p);
        setCollected(dex.some((e) => e.place_id === placeId));
        setStatus('ready');
      })
      .catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
    };
  }, [placeId, signedIn]);

  async function handleAdd(e) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const before = await getStamps();
      const entry = await addToDex(placeId, { favoriteDish: dish || null, myRating: rating || null });
      const [after, stations] = await Promise.all([getStamps(), getStations()]);
      const fresh = Object.keys(after.by_station).filter((id) => !before.by_station[id]);
      const names = fresh.map((id) => stations.find((s) => s.id === id)?.name).filter(Boolean);
      setCollected(true);
      setMessage({
        kind: 'success',
        text:
          'Added to your dex!' +
          (entry.unlocked_pet ? ` New pet unlocked: ${entry.unlocked_pet.name}!` : '') +
          (names.length ? ` New station stamps: ${names.join(', ')}` : ''),
      });
      onDexChange();
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="panel" aria-label="Place details">
      <button className="panel-close" onClick={onClose} aria-label="Close">×</button>
      {status === 'loading' && <p className="muted">Loading…</p>}
      {status === 'error' && <p className="error">Could not load this place.</p>}
      {status === 'ready' && place && (
        <>
          <h2>{place.name}</h2>
          <p className="muted">
            {place.cuisine.replace('_', ' ')}
            {place.price_level ? ` · ${'$'.repeat(place.price_level)}` : ''}
            {place.open_late ? ' · open late' : ''}
          </p>

          <div className="rating">
            {place.details?.rating != null ? (
              <>
                <strong>★ {place.details.rating.toFixed(1)}</strong>
                <span className="muted"> ({place.details.rating_count} ratings)</span>
              </>
            ) : (
              <span className="muted">No ratings yet</span>
            )}
          </div>

          <dl className="facts">
            <dt>Hours</dt>
            <dd>{place.opening_hours ?? 'Not listed'}</dd>
            <dt>Nearest T</dt>
            <dd>
              {place.nearest_stop.name} <LineChips lines={place.nearest_stop.lines} />
              <span className="muted"> · {place.nearest_stop.distance_m} m</span>
            </dd>
          </dl>

          <div className="actions">
            <a
              className="btn"
              target="_blank"
              rel="noreferrer"
              href={`https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}&travelmode=transit`}
            >
              Directions by T
            </a>
            {place.website && (
              <a className="btn btn-ghost" target="_blank" rel="noreferrer" href={place.website}>
                Website
              </a>
            )}
          </div>

          <hr />
          {collected ? (
            <p className="collected">✓ In your dex</p>
          ) : signedIn ? (
            <form onSubmit={handleAdd} className="dex-form">
              <label>
                Favorite dish
                <input value={dish} onChange={(e) => setDish(e.target.value)} placeholder="What did you get?" />
              </label>
              <div className="stars" role="radiogroup" aria-label="Your rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    className={n <= rating ? 'star on' : 'star'}
                    onClick={() => setRating(n === rating ? 0 : n)}
                    aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <button className="btn btn-primary" disabled={busy}>
                {busy ? 'Adding…' : 'Add to my dex'}
              </button>
            </form>
          ) : (
            <button className="btn btn-primary" onClick={onSignIn}>Sign in to add to your dex</button>
          )}
          {message && <p className={message.kind === 'error' ? 'error' : 'success'}>{message.text}</p>}
        </>
      )}
    </aside>
  );
}
