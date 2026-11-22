/** Little hand-drawn decorations in the spirit of a marker-drawn subway map. */

export function Cloud({ className }) {
  return (
    <svg className={className} viewBox="0 0 170 100" fill="none" aria-hidden="true" focusable="false">
      <path
        d="M34 76C14 76 6 58 18 46c8-8 20-6 26 1C46 28 66 16 86 22c12 4 18 12 20 22 14-6 32 0 34 16 2 14-10 20-26 18"
        stroke="#2f9dd9"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M52 62c6-6 14-4 16 2-4-1-9 0-12 4" stroke="#2f9dd9" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Sparkle({ className }) {
  const star = 'M22 2C24 18 30 24 46 26C30 28 24 34 22 50C20 34 14 28 -2 26C14 24 20 18 22 2Z';
  return (
    <svg className={className} viewBox="-6 -2 60 60" aria-hidden="true" focusable="false">
      <path d={star} fill="#111" transform="translate(4 4)" />
      <path d={star} style={{ fill: 'var(--accent, #a9d7f7)' }} stroke="#111" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

/** Two subway lines crossing at a station, like the corner of a transit map. */
export function LineCross({ className }) {
  return (
    <svg className={className} viewBox="0 0 260 170" fill="none" aria-hidden="true" focusable="false">
      <path d="M-10 168C90 168 110 120 140 92S214 20 270 8" stroke="#ce2634" strokeWidth="22" strokeLinecap="round" />
      <path d="M-10 8C80 14 108 60 136 92S200 156 270 162" stroke="#206ddf" strokeWidth="22" strokeLinecap="round" />
      <circle cx="68" cy="150" r="5.5" fill="#fff" />
      <circle cx="214" cy="38" r="5.5" fill="#fff" />
      <circle cx="58" cy="36" r="5.5" fill="#fff" />
      <circle cx="212" cy="140" r="5.5" fill="#fff" />
      <circle cx="138" cy="92" r="15" fill="#fff" stroke="#111" strokeWidth="6" />
    </svg>
  );
}
