import { useState } from 'react';
import { LINE_COLORS } from '../../lib/lines.js';

/** Collapsible key to the map. MBTA colors are the official ones; everything else is Chowdex's own. */
export default function Legend() {
  const [open, setOpen] = useState(() => window.innerWidth > 800);

  return (
    <div className="legend">
      <button className="legend-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Legend
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="legend-body">
          <section>
            <h4>Eats</h4>
            <p><i className="sym sym-place" /> Restaurant (zoom in)</p>
            <p><i className="sym sym-star" /> Local discovery</p>
            <p><i className="sym sym-collected" /> In your dex</p>
          </section>
          <section>
            <h4>Transit</h4>
            <p><i className="sym sym-station" /> Station</p>
            <p><i className="sym sym-stamped" /> Stamped station</p>
            <p>
              <svg className="legend-train" viewBox="0 0 44 30" aria-hidden="true" focusable="false">
                <path d="M7 5H28Q38 6 40 13L41 19Q41 22 37 22H7Q3 22 3 18V9Q3 5 7 5Z" fill="#fff" stroke="#111" strokeWidth="2.6" strokeLinejoin="round" />
                <path d="M3.6 13.5H40.4L41 19Q41 22 37 22H7Q3 22 3 18Z" fill="#0c6b14" />
                <path d="M7 5H28Q38 6 40 13L41 19Q41 22 37 22H7Q3 22 3 18V9Q3 5 7 5Z" fill="none" stroke="#111" strokeWidth="2.6" strokeLinejoin="round" />
                <g fill="#b3b9bf">
                  {[7, 14.5, 22].map((x) => <rect key={x} x={x} y="7.2" width="6" height="4.2" />)}
                </g>
                <g fill="#111">
                  {[11, 31].map((x) => <circle key={x} cx={x} cy="24.5" r="2.8" />)}
                </g>
              </svg>
              Live train (zoom in)
            </p>
            <p className="legend-lines">
              {Object.entries(LINE_COLORS).map(([line, color]) => (
                <span key={line} style={{ background: color }}>{line}</span>
              ))}
            </p>
          </section>
          <section>
            <h4>Areas</h4>
            <p>
              <span className="hood-swatches" aria-hidden="true">
                <i style={{ background: '#338ae1' }} /><i style={{ background: '#be2d9a' }} /><i style={{ background: '#58cf30' }} /><i style={{ background: '#e18a33' }} />
              </span>
              Neighborhoods
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
