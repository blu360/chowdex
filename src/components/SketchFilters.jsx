/**
 * The "flip book" look for pet drawings: four slightly different wobbles of the same picture.
 * CSS flips between them a few times a second (see .pet-art img in game.css), so the ink lines
 * shimmer the way a hand-drawn animation does when every frame is redrawn.
 *
 * Rendered once, hidden, at the top of the app. Each filter nudges pixels by a couple of px using
 * its own noise pattern; flat color barely changes, so what you see moving is the outlines.
 */
export const BOIL_FRAMES = 4;

export default function SketchFilters() {
  return (
    <svg className="sketch-filters" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {Array.from({ length: BOIL_FRAMES }, (_, i) => (
          <filter key={i} id={`boil-${i}`} x="-6%" y="-6%" width="112%" height="112%">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed={i * 7 + 3} result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.2" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        ))}
        {/* A gentler set for small art (the logo): finer noise and a smaller nudge. */}
        {Array.from({ length: BOIL_FRAMES }, (_, i) => (
          <filter key={i} id={`boil-sm-${i}`} x="-8%" y="-8%" width="116%" height="116%">
            <feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed={i * 5 + 2} result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.8" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
