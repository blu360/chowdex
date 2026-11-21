import { useEffect, useState } from 'react';
import {
  getActivity,
  getBadges,
  getFeedingStatus,
  getNeighborhoodProgress,
  getNeighborhoods,
  getPetJournal,
  getPets,
  getPlaces,
  getStamps,
  getStations,
  setActivePet,
} from '../../lib/api.js';
import { LINE_COLORS, TIER_COLORS } from '../../lib/lines.js';
import { Icon, LevelPill, LineDots, PetArt, XpBar } from '../../components/ui.jsx';
import { boundsOfFeature, buildActivity, petProgress, timeAgo, trainerProgress } from '../../lib/game.js';
import JourneyMap from '../map/JourneyMap.jsx';
import { homeOf } from '../pet/PetCard.jsx';
import PetStage from '../pet/PetStage.jsx';
import { STARTER_TINT, tintsFor } from '../pet/PetsPage.jsx';
import { loreFor } from '../pet/petLore.js';

const FEED_PREVIEW = 5;
const KIND_ICON = { meal: 'meal', stamp: 'stamps', level: 'bolt', badge: 'medal' };

/** Home: your buddy and team first, then how far you have explored, where to go next, and what happened lately. */
export default function HomePage({ version, user, profile, onOpenPet, onGo, onExplore, onSignIn, onDemo, onChange }) {
  const [data, setData] = useState(null);
  const [viewId, setViewId] = useState(null); // the team member being shown; null = the buddy
  const [allFeed, setAllFeed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pets, hoods, stamps, stations, journal, feeding, places, hoodGeo, events, badges] = await Promise.all([
        getPets(),
        getNeighborhoodProgress(),
        getStamps(),
        getStations(),
        getPetJournal('starter'), // the starter eats everywhere, so its journal is every meal
        getFeedingStatus(),
        getPlaces(),
        getNeighborhoods(),
        getActivity({ limit: 60 }), // every pet's recent happenings in one call
        getBadges(),
      ]);
      if (cancelled) return;
      setData({
        pets,
        hoods,
        stamps,
        journal,
        feeding,
        places,
        hoodGeo,
        badges,
        tints: tintsFor(hoods),
        activity: buildActivity({ pets, events, badges, stamps, stations, entries: journal.entries }),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!data) {
    return (
      <div className="page paper">
        <p className="page-inner muted">Loading…</p>
      </div>
    );
  }

  const { pets, hoods, stamps, journal, feeding, places, hoodGeo, badges, tints, activity } = data;
  const signedIn = Boolean(user);
  const tintOf = (pet) => tints[pet.id] ?? STARTER_TINT;

  // The team: your buddy first, then the highest levels.
  const team = pets
    .filter((p) => p.unlocked)
    .sort((a, b) => Number(b.active) - Number(a.active) || b.level - a.level || b.xp - a.xp || (b.unlocked_at ?? '').localeCompare(a.unlocked_at ?? ''));
  const shown = team.find((p) => p.id === viewId) ?? team[0];
  const shownProgress = petProgress(shown);

  const trainer = trainerProgress(profile?.xp ?? 0);
  const visited = hoods.filter((h) => h.visited);
  const placeCount = new Set(journal.entries.map((e) => e.place.id)).size;

  // Where next: neighborhoods you have not eaten in yet that have places to try, most options first.
  const placesByHood = {};
  for (const p of places) if (p.neighborhood) placesByHood[p.neighborhood.id] = (placesByHood[p.neighborhood.id] ?? 0) + 1;
  const nextHoods = hoods
    .filter((h) => !h.visited && placesByHood[h.id])
    .sort((a, b) => placesByHood[b.id] - placesByHood[a.id] || a.name.localeCompare(b.name))
    .slice(0, 3);
  const exploreHood = (id) => {
    const feature = hoodGeo.features.find((f) => f.properties.id === id);
    if (feature) onExplore({ type: 'neighborhood', bounds: boundsOfFeature(feature) });
  };

  // The badge you are closest to finishing (real progress from getBadges()).
  const challenge = badges
    .filter((b) => b.next_target != null && b.value > 0)
    .sort((a, b) => b.value / b.next_target - a.value / a.next_target)[0];

  const makeBuddy = async () => {
    setBusy(true);
    try {
      await setActivePet(shown.id);
      setViewId(null);
      onChange?.();
    } finally {
      setBusy(false);
    }
  };

  const feed = allFeed ? activity.slice(0, 20) : activity.slice(0, FEED_PREVIEW);

  return (
    <div className="page paper">
      <div className="page-inner world rise">
        {/* ---------- You ---------- */}
        <header className="hello">
          {signedIn ? (
            <>
              <div>
                <h1>{user.display_name}</h1>
                <p className="kicker">Explorer level {trainer.level}</p>
              </div>
              <div className="hello-xp" title="Your explorer level grows with every meal that fed your pets">
                <XpBar percent={trainer.percent} label="XP toward the next explorer level" />
                <span>{trainer.xp} / {trainer.next} XP</span>
              </div>
            </>
          ) : (
            <>
              <div>
                <h1>Welcome to Chowdex</h1>
                <p className="kicker">Eat around Boston, stamp T stations, and collect a pet in every neighborhood.</p>
              </div>
              <div className="hello-actions">
                <button className="btn btn-solid" onClick={onSignIn}>Sign in with Google</button>
                <button className="btn" onClick={onDemo} title="Mock mode: fill the dex with sample places">Try demo data</button>
              </div>
            </>
          )}
        </header>

        {/* ---------- Your buddy and team ---------- */}
        <section className="companion" aria-label="Your pets">
          <PetStage key={shown.id} pet={shown} tint={tintOf(shown)} />

          <div className="plate">
            <div className="plate-main">
              <p className="plate-name">
                {shown.display_name}
                <LevelPill level={shown.level} max={shown.max_level} />
                {shown.active && <span className="buddy-tag">Buddy</span>}
              </p>
              <p className="plate-sub">
                {shown.nickname ? `${shown.name} · ` : ''}{homeOf(shown)}
              </p>
              <div className="plate-xp">
                <XpBar percent={shownProgress.percent} label={`${shown.display_name} XP`} />
                <span>{shownProgress.label}</span>
              </div>
              <p className="plate-blurb">{loreFor(shown.id).blurb}</p>
            </div>
            <div className="plate-actions">
              <button className="btn btn-small" onClick={() => onOpenPet(shown.id)}>Profile</button>
              {signedIn && !shown.active && (
                <button className="btn btn-small btn-solid" disabled={busy} onClick={makeBuddy}>Make buddy</button>
              )}
            </div>
          </div>

          <div className="team">
            <div className="row-head">
              <h2>Your team</h2>
              <button className="sec-link" onClick={() => onGo('pets')}>All pets · {team.length} / {pets.length}</button>
            </div>
            <div className="team-row" role="tablist" aria-label="Choose a pet">
              {team.map((pet) => (
                <button
                  key={pet.id}
                  role="tab"
                  aria-selected={pet.id === shown.id}
                  className={pet.id === shown.id ? 'token on' : 'token'}
                  style={{ '--tint': tintOf(pet) }}
                  onClick={() => setViewId(pet.id)}
                >
                  <span className="token-face"><img src={pet.image} alt="" draggable="false" /></span>
                  <b>{pet.display_name}</b>
                  <small>Lv {pet.level}</small>
                </button>
              ))}
              <button className="token more" onClick={() => onGo('pets')}>
                <span className="token-face">+{pets.length - team.length}</span>
                <b>To find</b>
                <small>See all</small>
              </button>
            </div>
          </div>
        </section>

        <div className="world-side">
          {/* ---------- Exploration ---------- */}
          <section aria-label="Exploration progress">
            <div className="row-head">
              <h2>Exploration</h2>
              {signedIn && (
                <span className="muted small">
                  {feeding.full ? 'Pets are full today' : `${feeding.remaining} ${feeding.remaining === 1 ? 'feeding' : 'feedings'} left today`}
                </span>
              )}
            </div>
            <div className="figures">
              <button onClick={() => onGo('dex')}>
                <b>{placeCount}<i>/{places.length}</i></b>
                <span>Places</span>
              </button>
              <button onClick={() => onGo('stamps')}>
                <b>{stamps.stamped_total}<i>/{stamps.station_total}</i></b>
                <span>Stamps</span>
              </button>
              <button onClick={() => onGo('explore')}>
                <b>{visited.length}<i>/{hoods.length}</i></b>
                <span>Areas</span>
              </button>
            </div>
            <button className="lines-strip" onClick={() => onGo('stamps')} aria-label="Open station stamps">
              {stamps.lines.map((line) => (
                <span key={line.id} className="strip-line" style={{ '--line': line.color }}>
                  <span className="strip-name">
                    {line.id}
                    {line.tier !== 'none' && <em style={{ background: TIER_COLORS[line.tier] }}>{line.tier}</em>}
                  </span>
                  <span className="strip-track"><i style={{ width: `${line.percent}%` }} /></span>
                  <small>{line.stamped}/{line.total}</small>
                </span>
              ))}
            </button>
          </section>

          {/* ---------- Where next ---------- */}
          {(nextHoods.length > 0 || challenge) && (
            <section aria-label="Where next">
              <div className="row-head">
                <h2>Where next</h2>
              </div>
              <ul className="next-list">
                {nextHoods.map((h) => {
                  const pet = pets.find((p) => p.id === h.pet_id);
                  return (
                    <li key={h.id}>
                      <button onClick={() => exploreHood(h.id)}>
                        <PetArt pet={pet} tint="#d9d9d9" locked />
                        <span>
                          <b>{h.name}</b>
                          <small>A new pet lives here · {placesByHood[h.id]} {placesByHood[h.id] === 1 ? 'place' : 'places'} to try</small>
                        </span>
                        <Icon name="next" size={16} />
                      </button>
                    </li>
                  );
                })}
                {challenge && (
                  <li>
                    <button onClick={() => onGo('explore')}>
                      <span className="next-ico"><Icon name="medal" size={18} /></span>
                      <span>
                        <b>{challenge.name} · {challenge.value} / {challenge.next_target}</b>
                        <small>{challenge.description}</small>
                      </span>
                      <Icon name="next" size={16} />
                    </button>
                  </li>
                )}
              </ul>
            </section>
          )}

          {/* ---------- Your Boston journey ---------- */}
          <section aria-label="Your Boston journey">
            <div className="row-head">
              <h2>Your Boston journey</h2>
              <button className="sec-link" onClick={() => onGo('explore')}>Open map</button>
            </div>
            <JourneyMap
              version={version}
              hoodIds={visited.map((h) => h.id)}
              onSelectPlace={(id) => onExplore({ type: 'place', id })}
            />
          </section>

          {/* ---------- Recent activity ---------- */}
          <section aria-label="Recent activity">
            <div className="row-head">
              <h2>Recent activity</h2>
              {journal.entries.length > 0 && <button className="sec-link" onClick={() => onGo('dex')}>My Dex</button>}
            </div>
            {activity.length === 0 ? (
              <p className="muted">
                Nothing yet. Find a place on the <button className="link" onClick={() => onGo('explore')}>Explore map</button> and add it to your dex.
              </p>
            ) : (
              <>
                <ul className="feed">
                  {feed.map((item) => (
                    <li key={item.key}>
                      {item.kind === 'pet' ? (
                        <PetArt pet={item.pet} tint={tintOf(item.pet)} className="feed-pet" />
                      ) : (
                        <span className={`feed-ico k-${item.kind}`}><Icon name={KIND_ICON[item.kind]} size={16} /></span>
                      )}
                      <div>
                        <p>
                          {item.title}
                          {item.lines && <LineDots lines={item.lines} colors={LINE_COLORS} />}
                        </p>
                        <small>{item.sub ? `${item.sub} · ` : ''}{timeAgo(item.at)}</small>
                      </div>
                      {item.gain && <span className="gain">{item.gain}</span>}
                    </li>
                  ))}
                </ul>
                {activity.length > FEED_PREVIEW && (
                  <button className="more-btn" onClick={() => setAllFeed((v) => !v)}>
                    {allFeed ? 'Show less' : 'Show more'}
                  </button>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
