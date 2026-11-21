import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCurrentUser,
  getPlace,
  getProfile,
  getStamps,
  signInWithGoogle,
  signOut,
  loadDemoData,
  resetDemoData,
} from './lib/api.js';
import { useRoute } from './lib/route.js';
import MapView from './features/map/MapView.jsx';
import SearchPanel from './features/map/SearchPanel.jsx';
import Legend from './features/map/Legend.jsx';
import { DEFAULT_STYLE_ID, MAP_STYLES } from './features/map/mapStyles.js';
import PlaceCard from './features/place/PlaceCard.jsx';
import StationCard from './features/stamps/StationCard.jsx';
import StampsPage from './features/stamps/StampsPage.jsx';
import HomePage from './features/home/HomePage.jsx';
import DexPage from './features/dex/DexPage.jsx';
import PetsPage from './features/pet/PetsPage.jsx';
import PetProfile from './features/pet/PetProfile.jsx';
import RewardToast from './components/RewardToast.jsx';
import { Icon } from './components/ui.jsx';
import SketchFilters from './components/SketchFilters.jsx';
import TrainTransition, { TRAIN_ORDER, TRANSITION_SWAP_MS, TRANSITION_TOTAL_MS } from './components/TrainTransition.jsx';

const STYLE_KEY = 'chowdex.mapStyle';

/** The main screens, in order. Shown along the top on desktop and as a bottom bar on phones. */
const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'explore', label: 'Explore' },
  { id: 'stamps', label: 'Stamps' },
  { id: 'dex', label: 'My Dex' },
  { id: 'pets', label: 'My Pets' },
];

function loadStyleId() {
  try {
    const saved = localStorage.getItem(STYLE_KEY);
    if (MAP_STYLES.some((s) => s.id === saved)) return saved;
  } catch {
    // storage unavailable: use the default
  }
  return DEFAULT_STYLE_ID;
}

function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" style={{ fill: 'var(--accent)' }} stroke="#111" strokeWidth="2" />
      <path d="M21 11.6a6.4 6.4 0 1 0 0 8.8" fill="none" stroke="#111" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="23.4" cy="16" r="2.4" fill="#ce2634" stroke="#111" strokeWidth="1.4" />
    </svg>
  );
}

