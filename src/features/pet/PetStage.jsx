import { useEffect, useRef, useState } from 'react';
import { Cloud } from '../../components/Doodles.jsx';

const HOP_MS = 620;
const HEART_MS = 1100;

/**
 * The companion's little world: sky in its neighborhood's color, rolling hills, a skyline, and a
 * subway line with a tiny train going by. The pet stands in it, breathes, and reacts when tapped:
 * it hops, a few hearts float up, and it says its next line.
 *
 * @param {Object} props
 * @param {import('../../lib/api.js').Pet} props.pet
 * @param {string}   props.tint      the pet's neighborhood color
 * @param {string[]} [props.lines]   things the pet says; the first shows at once, taps cycle through the rest
 * @param {'home'|'profile'} [props.size]
 * @param {boolean}  [props.locked]  show a mystery silhouette that does not react
 * @param {'happy'|'eager'|'full'} [props.mood]  changes the idle motion
 */
export default function PetStage({ pet, tint, lines = [], size = 'home', locked = false, mood = 'happy', children }) {
  const [line, setLine] = useState(0);
  const [hop, setHop] = useState(0); // counts taps: a new number restarts the hop animation
  const [hearts, setHearts] = useState([]);
  const timers = useRef([]);
  const nextId = useRef(0);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  // A different pet (or new things to say) starts from its first line.
  useEffect(() => setLine(0), [pet.id, lines.join('|')]);

  const react = () => {
    if (locked) return;
    setHop((n) => n + 1);
    if (lines.length > 1) setLine((i) => (i + 1) % lines.length);
    const burst = [0, 1, 2].map((k) => ({
      id: nextId.current++,
      x: (k - 1) * 26 + (Math.random() * 16 - 8),
      delay: k * 90,
      tilt: Math.random() * 30 - 15,
    }));
    setHearts((h) => [...h, ...burst]);
    timers.current.push(
      setTimeout(() => setHearts((h) => h.filter((x) => !burst.includes(x))), HEART_MS + 300),
    );
  };

  const say = lines[line];

  return (
    <div className={`stage stage-${size}${locked ? ' is-locked' : ''}`} style={{ '--tint': locked ? '#cfd3d8' : tint }}>
      <div className="stage-sky" aria-hidden="true">
        <span className="stage-sun" />
        <Cloud className="stage-cloud c1" />
        <Cloud className="stage-cloud c2" />
      </div>

      {/* A few rooftops on the horizon, then two hills */}
      <svg className="stage-land" viewBox="0 0 400 140" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <g className="stage-skyline">
          <rect x="34" y="44" width="18" height="60" rx="2" />
          <rect x="56" y="58" width="26" height="46" rx="2" />
          <rect x="88" y="30" width="14" height="74" rx="2" />
          <rect x="298" y="52" width="22" height="52" rx="2" />
          <rect x="324" y="36" width="16" height="68" rx="2" />
          <rect x="344" y="62" width="28" height="42" rx="2" />
        </g>
        <path className="stage-hill far" d="M0 92 C70 58 150 70 210 84 S340 66 400 86 V140 H0Z" />
        <path className="stage-hill near" d="M0 112 C90 84 170 104 250 100 S350 92 400 106 V140 H0Z" />
      </svg>

      {/* The T runs along the bottom of every scene */}
      <div className="stage-track" aria-hidden="true">
        <span className="stage-train"><i /><i /><i /></span>
      </div>

      {say && !locked && (
        <p className="bubble" key={`${pet.id}-${line}`} aria-live="polite">{say}</p>
      )}
      {locked && <p className="bubble quiet">…?</p>}

      <button
        type="button"
        className={`stage-pet mood-${mood}`}
        onClick={react}
        disabled={locked}
        aria-label={locked ? 'An undiscovered pet' : `Say hi to ${pet.display_name}`}
      >
        <span className="stage-shadow" />
        <span className="stage-body" key={hop} data-hop={hop > 0 ? 'yes' : undefined} style={{ '--hop-ms': `${HOP_MS}ms` }}>
          <img src={pet.image} alt="" draggable="false" className={locked ? 'locked' : undefined} />
        </span>
        {hearts.map((h) => (
          <svg
            key={h.id}
            className="heart"
            viewBox="0 0 24 24"
            style={{ '--x': `${h.x}px`, '--tilt': `${h.tilt}deg`, animationDelay: `${h.delay}ms`, animationDuration: `${HEART_MS}ms` }}
            aria-hidden="true"
          >
            <path d="M12 20.5C5 15.5 2.5 11.8 2.5 8.4A4.4 4.4 0 0 1 12 6.6a4.4 4.4 0 0 1 9.5 1.8c0 3.4-2.5 7.1-9.5 12.1z" />
          </svg>
        ))}
      </button>

      {children}
    </div>
  );
}
