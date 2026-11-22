import { useEffect, useState } from 'react';
import { getBadges, getPets } from '../../lib/api.js';
import { Icon, XpBar } from '../../components/ui.jsx';

/** Badge categories, in the order they are shown. */
const GROUPS = [
  ['visits', 'Visits'],
  ['places', 'Where you have been'],
  ['time', 'When you eat'],
  ['journal', 'Food journal'],
  ['variety', 'Variety'],
  ['transit', 'On the T'],
  ['neighborhood', 'Neighborhoods'],
];

const closeness = (b) => (b.next_target ? b.value / b.next_target : 1);

/** Who wears a badge, without spoiling a pet the user has not met yet. */
function wearerLabel(pet) {
  if (!pet) return null;
  if (pet.unlocked) return pet.display_name;
  return `the pet in ${pet.neighborhood?.name}`;
}

/** Every badge in one place, grouped, with progress. Earned badges come first in each group. */
export default function BadgeGallery({ version, onOpenPet }) {
  const [data, setData] = useState(null);
  const [earnedOnly, setEarnedOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getBadges(), getPets()]).then(([badges, pets]) => {
      if (!cancelled) setData({ badges, pets: Object.fromEntries(pets.map((p) => [p.id, p])) });
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!data) return <p className="muted">Loading…</p>;
  const { badges, pets } = data;
  const earned = badges.filter((b) => b.earned).length;

  return (
    <div className="badge-gallery">
      <div className="gallery-head">
        <p><b>{earned}</b> of {badges.length} badges earned</p>
        <label className="switch-row">
          <input type="checkbox" checked={earnedOnly} onChange={(e) => setEarnedOnly(e.target.checked)} />
          <span>Earned only</span>
        </label>
      </div>
      <p className="muted small gallery-note">
        Badges are worn by your pets. Meals past the daily feeding limit still count toward most badges.
      </p>

      {GROUPS.map(([id, label]) => {
        const all = badges.filter((b) => b.category === id);
        const list = all
          .filter((b) => !earnedOnly || b.earned)
          .sort((a, b) => Number(b.earned) - Number(a.earned) || closeness(b) - closeness(a) || a.name.localeCompare(b.name));
        if (!list.length) return null;
        return (
          <section className="card" key={id}>
            <div className="sec-head">
              <h2 className="card-title">{label}</h2>
              <span className="muted small">{all.filter((b) => b.earned).length} of {all.length}</span>
            </div>
            <ul className="badge-list wide">
              {list.map((b) => {
                const wearer = pets[b.pet_id];
                const target = b.next_target ?? b.tiers[b.tiers.length - 1];
                return (
                  <li key={b.id} className={b.earned ? 'badge earned' : 'badge'}>
                    <span className="badge-ico"><Icon name={b.earned ? 'medal' : 'lock'} size={16} /></span>
                    <div>
                      <p>
                        {b.name}
                        {b.earned && <em>{b.tier_labels[b.tier - 1]}</em>}
                      </p>
                      <small>{b.description}</small>
                      {b.tiers.length > 1 && (
                        <small className="tiers">
                          {b.tiers.map((t, i) => `${b.tier_labels[i]} ${t}`).join(' · ')}
                        </small>
                      )}
                      {b.next_target != null && (
                        <div className="badge-progress">
                          <XpBar percent={(100 * b.value) / target} label={`${b.name} progress`} />
                          <span>{Math.min(b.value, target)} / {target}</span>
                        </div>
                      )}
                      {wearer && (
                        <button className="wearer" onClick={() => onOpenPet(wearer.id)}>
                          {b.earned ? 'Worn by' : 'Will be worn by'} {wearerLabel(wearer)}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
