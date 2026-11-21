import { useEffect, useState } from 'react';
import { getPets } from '../lib/api.js';
import { Icon, PetArt } from './ui.jsx';

const SHOW_MS = 7000;

/**
 * A short celebration after a meal is logged: XP earned, a new pet, level-ups, badges, and stamps.
 * Everything shown comes from what addToDex() returned.
 * @param {{reward: {entry: import('../lib/api.js').DexEntry, stations: string[]}, onClose: () => void, onOpenPet: (id: string) => void}} props
 */
export default function RewardToast({ reward, onClose, onOpenPet }) {
  const { entry, stations = [] } = reward;
  const [pets, setPets] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getPets().then((list) => !cancelled && setPets(Object.fromEntries(list.map((p) => [p.id, p]))));
    const timer = setTimeout(onClose, SHOW_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [entry.id]);

  const newPet = entry.unlocked_pet;
  const levelUps = entry.level_ups ?? [];
  const badges = entry.new_badges ?? [];

  return (
    <div className={newPet ? 'reward big' : 'reward'} role="status">
      <button className="reward-close" onClick={onClose} aria-label="Dismiss"><Icon name="close" size={14} /></button>
      {newPet && (
        <button className="reward-pet" onClick={() => { onOpenPet(newPet.id); onClose(); }}>
          <span className="confetti" aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>
          <PetArt pet={newPet} tint="var(--accent)" />
          <span>
            <b>New pet: {newPet.name}!</b>
            <small>It joined you in {newPet.neighborhood?.name}. Tap to say hi.</small>
          </span>
        </button>
      )}
      <p className="reward-xp">
        {entry.fed ? (
          <><span className="gain pop">+{entry.xp_gained} XP</span> Added to your dex</>
        ) : (
          <>Added to your dex. Your pets are full for today, so no XP this time.</>
        )}
      </p>
      <ul className="reward-list">
        {levelUps.map((l) => (
          <li key={l.pet_id}><Icon name="bolt" size={15} />{pets?.[l.pet_id]?.display_name ?? 'A pet'} reached level {l.to}</li>
        ))}
        {badges.map((b) => (
          <li key={`${b.badge_id}-${b.tier}`}><Icon name="medal" size={15} />{b.name}{b.tier_label !== 'Earned' ? ` (${b.tier_label})` : ''}</li>
        ))}
        {stations.length > 0 && (
          <li><Icon name="stamps" size={15} />Stamped {stations.join(', ')}</li>
        )}
      </ul>
    </div>
  );
}
