import { Icon, LevelPill, PetArt, XpBar } from '../../components/ui.jsx';
import { petProgress } from '../../lib/game.js';

/** Where a pet comes from, in a few words. */
export const homeOf = (pet) => (pet.is_starter ? 'Your starter' : pet.neighborhood?.name ?? '');

/**
 * A compact, tappable pet card: art first, then name, species, level, and XP.
 * A locked pet is a mystery silhouette that only says where to find it.
 */
export default function PetCard({ pet, tint, onOpen }) {
  if (!pet.unlocked) {
    return (
      <button className="pet-card locked" onClick={() => onOpen(pet.id)} aria-label={`Undiscovered pet in ${pet.neighborhood?.name}`}>
        <PetArt pet={pet} tint="#d9d9d9" locked />
        <span className="pet-card-top">
          <span className="pet-name">???</span>
          <Icon name="lock" size={15} />
        </span>
        <span className="where"><Icon name="pin" size={13} />{pet.neighborhood?.name}</span>
      </button>
    );
  }

  const progress = petProgress(pet);
  return (
    <button className="pet-card" style={{ '--tint': tint }} onClick={() => onOpen(pet.id)}>
      {pet.active && <span className="buddy-dot" title="Your buddy">Buddy</span>}
      <PetArt pet={pet} tint={tint} />
      <span className="pet-card-top">
        <span className="pet-name">{pet.display_name}</span>
        <LevelPill level={pet.level} max={pet.max_level} />
      </span>
      {pet.nickname && <span className="pet-species">{pet.name}</span>}
      <XpBar percent={progress.percent} label={`${pet.display_name} XP`} />
      <span className="pet-xp">{progress.label}</span>
      <span className="where"><Icon name="pin" size={13} />{homeOf(pet)}</span>
    </button>
  );
}
