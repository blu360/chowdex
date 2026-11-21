import Train, { TRAINS } from './Train.jsx';
import { Cloud, Sparkle } from './Doodles.jsx';

/** How long the whole transition lasts, and when the page underneath is swapped (screen fully covered). */
export const TRANSITION_TOTAL_MS = 1500;
export const TRANSITION_SWAP_MS = 700;

/** Order the trains take turns in. */
export const TRAIN_ORDER = ['green', 'red', 'orange', 'blue'];

/**
 * A full-screen cover that a train drives across while the page underneath changes.
 * Render it with a new `key` per transition so the animation restarts.
 */
export default function TrainTransition({ train }) {
  const t = TRAINS[train] ?? TRAINS.green;

  return (
    <div className="transition" style={{ '--line': t.color }} role="status">
      <span className="sr-only">Loading</span>
      <Cloud className="transition-cloud c1" />
      <Cloud className="transition-cloud c2" />
      <Sparkle className="transition-sparkle" />
      <div className="transition-stage" aria-hidden="true">
        <div className="transition-rail" />
        <div className="transition-train">
          <Train color={t.color} />
        </div>
      </div>
      <div className="transition-dots" aria-hidden="true">
        <i /><i /><i />
      </div>
    </div>
  );
}
