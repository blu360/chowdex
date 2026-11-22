import { useId } from 'react';

/** The trains used by the page transition. Colors are the official MBTA line colors. */
export const TRAINS = {
  green: { color: '#0c6b14', name: 'Green Line' },
  red: { color: '#ce2634', name: 'Red Line' },
  orange: { color: '#ed8b00', name: 'Orange Line' },
  blue: { color: '#206ddf', name: 'Blue Line' },
};

const CAR_LENGTH = 300;
const CAR_TOP = 30;
const CAR_BOTTOM = 120;
const BELT_Y = 76; // where the white upper body meets the colored lower body

/** Outline of one car starting at x0. The lead car has a sloped nose on its right end. */
function carPath(x0, lead) {
  const right = lead
    ? `H${x0 + 250}Q${x0 + 282} ${CAR_TOP + 2} ${x0 + 297} ${CAR_TOP + 24}L${x0 + 306} 104Q${x0 + 309} ${CAR_BOTTOM} ${x0 + 292} ${CAR_BOTTOM}`
    : `H${x0 + 290}Q${x0 + CAR_LENGTH} ${CAR_TOP} ${x0 + CAR_LENGTH} ${CAR_TOP + 10}V${CAR_BOTTOM - 8}Q${x0 + CAR_LENGTH} ${CAR_BOTTOM} ${x0 + 290} ${CAR_BOTTOM}`;
  return `M${x0 + 10} ${CAR_TOP}${right}H${x0 + 10}Q${x0} ${CAR_BOTTOM} ${x0} ${CAR_BOTTOM - 8}V${CAR_TOP + 10}Q${x0} ${CAR_TOP} ${x0 + 10} ${CAR_TOP}Z`;
}

function RoofBox({ x, w, h = 14 }) {
  const lines = [];
  for (let lx = x + 5; lx < x + w - 2; lx += 5) lines.push(lx);
  return (
    <g>
      <rect x={x} y={CAR_TOP - h} width={w} height={h + 2} rx="2.5" fill="#d3d3d3" stroke="#111" strokeWidth="3" />
      {lines.map((lx) => (
        <path key={lx} d={`M${lx} ${CAR_TOP - h + 4}V${CAR_TOP - 3}`} stroke="#111" strokeWidth="1" opacity="0.35" />
      ))}
    </g>
  );
}

function TLogo({ x, y }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="13.5" fill="#fff" stroke="#111" strokeWidth="2.5" />
      <path d="M-7 -5.5H7M0 -5.5V8" stroke="#111" strokeWidth="4.6" strokeLinecap="round" />
    </g>
  );
}

function Wheel({ x }) {
  return (
    <g transform={`translate(${x} 134)`}>
      <g className="wheel">
        <circle r="12" fill="#111" />
        <circle r="4.6" fill="#fff" />
        <path d="M-4.6 0H4.6M0 -4.6V4.6" stroke="#111" strokeWidth="1.8" />
      </g>
    </g>
  );
}

/** Sliding double doors with the black slits seen on MBTA cars. */
function Doors({ x }) {
  const slits = [0, 1, 2, 3];
  return (
    <g>
      <rect x={x} y="38" width="38" height="82" rx="3" fill="none" stroke="#111" strokeWidth="2.5" />
      {slits.map((i) => (
        <g key={i} fill="#111">
          <rect x={x + 5 + i * 8} y="44" width="3.6" height="22" rx="1.8" />
          <rect x={x + 5 + i * 8} y="86" width="3.6" height="22" rx="1.8" />
        </g>
      ))}
      <path d={`M${x + 13} 42V118M${x + 25} 42V118`} stroke="#111" strokeWidth="2" strokeLinecap="round" />
    </g>
  );
}

