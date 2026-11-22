import { useEffect, useState } from 'react';
import {
  getBadges,
  getNeighborhoodProgress,
  getNeighborhoods,
  getPetHistory,
  getPetJournal,
  getPets,
  getPlaces,
  getStamps,
  getStations,
  setActivePet,
  setPetNickname,
} from '../../lib/api.js';
import { Icon, LevelPill, LevelTrack, PetArt, Stars, XpBar } from '../../components/ui.jsx';
import { boundsOfFeature, boundsOfPoints, formatDate, formatFullDate, listNames, petProgress, titleCase } from '../../lib/game.js';
import JourneyMap from '../map/JourneyMap.jsx';
import { loreFor } from './petLore.js';
import { STARTER_TINT, tintsFor } from './PetsPage.jsx';
import { cuisineLabel } from '../../lib/placeLabels.js';

const EVENT_ICON = { unlocked: 'pets', fed: 'meal', full: 'meal', level_up: 'bolt', badge: 'medal' };
const HISTORY_PREVIEW = 6;
const BADGE_PREVIEW = 4;
const JOURNAL_PREVIEW = 3;

/** The pet's origin, written from its real history. */
function originStory(pet, journal, history) {
  const name = pet.display_name;
  const hoods = [...new Set(journal.entries.map((e) => e.place.neighborhood?.name).filter(Boolean))];
  if (pet.is_starter) {
    if (!journal.entries.length) {
      return `${name} has been with you since day one, and is still waiting for your first meal together.`;
    }
    return `${name} has been with you since day one, and eats wherever you do. Together you have had ${journal.entries.length} ${
      journal.entries.length === 1 ? 'meal' : 'meals'
    }${hoods.length ? ` across ${listNames(hoods.slice(0, 4))}${hoods.length > 4 ? ', and beyond' : ''}` : ''}.`;
  }
  const joined = history.find((ev) => ev.type === 'unlocked');
  const first = joined?.place?.name;
  const more = pet.entries - 1;
  return `${name} was discovered in ${pet.neighborhood.name} on ${formatFullDate(pet.unlocked_at)}${
    first ? `, after your first meal there at ${first}` : ''
  }. ${more > 0 ? `You have shared ${more} more ${more === 1 ? 'meal' : 'meals'} in the neighborhood since.` : 'It is waiting for your next meal in the neighborhood.'}`;
}

