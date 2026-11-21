import { useEffect, useMemo, useState } from 'react';
import { getNeighborhoodProgress, getPets } from '../../lib/api.js';
import { XpBar } from '../../components/ui.jsx';
import PetCard from './PetCard.jsx';
import BadgeGallery from './BadgeGallery.jsx';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'mine', label: 'With you' },
  { id: 'locked', label: 'Undiscovered' },
  { id: 'badges', label: 'Badges' },
];

/** Starter color when a pet has no neighborhood. */
export const STARTER_TINT = '#f7dd04';

/** pet id -> its neighborhood's map color */
export function tintsFor(hoods) {
  return Object.fromEntries(hoods.map((h) => [h.pet_id, h.color]));
}

/** The whole collection: the pets with you first, then the ones still out there. */
export default function PetsPage({ version, signedIn, onOpenPet }) {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPets(), getNeighborhoodProgress()]).then(([pets, hoods]) => {
      if (!cancelled) setData({ pets, tints: tintsFor(hoods) });
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data.pets].sort(
      (a, b) =>
        Number(b.unlocked) - Number(a.unlocked) ||
        Number(b.active) - Number(a.active) ||
        b.level - a.level ||
        b.xp - a.xp ||
        (a.neighborhood?.name ?? '').localeCompare(b.neighborhood?.name ?? ''),
    );
  }, [data]);

  if (!data) {
    return (
      <div className="page paper">
        <p className="page-inner muted">Loading…</p>
      </div>
    );
  }

  const mine = sorted.filter((p) => p.unlocked);
  const shown = filter === 'mine' ? mine : filter === 'locked' ? sorted.filter((p) => !p.unlocked) : sorted;
  return (
    <div className="page paper">
      <div className="page-inner rise">
        <header className="page-head">
          <div>
            <h1><span className="hl">My Pets</span></h1>
            <p className="muted">One pet lives in every neighborhood. Log a meal there and it joins you.</p>
          </div>
          <div className="count-card">
            <strong>{mine.length}<span> / {sorted.length}</span></strong>
            <XpBar percent={(100 * mine.length) / sorted.length} label="Pets discovered" />
            <small>pets discovered</small>
          </div>
        </header>

        {!signedIn && <p className="notice">Sign in (or load the demo data) to start collecting pets. Your starter is waiting.</p>}

        <div className="chip-row filter-row" role="tablist" aria-label="Filter pets">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              className={filter === f.id ? 'chip-btn on' : 'chip-btn'}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {filter === 'badges' ? (
          <BadgeGallery version={version} onOpenPet={onOpenPet} />
        ) : (
          <>
            <div className="pet-grid">
              {shown.map((pet) => (
                <PetCard key={pet.id} pet={pet} tint={data.tints[pet.id] ?? STARTER_TINT} onOpen={onOpenPet} />
              ))}
            </div>
            {shown.length === 0 && <p className="muted empty">Nothing here yet.</p>}
          </>
        )}
      </div>
    </div>
  );
}
