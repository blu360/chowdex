import { useState } from 'react';

/**
 * The pet's hero panel: the drawing on a flat block of its neighborhood color, with its level
 * as a big numeral behind it. The pet breathes slightly and does a small hop when tapped.
 *
 * @param {Object} props
 * @param {import('../../lib/api.js').Pet} props.pet
 * @param {string}  props.tint     the pet's neighborhood color
 * @param {'home'|'profile'} [props.size]
 * @param {boolean} [props.locked] show a silhouette that does not react
 */
export default function PetStage({ pet, tint, size = 'home', locked = false, children }) {
  const [hop, setHop] = useState(0); // counts taps: a new number restarts the hop animation

  return (
    <div className={`stage stage-${size}${locked ? ' is-locked' : ''}`} style={{ '--tint': locked ? '#c9cdd2' : tint }}>
      <span className="stage-level" aria-hidden="true">
        <small>LV</small>
        {locked ? '?' : pet.level}
      </span>
      <button
        type="button"
        className="stage-pet"
        onClick={() => !locked && setHop((n) => n + 1)}
        disabled={locked}
        aria-label={locked ? 'An undiscovered pet' : pet.display_name}
      >
        <span className="stage-shadow" />
        <span className="stage-body" key={hop} data-hop={hop > 0 ? 'yes' : undefined}>
          <img src={pet.image} alt="" draggable="false" className={locked ? 'locked' : undefined} />
        </span>
      </button>
      {children}
    </div>
  );
}