function Car({ id, x0, lead, color }) {
  const path = carPath(x0, lead);
  const clip = `${id}-${x0}`;

  return (
    <g>
      <clipPath id={clip}>
        <path d={path} />
      </clipPath>

      {/* Black accordion end on the left, like the reference car */}
      <g>
        <rect x={x0 - 13} y={CAR_TOP + 4} width="15" height={CAR_BOTTOM - CAR_TOP - 6} rx="3" fill="#111" />
        {[44, 54, 64, 74, 84, 94, 104].map((y) => (
          <path key={y} d={`M${x0 - 11} ${y}H${x0}`} stroke="#fff" strokeWidth="1" opacity="0.28" />
        ))}
      </g>

      <RoofBox x={x0 + 66} w={32} />
      <RoofBox x={x0 + 106} w={42} />
      <RoofBox x={x0 + 188} w={64} h={18} />

      {/* White upper body, colored lower body, gray belt line */}
      <path d={path} fill="#f6f6f6" />
      <g clipPath={`url(#${clip})`}>
        <rect x={x0 - 2} y={BELT_Y + 4} width={CAR_LENGTH + 14} height="50" fill={color} />
        <rect x={x0 - 2} y={BELT_Y - 2} width={CAR_LENGTH + 14} height="6" fill="#c4c4c4" />
        <path d={`M${x0 - 2} ${BELT_Y + 4}H${x0 + CAR_LENGTH + 12}`} stroke="#111" strokeWidth="2" />
        <path d={`M${x0 - 2} ${BELT_Y - 2}H${x0 + CAR_LENGTH + 12}`} stroke="#111" strokeWidth="1.5" />
      </g>

      {/* Windows: big gray panes with black frames */}
      <g fill="#b3b9bf" stroke="#111" strokeWidth="2.8">
        <rect x={x0 + 16} y="40" width="32" height="30" rx="3" />
        <rect x={x0 + 98} y="40" width="34" height="30" rx="3" />
        <rect x={x0 + 137} y="40" width="34" height="30" rx="3" />
        <rect x={x0 + 176} y="40" width="34" height="30" rx="3" />
      </g>

      <Doors x={x0 + 52} />
      <Doors x={x0 + 214} />

      {/* Small vent and the round T logo on the colored panel */}
      <g>
        <rect x={x0 + 130} y="92" width="14" height="16" rx="2" fill="#fff" opacity="0.3" stroke="#111" strokeWidth="1.8" />
        {[96, 100, 104].map((y) => (
          <path key={y} d={`M${x0 + 132} ${y}H${x0 + 142}`} stroke="#111" strokeWidth="1.2" />
        ))}
      </g>
      <TLogo x={x0 + 170} y={98} />

      {/* Skirt panels */}
      <g fill="none" stroke="#111" strokeWidth="2.5">
        <rect x={x0 + 22} y="108" width="22" height="12" rx="3" />
        <rect x={x0 + 100} y="108" width="62" height="12" rx="3" />
        <rect x={x0 + 188} y="108" width="22" height="12" rx="3" />
      </g>

      {lead && (
        <g>
          <path d={`M${x0 + 262} 44L${x0 + 286} 47Q${x0 + 294} 54 ${x0 + 299} 76L${x0 + 262} 76Z`} fill="#9aa6b2" stroke="#111" strokeWidth="2.8" strokeLinejoin="round" />
          <rect x={x0 + 252} y="46" width="6" height="26" rx="3" fill="#b3b9bf" stroke="#111" strokeWidth="2.2" />
          <circle cx={x0 + 300} cy="94" r="4.5" fill="#ce2634" stroke="#111" strokeWidth="2" />
        </g>
      )}

      <path d={path} fill="none" stroke="#111" strokeWidth="4.5" strokeLinejoin="round" />

      {/* Trucks and wheels */}
      <g fill="#111">
        <rect x={x0 + 14} y="120" width="48" height="8" rx="3" />
        <rect x={x0 + 134} y="120" width="98" height="8" rx="3" />
      </g>
      <Wheel x={x0 + 38} />
      <Wheel x={x0 + 154} />
      <Wheel x={x0 + 214} />
    </g>
  );
}

/**
 * A two-car subway train modeled on the MBTA Green Line car: white upper body, a solid colored lower
 * half, big windows, double doors, ribbed roof boxes, a black accordion end, and a round T logo.
 * A hard colored shadow sits behind it. It faces right.
 */
export default function Train({ color, className }) {
  const id = useId().replace(/:/g, '');
  const lead = 324;

  return (
    <svg className={className} viewBox="-72 0 720 166" aria-hidden="true" focusable="false">
      <g stroke="#111" strokeWidth="5" strokeLinecap="round" opacity="0.5">
        <path d="M-66 56H-28" />
        <path d="M-54 82H-10" />
        <path d="M-64 108H-32" />
      </g>

      <g fill={color} transform="translate(9 10)">
        <path d={carPath(0, false)} />
        <path d={carPath(lead, true)} />
      </g>

      {/* Coupling between the cars */}
      <rect x="298" y="92" width="30" height="14" rx="3" fill="#111" />

      <Car id={id} x0={0} lead={false} color={color} />
      <Car id={id} x0={lead} lead color={color} />
    </svg>
  );
}
