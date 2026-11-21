import { useEffect, useState } from 'react';
import { deleteDexEntry, getNeighborhoodProgress, getPetJournal, updateDexEntry } from '../../lib/api.js';
import { Icon, Stars, XpBar } from '../../components/ui.jsx';
import { formatFullDate, titleCase } from '../../lib/game.js';
import { shrinkPhoto } from '../../lib/image.js';

const SORTS = [
  { id: 'new', label: 'Newest first' },
  { id: 'old', label: 'Oldest first' },
  { id: 'rating', label: 'Top rated' },
  { id: 'name', label: 'A to Z' },
];

/** Does this journal entry match what the user typed? Looks at the place, cuisine, area, dish, and note. */
function matches(entry, query) {
  const hay = [entry.place.name, entry.place.cuisine, entry.place.neighborhood?.name, entry.favorite_dish, entry.note]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

/** One journal entry: read view, with an inline editor for the dish, rating, note, and photo. */
function DexEntryCard({ entry, onSaved, onShowOnMap }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [dish, setDish] = useState(entry.favorite_dish ?? '');
  const [rating, setRating] = useState(entry.my_rating ?? 0);
  const [note, setNote] = useState(entry.note ?? '');
  const [photo, setPhoto] = useState(undefined); // undefined = leave as is, File = replace, null = remove
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateDexEntry(entry.id, {
        favoriteDish: dish || null,
        myRating: rating || null,
        note: note || null,
        ...(photo !== undefined ? { photo: await shrinkPhoto(photo) } : null),
      });
      setEditing(false);
      setPhoto(undefined);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteDexEntry(entry.id);
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const { place } = entry;
  return (
    <li className="dex-entry">
      {entry.photo_url ? (
        <img className="dex-thumb" src={entry.photo_url} alt={`Your photo from ${place.name}`} />
      ) : (
        <span className="dex-thumb empty" aria-hidden="true"><Icon name="meal" size={26} /></span>
      )}
      <div className="dex-main">
        <div className="dex-top">
          <h3>{place.name}</h3>
          <span className={entry.fed ? 'gain' : 'gain none'}>{entry.fed ? `+${entry.xp_gained} XP` : 'No XP'}</span>
        </div>
        <p className="muted small">
          {titleCase(place.cuisine)}
          {place.price_level ? ` · ${'$'.repeat(place.price_level)}` : ''}
          {place.neighborhood ? ` · ${place.neighborhood.name}` : ''}
          {` · ${formatFullDate(entry.visited_at)}`}
        </p>

        {editing ? (
          <form className="dex-form" onSubmit={save}>
            <label>
              Favorite dish
              <input value={dish} onChange={(e) => setDish(e.target.value)} maxLength={80} placeholder="What did you get?" />
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
            <label>
              Note
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} rows={2} placeholder="Anything to remember?" />
            </label>
            <label className="file-row">
              Photo
              <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? undefined)} />
            </label>
            {entry.photo_url && photo === undefined && (
              <button type="button" className="link" onClick={() => setPhoto(null)}>Remove the current photo</button>
            )}
            {photo === null && <p className="muted small">The photo will be removed when you save.</p>}
            <div className="actions">
              <button className="btn btn-solid" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
            </div>
            {error && <p className="error">{error}</p>}
          </form>
        ) : (
          <>
            {entry.favorite_dish && <p className="dex-dish">{entry.favorite_dish}</p>}
            <Stars value={entry.my_rating} />
            {entry.note && <p className="dex-note">“{entry.note}”</p>}
            {confirmingDelete ? (
              <div className="confirm-row" role="alert">
                <span>Delete this entry? Its XP, and anything it unlocked, goes with it.</span>
                <button className="btn btn-small btn-danger" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Yes, delete'}</button>
                <button className="btn btn-small" disabled={busy} onClick={() => setConfirmingDelete(false)}>Keep it</button>
              </div>
            ) : (
              <div className="dex-actions">
                <button className="link-btn" onClick={() => setEditing(true)}><Icon name="pencil" size={14} />Edit</button>
                <button className="link-btn" onClick={() => onShowOnMap(place.id)}><Icon name="pin" size={14} />Show on map</button>
                <button className="link-btn danger" onClick={() => setConfirmingDelete(true)}><Icon name="close" size={13} />Delete</button>
              </div>
            )}
            {error && <p className="error">{error}</p>}
          </>
        )}
      </div>
    </li>
  );
}

