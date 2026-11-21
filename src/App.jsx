import { useCallback, useEffect, useState } from 'react';
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
import PlaceCard from './features/place/PlaceCard.jsx';
import StationCard from './features/stamps/StationCard.jsx';
import StampsPage from './features/stamps/StampsPage.jsx';

export default function App() {
  const [tab, setTab] = useState('map');
  const [selected, setSelected] = useState(null); // { type: 'place' | 'station', id }
  const [version, setVersion] = useState(0);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [stampTotal, setStampTotal] = useState(0);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

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

  const selectPlace = (id) => setSelected({ type: 'place', id });
  const selectStation = (id) => setSelected({ type: 'station', id });

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="led" aria-hidden="true" />
          <span className="brand-name">Bos(tons) of Eats and Streets</span>
        </div>

        <nav className="tabs" aria-label="Main">
          <button className={tab === 'map' ? 'tab active' : 'tab'} onClick={() => setTab('map')}>Map</button>
          <button className={tab === 'stamps' ? 'tab active' : 'tab'} onClick={() => setTab('stamps')}>Stamps</button>
        </nav>

        <div className="account">
          {profile && (
            <span className="stats" title="Trainer level, XP, and stations stamped">
              Lv {profile.level} · {profile.xp} XP · {stampTotal} stamps
            </span>
          )}
          {user ? (
            <button className="btn btn-small" onClick={run(signOut)}>Sign out</button>
          ) : (
            <button className="btn btn-small" onClick={run(signInWithGoogle)}>Sign in with Google (mock)</button>
          )}
          <button className="btn btn-small btn-ghost-light" onClick={run(loadDemoData)}>Load demo data</button>
          {user && <button className="btn btn-small btn-ghost-light" onClick={run(resetDemoData)}>Reset</button>}
        </div>
      </header>

      <main className="main">
        {tab === 'map' ? (
          <div className="map-page">
            <MapView version={version} onSelectPlace={selectPlace} onSelectStation={selectStation} />
            {selected?.type === 'place' && (
              <PlaceCard
                placeId={selected.id}
                signedIn={Boolean(user)}
                onClose={() => setSelected(null)}
                onDexChange={bump}
                onSignIn={run(signInWithGoogle)}
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
    </div>
  );
}
