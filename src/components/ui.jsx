/** Small shared pieces: icons, XP bars, pet art, level pills. */
import { PET_LEVEL_XP } from '../lib/api.js';

const ICONS = {
  home: <path d="M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10M10 19.5v-5h4v5" />,
  explore: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.6 8.4 13.6 13.6 8.4 15.6 10.4 10.4Z" />
    </>
  ),
  stamps: <path d="M8.5 3.5h7v5.5l2.5 4h-12l2.5-4zM5 16h14v4H5z" />,
  dex: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11M9 8h6" />,
  pets: (
    <>
      <circle cx="6.5" cy="10.5" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="10" cy="6.5" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="14" cy="6.5" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="10.5" r="1.7" fill="currentColor" stroke="none" />
      <path d="M7.5 17c0-2.6 2.2-4.8 4.5-4.8s4.5 2.2 4.5 4.8c0 1.7-1.4 2.5-2.8 2.1-1.1-.3-2.3-.3-3.4 0-1.4.4-2.8-.4-2.8-2.1z" fill="currentColor" stroke="none" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  next: <path d="M9 5l7 7-7 7" />,
  pencil: <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />,
  pin: (
    <>
      <path d="M12 21s-6-5.5-6-10a6 6 0 1 1 12 0c0 4.5-6 10-6 10z" />
      <circle cx="12" cy="11" r="2" />
    </>
  ),
  bolt: <path d="M13 3 5 13h6l-1 8 8-10h-6z" />,
  lock: (
    <>
      <rect x="6" y="11" width="12" height="9" rx="2" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />,
  meal: <path d="M4 11h16a8 8 0 0 1-16 0zM9 20.5h6M9 7.5c0-1.5 1-1.5 1-3M13 7.5c0-1.5 1-1.5 1-3" />,
  medal: (
    <>
      <circle cx="12" cy="15" r="5" />
      <path d="M9.5 10.5 7.5 3.5h9l-2 7" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l1.5-2.5h7L17 8h3v11H4z" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

export function Icon({ name, size = 20 }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

/** An ink-outlined progress bar that fills when it appears. `color` defaults to the accent color. */
export function XpBar({ percent, color, label }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div
      className={p >= 100 ? 'xp full' : 'xp'}
      role="progressbar"
      aria-valuenow={p}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      style={{ '--w': `${p}%`, ...(color ? { '--fill': color } : null) }}
    >
      <i />
    </div>
  );
}

export function LevelPill({ level, max }) {
  return <span className="lv-pill">{max != null && level >= max ? 'Lv MAX' : `Lv ${level}`}</span>;
}

/** The pet's drawing on a soft blob of its neighborhood color. Locked pets show as a silhouette. */
export function PetArt({ pet, tint, locked = false, className = '' }) {
  return (
    <span className={`pet-art ${className}`} style={tint ? { '--tint': tint } : undefined}>
      <img src={pet.image} alt="" loading="lazy" className={locked ? 'locked' : undefined} draggable="false" />
    </span>
  );
}

/** A pet's five levels drawn as stops on a subway line, like the station stamp progress. */
export function LevelTrack({ pet, color }) {
  // Stops sit in the middle of five equal columns; the line runs to the current stop plus the way to the next.
  const step = 100 / pet.max_level;
  const prev = pet.level > 0 ? PET_LEVEL_XP[pet.level - 1] : 0;
  const toNext = pet.next_level_xp ? (pet.xp - prev) / (pet.next_level_xp - prev) : 0;
  const percent =
    pet.level >= pet.max_level ? 100 : pet.level === 0 ? (toNext * step) / 2 : (pet.level - 0.5) * step + toNext * step;
  return (
    <div className="level-track" style={color ? { '--fill': color } : undefined} aria-label={`Level ${pet.level} of ${pet.max_level}`}>
      <div className="level-track-line">
        <i style={{ width: `${percent}%` }} />
      </div>
      <ol>
        {PET_LEVEL_XP.map((xp, i) => (
          <li key={xp} className={pet.level > i ? 'reached' : undefined}>
            <b>{i + 1}</b>
            <span>{xp} XP</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Stars({ value }) {
  if (!value) return null;
  return (
    <span className="stars-read" aria-label={`${value} out of 5 stars`}>
      {'★'.repeat(value)}
      <i>{'★'.repeat(5 - value)}</i>
    </span>
  );
}

/** Colored dots for T lines. */
export function LineDots({ lines, colors }) {
  return (
    <span className="line-dots">
      {lines.map((l) => (
        <b key={l} style={{ background: colors[l] }} title={`${l} Line`} />
      ))}
    </span>
  );
}

/**
 * A circular progress ring with something in the middle (a number, an icon, a pet).
 * The ring draws itself in when it appears.
 */
export function Ring({ percent, size = 56, stroke = 6, color, children, label }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <span className="ring" style={{ width: size, height: size, ...(color ? { '--fill': color } : null) }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} />
        <circle
          className="ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeDasharray={c}
          style={{ '--c': c, strokeDashoffset: c * (1 - p / 100) }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-inner">{children}</span>
    </span>
  );
}
