import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCurrentUser,
  getProfile,
  getStamps,
  signInWithGoogle,
  signOut,
  loadDemoData,
  resetDemoData,
} from './lib/api.js';
import MapView from './features/map/MapView.jsx';
import SearchPanel from './features/map/SearchPanel.jsx';
import Legend from './features/map/Legend.jsx';
import { DEFAULT_STYLE_ID, MAP_STYLES } from './features/map/mapStyles.js';
import PlaceCard from './features/place/PlaceCard.jsx';
import StationCard from './features/stamps/StationCard.jsx';
import StampsPage from './features/stamps/StampsPage.jsx';
import TrainTransition, { TRAIN_ORDER, TRANSITION_SWAP_MS, TRANSITION_TOTAL_MS } from './components/TrainTransition.jsx';

const STYLE_KEY = 'chowdex.mapStyle';

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
    <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="#f7dd04" stroke="#111" strokeWidth="2" />
      <path d="M21 11.6a6.4 6.4 0 1 0 0 8.8" fill="none" stroke="#111" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="23.4" cy="16" r="2.4" fill="#ce2634" stroke="#111" strokeWidth="1.4" />
    </svg>
  );
}

export default function App() {
  const [tab, setTab] = useState('map');
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

  const [transition, setTransition] = useState(null); // { id, train } while a train is crossing the screen
  const trainCount = useRef(0);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

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
    bump();
  };

  const act = (fn) => () => withTrain(run(fn));
  const goTo = (next) => {
    if (next !== tab) withTrain(() => setTab(next));
  };

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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo />
          <span className="brand-name">Chowdex</span>
        </div>

        <nav className="tabs" aria-label="Main">
          <button className={tab === 'map' ? 'tab active' : 'tab'} onClick={() => goTo('map')}>Map</button>
          <button className={tab === 'stamps' ? 'tab active' : 'tab'} onClick={() => goTo('stamps')}>Stamps</button>
        </nav>

        <div className="account">
          {profile && (
            <span className="stats" title="Trainer level, XP, and stations stamped">
              <b>Lv {profile.level}</b>
              <span>{profile.xp} XP</span>
              <span>{stampTotal} stamps</span>
            </span>
          )}
          {user ? (
            <button className="btn btn-small" onClick={act(signOut)}>Sign out</button>
          ) : (
            <button className="btn btn-small btn-solid" onClick={act(signInWithGoogle)}>Sign in with Google</button>
          )}
          <button className="btn btn-small btn-quiet" onClick={act(loadDemoData)} title="Mock mode: fill the dex with sample places">
            Demo data
          </button>
          {user && <button className="btn btn-small btn-quiet" onClick={act(resetDemoData)}>Reset</button>}
        </div>
      </header>

      <main className="main">
        {tab === 'map' ? (
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
                signedIn={Boolean(user)}
                onClose={() => setSelected(null)}
                onDexChange={bump}
                onSignIn={act(signInWithGoogle)}
              />
            )}
            {selected?.type === 'station' && (
              <StationCard stationId={selected.id} onClose={() => setSelected(null)} onSelectPlace={selectPlace} />
            )}
          </div>
        ) : (
          <StampsPage version={version} signedIn={Boolean(user)} />
        )}
      </main>

      {transition && <TrainTransition key={transition.id} train={transition.train} />}
    </div>
  );
}
