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
} from '../../lib/api.js';
import { LINE_COLORS, TIER_COLORS } from '../../lib/lines.js';
import { Icon, LevelPill, LineDots, PetArt, XpBar } from '../../components/ui.jsx';
import { boundsOfFeature, buildActivity, petProgress, timeAgo, trainerProgress } from '../../lib/game.js';
import JourneyMap from '../map/JourneyMap.jsx';
import PetCard, { homeOf } from '../pet/PetCard.jsx';
import { STARTER_TINT, tintsFor } from '../pet/PetsPage.jsx';
import { loreFor } from '../pet/petLore.js';

const PARTY_SIZE = 5; // pets shown next to the buddy before "see all"
const FEED_PREVIEW = 6;
const KIND_ICON = { meal: 'meal', stamp: 'stamps', level: 'bolt', badge: 'medal' };

/** The hub: your pets first, then how far you have explored and what happened lately. */
export default function HomePage({ version, user, profile, onOpenPet, onGo, onExplore, onSignIn, onDemo }) {
  const [data, setData] = useState(null);
  const [allFeed, setAllFeed] = useState(false);

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

  const { pets, hoods, stamps, journal, feeding, places, hoodGeo, tints, activity } = data;
  const signedIn = Boolean(user);
  const tintOf = (pet) => tints[pet.id] ?? STARTER_TINT;

  const mine = pets.filter((p) => p.unlocked);
  const buddy = mine.find((p) => p.active) ?? mine[0];
  const party = mine
    .filter((p) => p.id !== buddy.id)
    .sort((a, b) => b.level - a.level || b.xp - a.xp || (b.unlocked_at ?? '').localeCompare(a.unlocked_at ?? ''));
  const buddyProgress = petProgress(buddy);

  const trainer = trainerProgress(profile?.xp ?? 0);
  const visited = hoods.filter((h) => h.visited);
  const placeCount = new Set(journal.entries.map((e) => e.place.id)).size;

  // Where next: neighborhoods you have not eaten in yet that have places to try, most options first.
  const placesByHood = {};
  for (const p of places) if (p.neighborhood) placesByHood[p.neighborhood.id] = (placesByHood[p.neighborhood.id] ?? 0) + 1;
  const nextUp = hoods
    .filter((h) => !h.visited && placesByHood[h.id])
    .sort((a, b) => placesByHood[b.id] - placesByHood[a.id] || a.name.localeCompare(b.name))
    .slice(0, 3);
  const exploreHood = (id) => {
    const feature = hoodGeo.features.find((f) => f.properties.id === id);
    if (feature) onExplore({ type: 'neighborhood', bounds: boundsOfFeature(feature) });
  };

  const feed = allFeed ? activity.slice(0, 20) : activity.slice(0, FEED_PREVIEW);

  return (
    <div className="page paper">
      <div className="page-inner home rise">
        {/* ---------- You ---------- */}
        <section className="card overview span">
          {signedIn ? (
            <>
              <span className="avatar" aria-hidden="true">{user.display_name.slice(0, 1)}</span>
              <div className="overview-main">
                <p className="overview-name">
                  {user.display_name} <span className="lv-pill" title="Your explorer level grows with every meal that fed your pets">Explorer Lv {trainer.level}</span>
                </p>
                <div className="xp-row">
                  <XpBar percent={trainer.percent} label="XP toward the next explorer level" />
                  <span>{trainer.xp} / {trainer.next} XP</span>
                </div>
              </div>
              <div className="stat-chips">
                <span className="stat-chip"><b>{placeCount}</b> places</span>
                <span className="stat-chip"><b>{stamps.stamped_total}</b> / {stamps.station_total} stamps</span>
                <span className="stat-chip"><b>{visited.length}</b> / {hoods.length} areas</span>
                <span className={feeding.full ? 'stat-chip fed full' : 'stat-chip fed'} title="Only the first meals each day feed your pets">
                  <Icon name="meal" size={14} />
                  {feeding.full ? 'Pets are full today' : `${feeding.remaining} ${feeding.remaining === 1 ? 'feeding' : 'feedings'} left today`}
                </span>
              </div>
            </>
          ) : (
            <>
              <span className="avatar" aria-hidden="true"><Icon name="user" size={22} /></span>
              <div className="overview-main">
                <p className="overview-name">Welcome to Chowdex</p>
                <p className="muted">Eat around Boston, stamp T stations, and collect a pet in every neighborhood.</p>
              </div>
              <div className="overview-actions">
                <button className="btn btn-solid" onClick={onSignIn}>Sign in with Google</button>
                <button className="btn" onClick={onDemo} title="Mock mode: fill the dex with sample places">Try demo data</button>
              </div>
            </>
          )}
        </section>

        {/* ---------- My pets ---------- */}
        <section className="pets-section area-pets">
          <div className="sec-head">
            <h2>My Pets</h2>
            <button className="sec-link" onClick={() => onGo('pets')}>
              All pets · {mine.length} / {pets.length}
            </button>
          </div>

          <button className="buddy" style={{ '--tint': tintOf(buddy) }} onClick={() => onOpenPet(buddy.id)}>
            <PetArt pet={buddy} tint={tintOf(buddy)} />
            <span className="buddy-info">
              <span className="buddy-tag">Your buddy</span>
              <span className="pet-name">{buddy.display_name}</span>
              <span className="pet-species">
                {buddy.nickname && <>{buddy.name} <span aria-hidden="true">·</span></>} <LevelPill level={buddy.level} max={buddy.max_level} />
              </span>
              <XpBar percent={buddyProgress.percent} label={`${buddy.display_name} XP`} />
              <span className="pet-xp">{buddyProgress.label}</span>
              <span className="where"><Icon name="pin" size={13} />{homeOf(buddy)}</span>
              <span className="buddy-blurb">{loreFor(buddy.id).blurb}</span>
            </span>
          </button>

          <div className="party">
            {party.slice(0, PARTY_SIZE).map((pet) => (
              <PetCard key={pet.id} pet={pet} tint={tintOf(pet)} onOpen={onOpenPet} />
            ))}
            <button className="pet-card more" onClick={() => onGo('pets')}>
              <span className="more-count">{pets.length - mine.length}</span>
              <span className="pet-name">more to discover</span>
              <span className="where">See the whole collection <Icon name="next" size={13} /></span>
            </button>
          </div>
        </section>

        {/* On wide screens the journey sits in the right column beside the pets and the activity feed. */}
        <>
          {/* ---------- Your Boston journey ---------- */}
          <section className="card area-journey">
            <div className="sec-head">
              <h2>Your Boston Journey</h2>
              <button className="sec-link" onClick={() => onGo('explore')}>Open map</button>
            </div>
            <JourneyMap
              version={version}
              hoodIds={visited.map((h) => h.id)}
              onSelectPlace={(id) => onExplore({ type: 'place', id })}
            />
            <div className="journey-bar">
              <XpBar percent={(100 * visited.length) / hoods.length} label="Neighborhoods explored" />
              <span><b>{visited.length}</b> of {hoods.length} neighborhoods explored</span>
            </div>
            <button className="mini-lines" onClick={() => onGo('stamps')} aria-label="Open station stamps">
              {stamps.lines.map((line) => (
                <span key={line.id} className="mini-line">
                  <span className="mini-line-top">
                    <b style={{ background: line.color }} />
                    {line.id}
                    {line.tier !== 'none' && <em style={{ background: TIER_COLORS[line.tier] }}>{line.tier}</em>}
                  </span>
                  <XpBar percent={line.percent} color={line.color} label={`${line.name} stations stamped`} />
                  <small>{line.stamped} / {line.total}</small>
                </span>
              ))}
            </button>

            {nextUp.length > 0 && (
              <>
                <h3 className="label">Where next</h3>
                <ul className="next-list">
                  {nextUp.map((h) => {
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
                </ul>
              </>
            )}
          </section>

          {/* ---------- Recent activity ---------- */}
          <section className="card area-activity">
            <div className="sec-head">
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
        </>
      </div>
    </div>
  );
}
