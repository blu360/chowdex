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
import { Icon, LevelPill, LineDots, PetArt, Ring, XpBar } from '../../components/ui.jsx';
import { boundsOfFeature, buildActivity, petProgress, timeAgo, trainerProgress } from '../../lib/game.js';
import JourneyMap from '../map/JourneyMap.jsx';
import { homeOf } from '../pet/PetCard.jsx';
import PetStage from '../pet/PetStage.jsx';
import { petVoice } from '../pet/petVoice.js';
import { STARTER_TINT, tintsFor } from '../pet/PetsPage.jsx';
import { loreFor } from '../pet/petLore.js';

const FEED_PREVIEW = 5;
const KIND_ICON = { meal: 'meal', stamp: 'stamps', level: 'bolt', badge: 'medal' };

function greeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The game's home screen: your companion in its little world, the rest of the team, how far you
 * have explored, where to go next, and what happened lately.
 */
export default function HomePage({ version, user, profile, onOpenPet, onGo, onExplore, onSignIn, onDemo, onChange }) {
  const [data, setData] = useState(null);
  const [viewId, setViewId] = useState(null); // the team member on stage; null = the buddy
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
  const buddy = team[0];
  const onStage = team.find((p) => p.id === viewId) ?? buddy;
  const stageProgress = petProgress(onStage);

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

  // Challenges: the badges you are closest to finishing (real progress from getBadges()).
  const challenges = badges
    .filter((b) => b.next_target != null && b.value > 0)
    .sort((a, b) => b.value / b.next_target - a.value / a.next_target)
    .slice(0, 2);

  // What the pet on stage has to say, from its own meals.
  const itsMeals = onStage.is_starter
    ? journal.entries
    : journal.entries.filter((e) => e.place.neighborhood?.id === onStage.neighborhood?.id);
  const voice = petVoice({ pet: onStage, signedIn, feeding, nextHood: nextHoods[0] ?? null, entries: itsMeals });

  const makeBuddy = async () => {
    setBusy(true);
    try {
      await setActivePet(onStage.id);
      setViewId(null);
      onChange?.();
    } finally {
      setBusy(false);
    }
  };

  const feed = allFeed ? activity.slice(0, 20) : activity.slice(0, FEED_PREVIEW);
  const firstName = user?.display_name.split(' ')[0];

  return (
    <div className="page paper">
      <div className="page-inner world rise">
        {/* ---------- Hello ---------- */}
        <header className="hello">
          <div className="hello-text">
            <p className="kicker">{signedIn ? greeting() : 'Welcome to'}</p>
            <h1>{signedIn ? firstName : 'Chowdex'}</h1>
          </div>
          {signedIn ? (
            <div className="hello-level" title="Your explorer level grows with every meal that fed your pets">
              <Ring percent={trainer.percent} size={54} stroke={6} label={`Explorer level ${trainer.level}`}>
                <b>{trainer.level}</b>
              </Ring>
              <span>
                <b>Explorer</b>
                <small>{trainer.xp} / {trainer.next} XP</small>
              </span>
            </div>
          ) : (
            <div className="hello-actions">
              <button className="btn btn-solid" onClick={onSignIn}>Sign in with Google</button>
              <button className="btn" onClick={onDemo} title="Mock mode: fill the dex with sample places">Try demo data</button>
            </div>
          )}
        </header>

        {/* ---------- Your companion ---------- */}
        <section className="companion" aria-label="Your companion">
          <PetStage key={onStage.id} pet={onStage} tint={tintOf(onStage)} lines={voice.lines} mood={voice.mood} />

          <div className="plate">
            <div className="plate-main">
              <p className="plate-name">
                {onStage.display_name}
                <LevelPill level={onStage.level} max={onStage.max_level} />
                {onStage.active && <span className="buddy-tag">Buddy</span>}
              </p>
              <p className="plate-sub">
                {onStage.nickname ? `${onStage.name} · ` : ''}{homeOf(onStage)}
              </p>
              <div className="plate-xp">
                <XpBar percent={stageProgress.percent} label={`${onStage.display_name} XP`} />
                <span>{stageProgress.label}</span>
              </div>
              <p className="plate-blurb">{loreFor(onStage.id).blurb}</p>
            </div>
            <div className="plate-actions">
              <button className="btn btn-small" onClick={() => onOpenPet(onStage.id)}>Profile</button>
              {signedIn && !onStage.active && (
                <button className="btn btn-small btn-solid" disabled={busy} onClick={makeBuddy}>Make buddy</button>
              )}
            </div>
          </div>

          {/* The team: tap someone to bring them on stage */}
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
                  aria-selected={pet.id === onStage.id}
                  className={pet.id === onStage.id ? 'token on' : 'token'}
                  style={{ '--tint': tintOf(pet) }}
                  onClick={() => setViewId(pet.id)}
                >
                  <Ring percent={petProgress(pet).percent} size={64} stroke={5} color={tintOf(pet)} label={`${pet.display_name}, level ${pet.level}`}>
                    <img src={pet.image} alt="" draggable="false" />
                  </Ring>
                  <b>{pet.display_name}</b>
                  <small>Lv {pet.level}</small>
                </button>
              ))}
              <button className="token more" onClick={() => onGo('pets')}>
                <span className="token-more">+{pets.length - team.length}</span>
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
                <span className={feeding.full ? 'feedings full' : 'feedings'} title="Only the first meals each day feed your pets">
                  {Array.from({ length: feeding.daily_limit }, (_, i) => (
                    <i key={i} className={i < feeding.fed_today ? 'fed' : undefined}><Icon name="meal" size={13} /></i>
                  ))}
                  {feeding.full ? 'Pets are full today' : `${feeding.remaining} left today`}
                </span>
              )}
            </div>
            <div className="dials">
              <button className="dial" onClick={() => onGo('dex')}>
                <Ring percent={places.length ? (100 * placeCount) / places.length : 0} size={62} stroke={7} color="var(--orange)" label="Restaurants discovered">
                  <Icon name="meal" size={22} />
                </Ring>
                <span><b>{placeCount}</b><small>of {places.length} places</small></span>
              </button>
              <button className="dial" onClick={() => onGo('stamps')}>
                <Ring percent={(100 * stamps.stamped_total) / stamps.station_total} size={62} stroke={7} color="var(--red)" label="Stations stamped">
                  <Icon name="stamps" size={22} />
                </Ring>
                <span><b>{stamps.stamped_total}</b><small>of {stamps.station_total} stamps</small></span>
              </button>
              <button className="dial" onClick={() => onGo('explore')}>
                <Ring percent={(100 * visited.length) / hoods.length} size={62} stroke={7} color="var(--green)" label="Neighborhoods explored">
                  <Icon name="pin" size={22} />
                </Ring>
                <span><b>{visited.length}</b><small>of {hoods.length} areas</small></span>
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

          {/* ---------- Next adventure ---------- */}
          {(nextHoods.length > 0 || challenges.length > 0) && (
            <section aria-label="Next adventure">
              <div className="row-head">
                <h2>Next adventure</h2>
              </div>
              <div className="tickets">
                {nextHoods.map((h) => {
                  const pet = pets.find((p) => p.id === h.pet_id);
                  return (
                    <button key={h.id} className="ticket" style={{ '--tint': h.color }} onClick={() => exploreHood(h.id)}>
                      <span className="ticket-stub"><PetArt pet={pet} tint="#e6e6e6" locked /></span>
                      <span className="ticket-body">
                        <small>New friend</small>
                        <b>Who lives in {h.name}?</b>
                        <span>{placesByHood[h.id]} {placesByHood[h.id] === 1 ? 'place' : 'places'} to try</span>
                      </span>
                    </button>
                  );
                })}
                {challenges.map((b) => (
                  <button key={b.id} className="ticket challenge" style={{ '--tint': 'var(--accent)' }} onClick={() => onGo('explore')}>
                    <span className="ticket-stub"><Icon name="medal" size={26} /></span>
                    <span className="ticket-body">
                      <small>Challenge</small>
                      <b>{b.name}</b>
                      <span>{b.description}</span>
                      <span className="ticket-progress">
                        <XpBar percent={(100 * b.value) / b.next_target} label={`${b.name} progress`} />
                        {b.value} / {b.next_target}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* ---------- Your Boston journey ---------- */}
          <section aria-label="Your Boston journey">
            <div className="row-head">
              <h2>Your Boston journey</h2>
              <button className="sec-link" onClick={() => onGo('explore')}>Open map</button>
            </div>
            <div className="pinned-map">
              <JourneyMap
                version={version}
                hoodIds={visited.map((h) => h.id)}
                onSelectPlace={(id) => onExplore({ type: 'place', id })}
              />
            </div>
          </section>

          {/* ---------- Recent adventures ---------- */}
          <section aria-label="Recent adventures">
            <div className="row-head">
              <h2>Recent adventures</h2>
              {journal.entries.length > 0 && <button className="sec-link" onClick={() => onGo('dex')}>My Dex</button>}
            </div>
            {activity.length === 0 ? (
              <p className="muted">
                Nothing yet. Find a place on the <button className="link" onClick={() => onGo('explore')}>Explore map</button> and add it to your dex.
              </p>
            ) : (
              <>
                <ol className="trail">
                  {feed.map((item) => (
                    <li key={item.key} className={`k-${item.kind}`}>
                      {item.kind === 'pet' || item.kind === 'level' ? (
                        <PetArt pet={item.pet} tint={tintOf(item.pet)} className="trail-dot" />
                      ) : (
                        <span className="trail-dot"><Icon name={KIND_ICON[item.kind]} size={15} /></span>
                      )}
                      <div>
                        <p>
                          {item.title}
                          {item.lines && <LineDots lines={item.lines} colors={LINE_COLORS} />}
                          {item.gain && <span className="gain">{item.gain}</span>}
                        </p>
                        <small>{item.sub ? `${item.sub} · ` : ''}{timeAgo(item.at)}</small>
                      </div>
                    </li>
                  ))}
                </ol>
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