export default function App() {
  const [route, go] = useRoute();
  const tab = route.tab;
  const [selected, setSelected] = useState(null); // { type: 'place' | 'station', id }
  const [version, setVersion] = useState(0);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [stampTotal, setStampTotal] = useState(0);
  const [filters, setFilters] = useState({});
  const [layers, setLayers] = useState({ neighborhoods: true, trains: true, simulate: false });
  const [styleId, setStyleId] = useState(loadStyleId);
  const [focus, setFocus] = useState(null);
  const [trainsInfo, setTrainsInfo] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reward, setReward] = useState(null); // what the last logged meal earned

  const [transition, setTransition] = useState(null); // { id, train } while a train is crossing the screen
  const trainCount = useRef(0);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  // Leaving Explore forgets the open place card and the last search focus, so coming back starts fresh.
  // (Jumping to Explore from another screen sets them first and then changes the tab, so that still works.)
  useEffect(() => {
    if (tab !== 'explore') {
      setSelected(null);
      setFocus(null);
    }
  }, [tab]);

  /**
   * Runs `change` while a train drives across the screen: the screen is fully covered when the page
   * underneath swaps. Skipped (change runs right away) for people who prefer reduced motion.
   */
  const withTrain = (change) => {
    if (transition) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      change();
      return;
    }
    const train = TRAIN_ORDER[trainCount.current++ % TRAIN_ORDER.length];
    setTransition({ id: Date.now(), train });
    timers.current.push(
      setTimeout(change, TRANSITION_SWAP_MS),
      setTimeout(() => setTransition(null), TRANSITION_TOTAL_MS),
    );
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([getCurrentUser(), getProfile(), getStamps()]).then(([u, p, s]) => {
      if (cancelled) return;
      setUser(u);
      setProfile(p);
      setStampTotal(s.stamped_total);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const run = (fn) => async () => {
    await fn();
    setSelected(null);
    setReward(null);
    bump();
  };

  const act = (fn) => () => {
    setMenuOpen(false);
    withTrain(run(fn));
  };

  /** Main navigation: the train drives by while the screen changes. */
  const goTo = (next) => {
    setMenuOpen(false);
    if (next !== tab || route.id) withTrain(() => go(next));
  };

  /** Opening a pet (and going back) is a quick in-place change, with no train. */
  const openPet = (id) => go('pets', id);

  const changeStyle = (id) => {
    setStyleId(id);
    try {
      localStorage.setItem(STYLE_KEY, id);
    } catch {
      // not persisted, still applied
    }
  };

  const selectPlace = (id) => setSelected({ type: 'place', id });
  const selectStation = (id) => setSelected({ type: 'station', id });

  const pick = (target) => {
    setFocus({ ...target, nonce: Date.now() });
    if (target.type === 'place') selectPlace(target.id);
    else if (target.type === 'station') selectStation(target.id);
    else setSelected(null);
  };

  /** Jump to the Explore map from another screen, focused on a place or a neighborhood. */
  const exploreTo = async (target) => {
    let resolved = target;
    if (target.type === 'place' && !target.center) {
      try {
        const place = await getPlace(target.id);
        resolved = { ...target, center: [place.lng, place.lat] };
      } catch {
        resolved = null;
      }
    }
    if (resolved) pick(resolved);
    go('explore');
  };

  /** A meal was logged from the place card: refresh everything and celebrate what it earned. */
  const onDexChange = (result) => {
    bump();
    if (result?.entry) setReward(result);
  };

  const signedIn = Boolean(user);
  const onSignIn = act(signInWithGoogle);
  const onDemo = act(loadDemoData);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => goTo('home')} aria-label="Chowdex home">
          <Logo />
          <span className="brand-name">Chow<b>dex</b></span>
        </button>

        <nav className="tabs" aria-label="Main">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? 'tab active' : 'tab'}
              aria-current={tab === n.id ? 'page' : undefined}
              onClick={() => goTo(n.id)}
            >
              <Icon name={n.id} size={16} />
              {n.label}
            </button>
          ))}
        </nav>

        <div className="account">
          {profile && (
            <button className="trainer-chip" onClick={() => goTo('home')} title="Explorer level, XP, and stations stamped">
              <b>Lv {profile.level}</b>
              <span>{profile.xp} XP</span>
              <span className="wide-only">{stampTotal} stamps</span>
            </button>
          )}
          <button
            className={menuOpen ? 'avatar-btn on' : 'avatar-btn'}
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label="Account menu"
          >
            {user ? user.display_name.slice(0, 1) : <Icon name="user" size={18} />}
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              {user && <p className="menu-name">{user.display_name}<small>{user.email}</small></p>}
              {user ? (
                <button className="btn btn-small" onClick={act(signOut)}>Sign out</button>
              ) : (
                <button className="btn btn-small btn-solid" onClick={onSignIn}>Sign in with Google</button>
              )}
              <button className="btn btn-small btn-quiet" onClick={onDemo} title="Mock mode: fill the dex with sample places">
                Load demo data
              </button>
              {user && <button className="btn btn-small btn-quiet" onClick={act(resetDemoData)}>Reset</button>}            </div>
          )}
        </div>
      </header>

      <main className="main" onClick={menuOpen ? () => setMenuOpen(false) : undefined}>
        {tab === 'home' && (
          <HomePage
            version={version}
            user={user}
            profile={profile}
            onOpenPet={openPet}
            onGo={goTo}
            onExplore={exploreTo}
            onSignIn={onSignIn}
            onDemo={onDemo}
          />
        )}

        {tab === 'explore' && (
          <div className="map-page">
            <MapView
              version={version}
              filters={filters}
              focus={focus}
              styleId={styleId}
              layers={layers}
              onSelectPlace={selectPlace}
              onSelectStation={selectStation}
              onTrainsInfo={setTrainsInfo}
            />
            <SearchPanel
              filters={filters}
              onFilters={setFilters}
              layers={layers}
              onLayers={setLayers}
              styleId={styleId}
              onStyleId={changeStyle}
              trainsInfo={trainsInfo}
              onPick={pick}
            />
            <Legend />
            {selected?.type === 'place' && (
              <PlaceCard
                placeId={selected.id}
                signedIn={signedIn}
                onClose={() => setSelected(null)}
                onDexChange={onDexChange}
                onSignIn={onSignIn}
              />
            )}
            {selected?.type === 'station' && (
              <StationCard stationId={selected.id} onClose={() => setSelected(null)} onSelectPlace={selectPlace} />
            )}
          </div>
        )}

        {tab === 'stamps' && <StampsPage version={version} signedIn={signedIn} />}

        {tab === 'dex' && (
          <DexPage
            version={version}
            signedIn={signedIn}
            onChange={bump}
            onExplore={exploreTo}
            onGo={goTo}
            onSignIn={onSignIn}
            onDemo={onDemo}
          />
        )}

        {tab === 'pets' &&
          (route.id ? (
            <PetProfile
              petId={route.id}
              version={version}
              signedIn={signedIn}
              onBack={() => go('pets')}
              onChange={bump}
              onExplore={exploreTo}
              onGo={goTo}
            />
          ) : (
            <PetsPage version={version} signedIn={signedIn} onOpenPet={openPet} />
          ))}

        {reward && <RewardToast reward={reward} onClose={() => setReward(null)} onOpenPet={openPet} />}
      </main>

      <nav className="bottom-nav" aria-label="Main">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={tab === n.id ? 'active' : undefined}
            aria-current={tab === n.id ? 'page' : undefined}
            onClick={() => goTo(n.id)}
          >
            <span className="ico"><Icon name={n.id} size={20} /></span>
            {n.label}
          </button>
        ))}
      </nav>

      <SketchFilters />
      {transition && <TrainTransition key={transition.id} train={transition.train} />}
    </div>
  );
}
