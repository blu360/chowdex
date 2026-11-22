import { useEffect, useMemo, useState } from 'react';
import { addToDex, getDex, getNeighborhoodProgress, getNeighborhoods, getPlaces, getStamps } from '../../lib/api.js';
import { Icon, PetArt } from '../../components/ui.jsx';
import { boundsOfFeature } from '../../lib/game.js';
import { locationCounts } from '../../lib/chains.js';
import { distanceM, formatDistance, saveOnboarding } from '../../lib/onboarding.js';
import { cuisineLabel } from '../../lib/placeLabels.js';
import { localScore } from '../../lib/spotlight.js';
import { SCHOOLS } from './schools.js';

const STEPS = 4;
const NEARBY_SHOWN = 8; // places offered in "have you been here?"
/** "Nearby" means within a mile of the school or neighborhood: about a 20 minute walk. */
const NEARBY_RADIUS_M = 1609.34;
const FALLBACK_SHOWN = 3; // if nothing is within a mile, show this many of the closest places
/**
 * How many past visits can be claimed during setup. Deliberately small: a couple of places gives a
 * new user a pet or two and their first badge right away, without handing out the bigger badges
 * (5 places, 3 neighborhoods...) that are meant to be earned by exploring.
 */
const MAX_BEEN = 3;
const RECOMMENDED = 3;
const BEEN_NOTE = 'Been here before joining Chowdex.';

/**
 * First-run setup, shown once after sign-in:
 *   1. Are you a student?   2. Which school (or neighborhood)?
 *   3. Been to any of these places nearby?   4. Places to try next.
 * Answers are kept by src/lib/onboarding.js. Claimed places go through addToDex() like any meal.
 *
 * @param {Object} props
 * @param {{id: string, display_name: string}} props.user
 * @param {() => void} props.onClose                 called when it is finished or skipped
 * @param {() => void} props.onDexChange             the dex changed: refresh the rest of the app
 * @param {(target: Object) => void} props.onExplore jump to the Explore map
 */