/** My Dex: every restaurant you have logged, as a personal food journal. */
export default function DexPage({ version, signedIn, onChange, onExplore, onGo, onSignIn, onDemo }) {
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('new');

  useEffect(() => {
    let cancelled = false;
    // The starter eats everywhere, so its journal is the whole dex, already joined with each place.
    Promise.all([getPetJournal('starter'), getNeighborhoodProgress()]).then(([journal, hoods]) => {
      if (!cancelled) setData({ journal, hoods });
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!data) {
    return (
      <div className="page paper">
        <p className="page-inner muted">Loading…</p>
      </div>
    );
  }

  const { journal, hoods } = data;
  const { stats, entries } = journal;
  const found = new Set(entries.map((e) => e.place.id)).size;
  const areas = hoods.filter((h) => h.visited).length;

  const sorters = {
    new: (a, b) => b.visited_at.localeCompare(a.visited_at),
    old: (a, b) => a.visited_at.localeCompare(b.visited_at),
    rating: (a, b) => (b.my_rating ?? 0) - (a.my_rating ?? 0) || b.visited_at.localeCompare(a.visited_at),
    name: (a, b) => a.place.name.localeCompare(b.place.name),
  };
  const shown = entries.filter((e) => matches(e, query)).sort(sorters[sort]);

  return (
    <div className="page paper">
      <div className="page-inner rise">
        <header className="page-head">
          <div>
            <h1><span className="hl">My Dex</span></h1>
            <p className="muted">Your food journal: every place you have tried, with your dishes, ratings, and notes.</p>
          </div>
          <div className="count-card">
            <strong>{found}<span> {found === 1 ? 'restaurant' : 'restaurants'}</span></strong>
            <XpBar percent={hoods.length ? (100 * areas) / hoods.length : 0} label="Neighborhoods explored" />
            <small>across {areas} of {hoods.length} neighborhoods</small>
          </div>
        </header>

        {!signedIn && (
          <div className="notice with-actions">
            <span>{onDemo ? 'Sign in (or load the demo data) to start your dex.' : 'Sign in to start your dex.'}</span>
            <span className="overview-actions">
              <button className="btn btn-small btn-solid" onClick={onSignIn}>Sign in with Google</button>
              {onDemo && <button className="btn btn-small" onClick={onDemo}>Try demo data</button>}
            </span>
          </div>
        )}

        {entries.length > 0 && (
          <div className="stat-chips dex-stats">
            <span className="stat-chip"><b>{stats.meals}</b> meals</span>
            <span className="stat-chip"><b>{stats.photos}</b> photos</span>
            {stats.average_rating != null && <span className="stat-chip"><b>{stats.average_rating}</b> average rating</span>}
            {stats.top_cuisines.map((c) => (
              <span key={c.cuisine} className="stat-chip"><b>{titleCase(c.cuisine)}</b> × {c.count}</span>
            ))}
          </div>
        )}

        {signedIn && entries.length === 0 && (
          <div className="empty-card">
            <p>Your dex is empty. Find somewhere to eat and add it.</p>
            <button className="btn btn-solid" onClick={() => onGo('explore')}>Open the Explore map</button>
          </div>
        )}

        {entries.length > 1 && (
          <div className="dex-tools">
            <label className="dex-search">
              <Icon name="explore" size={16} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your dex: place, dish, cuisine, area"
                aria-label="Search your dex"
              />
            </label>
            <label className="dex-sort">
              <span className="sr-only">Sort by</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          </div>
        )}
        {query && shown.length === 0 && <p className="muted empty">Nothing in your dex matches “{query}”.</p>}

        <ul className="dex-list">
          {shown.map((entry) => (
            <DexEntryCard
              key={entry.id}
              entry={entry}
              onSaved={onChange}
              onShowOnMap={(id) => onExplore({ type: 'place', id })}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