function Fact({ label, children }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** A collectible character page for one pet. */
export default function PetProfile({ petId, version, signedIn, onBack, onChange, onExplore, onGo }) {
  const [allJournal, setAllJournal] = useState(false);
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [allHistory, setAllHistory] = useState(false);
  const [allBadges, setAllBadges] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    Promise.all([
      getPets(),
      getNeighborhoodProgress(),
      getPetJournal(petId),
      getPetHistory(petId),
      getBadges(),
      getStamps(),
      getStations(),
      getPlaces(),
      getNeighborhoods(),
    ])
      .then(([pets, hoods, journal, history, badges, stamps, stations, places, hoodGeo]) => {
        if (cancelled) return;
        const pet = pets.find((p) => p.id === petId);
        if (!pet) return setMissing(true);
        setData({ pet, tints: tintsFor(hoods), journal, history, badges: badges.filter((b) => b.pet_id === petId), stamps, stations, places, hoodGeo });
        setNickname(pet.nickname ?? '');
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [petId, version]);

  useEffect(() => {
    setEditing(false);
    setAllHistory(false);
    setAllBadges(false);
    setAllJournal(false);
    setError(null);
  }, [petId]);

  if (missing) {
    return (
      <div className="page paper">
        <div className="page-inner">
          <button className="back-btn" onClick={onBack}><Icon name="back" size={18} />All pets</button>
          <p className="notice">That pet does not exist.</p>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="page paper">
        <p className="page-inner muted">Loading…</p>
      </div>
    );
  }

  const { pet, journal, history, badges, stamps, stations, places, hoodGeo } = data;
  const tint = data.tints[pet.id] ?? STARTER_TINT;
  const lore = loreFor(pet.id);
  const progress = petProgress(pet);

  const hoodFeature = pet.neighborhood ? hoodGeo.features.find((f) => f.properties.id === pet.neighborhood.id) : null;
  const exploreHome = () => hoodFeature && onExplore({ type: 'neighborhood', bounds: boundsOfFeature(hoodFeature) });

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------ Locked pet ------------------------------ */
  if (!pet.unlocked) {
    const here = places.filter((p) => p.neighborhood?.id === pet.neighborhood.id);
    return (
      <div className="page paper">
        <div className="page-inner rise">
          <button className="back-btn" onClick={onBack}><Icon name="back" size={18} />All pets</button>
          <section className="profile-hero locked" style={{ '--tint': '#d9d9d9' }}>
            <PetArt pet={pet} tint="#d9d9d9" locked className="xl" />
            <h1>???</h1>
            <p className="pet-species"><Icon name="pin" size={14} />Lives in {pet.neighborhood.name}</p>
            <p className="locked-hint">
              Someone lives in {pet.neighborhood.name}. Log your first meal there and it will join you.
            </p>
            <button className="btn btn-solid" onClick={exploreHome}>Explore {pet.neighborhood.name}</button>
            <p className="muted small">
              {here.length
                ? `${here.length} ${here.length === 1 ? 'place' : 'places'} to try there right now.`
                : 'No places are listed there yet.'}
            </p>
          </section>
        </div>
      </div>
    );
  }

  /* ----------------------------- Unlocked pet ----------------------------- */
  const placeIds = [...new Set(journal.entries.map((e) => e.place.id))];
  const visitedPlaces = placeIds.map((id) => places.find((p) => p.id === id)).filter(Boolean);
  const hoodIds = [...new Set(journal.entries.map((e) => e.place.neighborhood?.id).filter(Boolean))];
  const stampedStations = stations.filter((s) => (stamps.by_station[s.id] ?? []).some((id) => placeIds.includes(id)));

  const rated = journal.entries.filter((e) => e.my_rating);
  const favorite = rated.length
    ? [...rated].sort((a, b) => b.my_rating - a.my_rating || b.visited_at.localeCompare(a.visited_at))[0]
    : null;
  const topCuisine = journal.stats.top_cuisines[0];

  const earned = badges.filter((b) => b.earned);
  const closeness = (b) => (b.next_target ? b.value / b.next_target : 1);
  const sortedBadges = [...badges].sort((a, b) => Number(b.earned) - Number(a.earned) || closeness(b) - closeness(a));
  const shownBadges = allBadges ? sortedBadges : sortedBadges.slice(0, BADGE_PREVIEW);
  const shownHistory = allHistory ? history : history.slice(0, HISTORY_PREVIEW);
  const shownJournal = allJournal ? journal.entries : journal.entries.slice(0, JOURNAL_PREVIEW);

  const saveNickname = (e) => {
    e.preventDefault();
    run(async () => {
      await setPetNickname(pet.id, nickname);
      setEditing(false);
    });
  };

  return (
    <div className="page paper">
      <div className="page-inner rise">
        <button className="back-btn" onClick={onBack}><Icon name="back" size={18} />All pets</button>

        <div className="profile">
          {/* Character card */}
          <section className="profile-hero" style={{ '--tint': tint }}>
            {pet.active && <span className="buddy-tag">Your buddy</span>}
            <PetArt pet={pet} tint={tint} className="xl" />

            {editing ? (
              <form className="nickname-form" onSubmit={saveNickname}>
                <input
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={24}
                  placeholder={pet.name}
                  aria-label="Nickname"
                  autoFocus
                />
                <button className="btn btn-small btn-solid" disabled={busy}>Save</button>
                <button type="button" className="btn btn-small" onClick={() => { setEditing(false); setNickname(pet.nickname ?? ''); }}>Cancel</button>
              </form>
            ) : (
              <h1>
                {pet.display_name}
                {signedIn && (
                  <button className="edit-name" onClick={() => setEditing(true)} aria-label={pet.nickname ? 'Change nickname' : 'Give a nickname'}>
                    <Icon name="pencil" size={16} />
                  </button>
                )}
              </h1>
            )}
            <p className="pet-species">
              {pet.is_starter ? 'Starter' : 'Neighborhood pet'} <span aria-hidden="true">·</span> {pet.name} <span aria-hidden="true">·</span> <LevelPill level={pet.level} max={pet.max_level} />
            </p>

            <div className="hero-xp">
              <XpBar percent={progress.percent} label="XP toward the next level" />
              <span>{progress.label}</span>
            </div>
            <LevelTrack pet={pet} />

            <dl className="facts-row">
              <Fact label="Discovered">
                {pet.is_starter ? 'With you from the start' : formatFullDate(pet.unlocked_at)}
              </Fact>
              <Fact label="From">
                {pet.is_starter ? 'Everywhere in Boston' : pet.neighborhood.name}
              </Fact>
            </dl>

            {signedIn && !pet.active && (
              <button className="btn btn-solid" disabled={busy} onClick={() => run(() => setActivePet(pet.id))}>
                Make {pet.display_name} my buddy
              </button>
            )}
            {hoodFeature && (
              <button className="btn" onClick={exploreHome}>Find food in {pet.neighborhood.name}</button>
            )}
            {error && <p className="error">{error}</p>}
          </section>

          <div className="profile-body">
            {/* Stats */}
            <section className="card">
              <h2 className="card-title">Stats</h2>
              <div className="stat-grid">
                <div className="stat"><b>{pet.xp}</b><span>Total XP</span></div>
                <div className="stat"><b>{placeIds.length}</b><span>Restaurants</span></div>
                <div className="stat"><b>{stampedStations.length}</b><span>Stations stamped</span></div>
                <div className="stat"><b>{hoodIds.length}</b><span>{hoodIds.length === 1 ? 'Neighborhood' : 'Neighborhoods'}</span></div>
                <div className="stat"><b>{earned.length}<i> / {badges.length}</i></b><span>Badges</span></div>
                <div className="stat"><b>{journal.stats.photos}</b><span>Photos</span></div>
              </div>
            </section>

            {/* Origin and personality */}
            <section className="card">
              <h2 className="card-title">Origin story</h2>
              <p className="story">{originStory(pet, journal, history)}</p>

              <h2 className="card-title spaced">Personality</h2>
              <p className="story">{lore.blurb}</p>
              <ul className="traits">
                {lore.traits.map((t) => <li key={t}>{t}</li>)}
              </ul>
              <dl className="favorites">
                <Fact label="Favorite cuisine">
                  {topCuisine ? cuisineLabel(topCuisine.cuisine) : <span className="muted">Still deciding</span>}
                </Fact>
                <Fact label="Favorite restaurant">
                  {favorite ? (
                    <>
                      {favorite.place.name} <Stars value={favorite.my_rating} />
                    </>
                  ) : (
                    <span className="muted">Rate a meal to pick one</span>
                  )}
                </Fact>
                {journal.stats.recent_dishes.length > 0 && (
                  <Fact label="Recently ate">{journal.stats.recent_dishes.slice(0, 3).join(', ')}</Fact>
                )}
              </dl>
            </section>

            {/* Milestones */}
            <section className="card">
              <div className="sec-head">
                <h2 className="card-title">Milestones</h2>
                <span className="muted small">{earned.length} of {badges.length} badges</span>
              </div>
              <ul className="badge-list">
                {shownBadges.map((b) => {
                  const target = b.next_target ?? b.tiers[b.tiers.length - 1];
                  return (
                    <li key={b.id} className={b.earned ? 'badge earned' : 'badge'}>
                      <span className="badge-ico"><Icon name={b.earned ? 'medal' : 'lock'} size={16} /></span>
                      <div>
                        <p>
                          {b.name}
                          {b.earned && <em>{b.tier_labels[b.tier - 1]}</em>}
                        </p>
                        <small>{b.description}</small>
                        {b.next_target != null && (
                          <div className="badge-progress">
                            <XpBar percent={(100 * b.value) / target} label={`${b.name} progress`} />
                            <span>{Math.min(b.value, target)} / {target}</span>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {sortedBadges.length > BADGE_PREVIEW && (
                <button className="more-btn" onClick={() => setAllBadges((v) => !v)}>
                  {allBadges ? 'Show fewer' : `Show all ${sortedBadges.length}`}
                </button>
              )}
            </section>

            {/* Food journal: the meals that fed this pet */}
            <section className="card">
              <div className="sec-head">
                <h2 className="card-title">Food journal</h2>
                {onGo && journal.entries.length > 0 && (
                  <button className="sec-link" onClick={() => onGo('dex')}>Edit in My Dex</button>
                )}
              </div>
              {journal.entries.length === 0 ? (
                <p className="muted">No meals logged for {pet.display_name} yet.</p>
              ) : (
                <>
                  <ul className="journal-list">
                    {shownJournal.map((e) => (
                      <li key={e.id}>
                        {e.photo_url ? (
                          <img className="journal-thumb" src={e.photo_url} alt={`Your photo from ${e.place.name}`} />
                        ) : (
                          <span className="journal-thumb empty" aria-hidden="true"><Icon name="meal" size={18} /></span>
                        )}
                        <div>
                          <p>
                            <b>{e.place.name}</b>
                            <span className={e.fed ? 'gain' : 'gain none'}>{e.fed ? `+${e.xp_gained} XP` : 'No XP'}</span>
                          </p>
                          <small>
                            {cuisineLabel(e.place.cuisine)} · {formatDate(e.visited_at)}
                            {e.favorite_dish ? ` · ${e.favorite_dish}` : ''}
                          </small>
                          <Stars value={e.my_rating} />
                          {e.note && <p className="journal-note">“{e.note}”</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {journal.entries.length > JOURNAL_PREVIEW && (
                    <button className="more-btn" onClick={() => setAllJournal((v) => !v)}>
                      {allJournal ? 'Show fewer' : `Show all ${journal.entries.length} meals`}
                    </button>
                  )}
                </>
              )}
            </section>

            {/* Exploration history */}
            <section className="card">
              <div className="sec-head">
                <h2 className="card-title">Exploration history</h2>
                <span className="muted small">{journal.stats.meals} {journal.stats.meals === 1 ? 'meal' : 'meals'}</span>
              </div>
              {history.length === 0 ? (
                <p className="muted">
                  No adventures yet. {signedIn ? 'Log a meal on the Explore map to get started.' : 'Sign in or load the demo data to get started.'}
                </p>
              ) : (
                <>
                  <JourneyMap
                    version={version}
                    hoodIds={hoodIds}
                    placeIds={placeIds}
                    bounds={boundsOfPoints(visitedPlaces)}
                    onSelectPlace={(id) => onExplore({ type: 'place', id })}
                    label={`Where ${pet.display_name} has been`}
                  />
                  <ol className="timeline">
                    {shownHistory.map((ev, i) => (
                      <li key={`${ev.type}-${ev.entry_id}-${i}`} className={`ev ev-${ev.type}`}>
                        <span className="ev-ico"><Icon name={EVENT_ICON[ev.type]} size={15} /></span>
                        <p>{ev.text}</p>
                        <time dateTime={ev.at}>{formatDate(ev.at)}</time>
                      </li>
                    ))}
                  </ol>
                  {history.length > HISTORY_PREVIEW && (
                    <button className="more-btn" onClick={() => setAllHistory((v) => !v)}>
                      {allHistory ? 'Show less' : `Show all ${history.length} moments`}
                    </button>
                  )}
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