export default function Onboarding({ user, onClose, onDexChange, onExplore }) {
  const [step, setStep] = useState(0);
  const [student, setStudent] = useState(null);
  const [school, setSchool] = useState(null);
  const [hoodId, setHoodId] = useState(null);
  const [pickHood, setPickHood] = useState(false); // student whose school is not listed
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [been, setBeen] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [gained, setGained] = useState(null); // what the claimed places unlocked

  const load = async () => {
    const [places, dex, hoods, stamps, hoodGeo] = await Promise.all([
      getPlaces(),
      getDex(),
      getNeighborhoodProgress(),
      getStamps(),
      getNeighborhoods(),
    ]);
    setData({ places, dex, hoods, stamps, hoodGeo });
  };
  useEffect(() => {
    load().catch(() => setError('Could not load places. You can skip this for now.'));
  }, []);

  // Where "nearby" is measured from: the school, or the middle of the chosen neighborhood.
  const anchor = useMemo(() => {
    if (school) return { lat: school.lat, lng: school.lng, label: school.name };
    if (hoodId && data) {
      const feature = data.hoodGeo.features.find((f) => f.properties.id === hoodId);
      if (feature) {
        const [[west, south], [east, north]] = boundsOfFeature(feature);
        return { lat: (south + north) / 2, lng: (west + east) / 2, label: feature.properties.name };
      }
    }
    return null;
  }, [school, hoodId, data]);

  const logged = useMemo(() => new Set((data?.dex ?? []).map((e) => e.place_id)), [data]);
  const byDistance = useMemo(() => {
    if (!anchor || !data) return [];
    return data.places
      .map((p) => ({ ...p, away: distanceM(anchor, p) }))
      .sort((a, b) => a.away - b.away);
  }, [anchor, data]);
  // Places they have not logged, within a mile. If there are none, fall back to the few closest and say so.
  const unlogged = byDistance.filter((p) => !logged.has(p.id));
  const withinMile = unlogged.filter((p) => p.away <= NEARBY_RADIUS_M);
  const farOnly = withinMile.length === 0 && unlogged.length > 0;
  const nearby = farOnly ? unlogged.slice(0, FALLBACK_SHOWN) : withinMile.slice(0, NEARBY_SHOWN);

  // Step 4: the best local picks among the closest places they have not logged.
  const recommended = useMemo(() => {
    if (!data || !anchor) return [];
    const ctx = {
      counts: locationCounts(data.places),
      visitedHoods: new Set(data.hoods.filter((h) => h.visited).map((h) => h.id)),
      stampedStations: new Set(Object.keys(data.stamps.by_station)),
    };
    const open = byDistance.filter((p) => !logged.has(p.id));
    const close = open.filter((p) => p.away <= NEARBY_RADIUS_M);
    return (close.length ? close : open.slice(0, FALLBACK_SHOWN))
      .map((p) => ({ ...p, ...localScore(p, ctx) }))
      .sort((a, b) => b.score - a.score || a.away - b.away)
      .slice(0, RECOMMENDED);
  }, [byDistance, data, anchor, logged]);

  const finish = (extra = {}) => {
    saveOnboarding(user.id, { done: true, student, schoolId: school?.id ?? null, hoodId, ...extra });
    onClose();
  };

  const toggleBeen = (id) =>
    setBeen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_BEEN) next.add(id);
      return next;
    });

  /** Log the claimed places like any other meal, then move on to the recommendations. */
  const claim = async () => {
    setBusy(true);
    setError(null);
    const pets = [];
    const badges = [];
    try {
      for (const id of been) {
        try {
          const entry = await addToDex(id, { note: BEEN_NOTE });
          if (entry.unlocked_pet) pets.push(entry.unlocked_pet);
          for (const b of entry.new_badges ?? []) badges.push(b.name);
        } catch (err) {
          if (err.code !== 'ALREADY_IN_DEX') throw err;
        }
      }
      if (been.size) {
        await load();
        onDexChange();
      }
      setGained({ pets, badges: [...new Set(badges)], count: been.size });
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const firstName = user.display_name.split(' ')[0];
  const schoolMatches = SCHOOLS.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()));
  const askHood = student === false || pickHood;

  return (
    <div className="onboard-backdrop">
      <section className="onboard" role="dialog" aria-modal="true" aria-labelledby="onboard-title">
        <header className="onboard-head">
          <ol className="onboard-steps" aria-label={`Step ${step + 1} of ${STEPS}`}>
            {Array.from({ length: STEPS }, (_, i) => (
              <li key={i} className={i < step ? 'done' : i === step ? 'now' : undefined} />
            ))}
          </ol>
          <button className="link-btn" onClick={() => finish({ skipped: true })}>Skip for now</button>
        </header>

        {/* ---------- 1. Student? ---------- */}
        {step === 0 && (
          <div className="onboard-body">
            <h2 id="onboard-title">Welcome, {firstName}. Are you a student?</h2>
            <p className="muted">Chowdex is built around college life in Boston, so this helps us start you near campus.</p>
            <div className="onboard-choices">
              <button className="choice" onClick={() => { setStudent(true); setPickHood(false); setHoodId(null); setStep(1); }}>
                <b>Yes, I'm a student</b>
                <span>Pick your school next</span>
              </button>
              <button className="choice" onClick={() => { setStudent(false); setSchool(null); setStep(1); }}>
                <b>No, just hungry</b>
                <span>Pick your neighborhood next</span>
              </button>
            </div>
          </div>
        )}

        {/* ---------- 2. School or neighborhood ---------- */}
        {step === 1 && !askHood && (
          <div className="onboard-body">
            <h2 id="onboard-title">What school do you go to?</h2>
            <label className="search-input onboard-search">
              <Icon name="explore" size={16} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search schools" aria-label="Search schools" />
            </label>
            <ul className="onboard-list">
              {schoolMatches.map((s) => (
                <li key={s.id}>
                  <button className={school?.id === s.id ? 'row on' : 'row'} aria-pressed={school?.id === s.id} onClick={() => setSchool(s)}>
                    {s.name}
                    {school?.id === s.id && <Icon name="check" size={16} />}
                  </button>
                </li>
              ))}
              {schoolMatches.length === 0 && <li className="muted small">No school matches that.</li>}
            </ul>
            <button className="link-btn" onClick={() => { setSchool(null); setPickHood(true); }}>My school isn't listed</button>
          </div>
        )}
        {step === 1 && askHood && (
          <div className="onboard-body">
            <h2 id="onboard-title">{student ? 'Which neighborhood is your school in?' : 'Where do you usually eat?'}</h2>
            <p className="muted">Pick the neighborhood you spend the most time in.</p>
            <ul className="onboard-list">
              {(data?.hoods ?? []).map((h) => (
                <li key={h.id}>
                  <button className={hoodId === h.id ? 'row on' : 'row'} aria-pressed={hoodId === h.id} onClick={() => setHoodId(h.id)}>
                    <span><i className="hood-dot" style={{ background: h.color }} />{h.name}</span>
                    {hoodId === h.id && <Icon name="check" size={16} />}
                  </button>
                </li>
              ))}
            </ul>
            {student && <button className="link-btn" onClick={() => { setPickHood(false); setHoodId(null); }}>Back to the school list</button>}
          </div>
        )}

        {/* ---------- 3. Been to any of these? ---------- */}
        {step === 2 && (
          <div className="onboard-body">
            <h2 id="onboard-title">Been to any of these near {anchor?.label}?</h2>
            <p className="muted">
              {farOnly
                ? 'Nothing is listed within a mile yet, so these are the closest. '
                : 'These are within a mile. '}
              Pick up to {MAX_BEEN}. Each one goes in your dex, and the pet from its neighborhood joins you.
            </p>
            <ul className="onboard-list">
              {nearby.map((p) => {
                const on = been.has(p.id);
                return (
                  <li key={p.id}>
                    <button className={on ? 'row on' : 'row'} aria-pressed={on} disabled={!on && been.size >= MAX_BEEN} onClick={() => toggleBeen(p.id)}>
                      <span>
                        <b>{p.name}</b>
                        <small>{cuisineLabel(p.cuisine)}{p.neighborhood ? ` · ${p.neighborhood.name}` : ''} · {formatDistance(p.away)}</small>
                      </span>
                      <span className={on ? 'tick on' : 'tick'}>{on && <Icon name="check" size={14} />}</span>
                    </button>
                  </li>
                );
              })}
              {nearby.length === 0 && <li className="muted small">No places to show here yet.</li>}
            </ul>
          </div>
        )}

        {/* ---------- 4. Recommendations ---------- */}
        {step === 3 && (
          <div className="onboard-body">
            <h2 id="onboard-title">You're set. Try these next.</h2>
            {gained && gained.count > 0 && (
              <div className="onboard-gained">
                {gained.pets.map((pet) => <PetArt key={pet.id} pet={pet} tint="var(--accent)" />)}
                <p>
                  <b>{gained.count} {gained.count === 1 ? 'place' : 'places'} added to your dex.</b>{' '}
                  {gained.pets.length > 0 && `${gained.pets.map((p) => p.name).join(' and ')} joined you. `}
                  {gained.badges.length > 0 && `Badge earned: ${gained.badges.join(', ')}.`}
                </p>
              </div>
            )}
            <p className="muted">
              {recommended.some((p) => p.away <= NEARBY_RADIUS_M)
                ? `Small, local places within a mile of ${anchor?.label} that you haven't logged.`
                : `Nothing is listed within a mile of ${anchor?.label} yet, so these are the closest.`}
            </p>
            <ul className="spot-list">
              {recommended.map((p) => (
                <li key={p.id}>
                  <button onClick={() => { finish(); onExplore({ type: 'place', id: p.id, center: [p.lng, p.lat] }); }}>
                    <span className="spot-main">
                      <b>{p.name}</b>
                      <small>
                        {cuisineLabel(p.cuisine)}
                        {p.price_level ? ` · ${'$'.repeat(p.price_level)}` : ''}
                        {` · ${formatDistance(p.away)} away`}
                      </small>
                      <span className="spot-why">{p.reasons.slice(0, 3).map((r) => <i key={r}>{r}</i>)}</span>
                    </span>
                    <Icon name="next" size={16} />
                  </button>
                </li>
              ))}
              {recommended.length === 0 && <li className="muted small">No recommendations yet. The Explore map has everything.</li>}
            </ul>
          </div>
        )}

        {error && <p className="error onboard-error">{error}</p>}

        {/* ---------- Footer ---------- */}
        {step > 0 && (
          <footer className="onboard-foot">
            {step < 3 ? (
              <button className="btn" disabled={busy} onClick={() => setStep(step - 1)}>Back</button>
            ) : (
              <span />
            )}
            {step === 1 && (
              <button className="btn btn-solid" disabled={!anchor} onClick={() => setStep(2)}>Next</button>
            )}
            {step === 2 && (
              <button className="btn btn-solid" disabled={busy} onClick={claim}>
                {busy ? 'Adding…' : been.size ? `Add ${been.size} and continue` : "Haven't been to any"}
              </button>
            )}
            {step === 3 && (
              <button className="btn btn-solid" onClick={() => finish()}>Go to my home</button>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}
