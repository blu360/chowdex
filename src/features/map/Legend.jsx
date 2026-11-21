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
            <p><i className="sym sym-place" /> Restaurant</p>
            <p><i className="sym sym-collected" /> In your dex</p>
          </section>
          <section>
            <h4>Transit</h4>
            <p><i className="sym sym-station" /> Station</p>
            <p><i className="sym sym-stamped" /> Stamped station</p>
            <p><i className="sym sym-train" /> Live train</p>
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
