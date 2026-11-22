import { useEffect, useMemo, useRef, useState } from 'react';
import { getDirections, getStations, logTrip } from '../../lib/api.js';
import { routeToGeoJSON } from '../../lib/directions.js';
import { Icon } from '../../components/ui.jsx';

const ORIGIN_KEY = 'chowdex.lastOrigin';
const DEFAULT_STATION = 'place-pktrm'; // Park Street: the middle of the system
const NEAR_BOSTON_M = 20000; // farther than this from every station and "current location" is no use for a trip here

const fmtMiles = (m) => (m < 0.1 ? '<0.1' : m.toFixed(1));
const fmtKg = (kg) => (kg < 0.1 ? kg.toFixed(2) : kg.toFixed(1));

function loadStation() {
  try {
    return localStorage.getItem(ORIGIN_KEY) || DEFAULT_STATION;
  } catch {
    return DEFAULT_STATION;
  }
}

/** A clock time like "6:08 PM", in Boston time (the MBTA's clock). */
const fmtClock = (iso) =>
  new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

const REFRESH_MS = 30000; // live times and the ETA are re-checked this often while the panel is open

const metersBetween = (a, b) => Math.hypot((a.lng - b.lng) * 82400, (a.lat - b.lat) * 111200);

/** One line of the step-by-step list, with a colored marker for the line. */
function Step({ color, time, live, children }) {
  return (
    <li className="dir-step">
      <span className="dir-dot" style={{ background: color ?? 'var(--gray)' }} aria-hidden="true" />
      <span className="dir-text">{children}</span>
      {time != null && (
        <span className="dir-time">
          {live && <i className="dir-live" title="Live MBTA time" />}
          {time}
        </span>
      )}
    </li>
  );
}

/**
 * Directions to a restaurant by T and on foot, starting from where the rider is. The position is read in the
 * browser when the panel opens, is never saved, and is blurred before it reaches the walking router. If location is
 * off (or the rider is not near Boston) they can pick a station to start from instead.
 * "I took this trip" adds it to their green-trips log, which is entirely their choice.
 */
export default function DirectionsPanel({ placeId, onRoute, onLogged }) {
  const [stations, setStations] = useState([]);
  const [fromId, setFromId] = useState(loadStation);
  const [point, setPoint] = useState(null); // { lat, lng } once we have the rider's position
  const [locating, setLocating] = useState(true);
  const [note, setNote] = useState(null); // why we are asking for a station instead
  const [useStation, setUseStation] = useState(false);
  const [route, setRoute] = useState(null);
  const [status, setStatus] = useState('loading');
  const [logged, setLogged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const shownFor = useRef(null); // which trip the shown route is for, so a refresh does not flash "Finding the way"

  useEffect(() => {
    getStations().then((list) => setStations([...list].sort((a, b) => a.name.localeCompare(b.name))));
  }, []);

  function locate() {
    setNote(null);
    if (!navigator.geolocation) {
      setLocating(false);
      setUseStation(true);
      setNote('This browser cannot share your location, so choose where you are starting.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const all = await getStations();
        const closest = Math.min(...all.map((s) => metersBetween(here, s)));
        setLocating(false);
        if (closest > NEAR_BOSTON_M) {
          setUseStation(true);
          setNote("You're not near Boston, so choose a station to start from.");
        } else {
          setPoint(here);
          setUseStation(false);
        }
      },
      () => {
        setLocating(false);
        setUseStation(true);
        setNote('Location is off, so choose where you are starting.');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  }

  useEffect(() => {
    locate();
  }, []);

  // Where the trip starts: the rider's position if we have it, otherwise the chosen station.
  const origin = useStation || !point ? { stationId: fromId } : point;
  const originKey = locating ? null : JSON.stringify(origin);

  useEffect(() => {
    if (originKey === null) return undefined;
    let cancelled = false;
    const tripKey = `${placeId}|${originKey}`;
    const isRefresh = shownFor.current === tripKey; // same trip as what is on screen: update quietly
    if (!isRefresh) {
      setStatus('loading');
      setLogged(false);
    }
    getDirections(placeId, JSON.parse(originKey))
      .then((r) => {
        if (cancelled) return;
        shownFor.current = tripKey;
        setRoute(r);
        setStatus('ready');
      })
      .catch(() => !cancelled && !isRefresh && setStatus('error'));
    return () => {
      cancelled = true;
    };
  }, [placeId, originKey, tick]);

  // Keep the live times and the ETA fresh while the panel is open.
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  // Draw the route on the map while it is showing, and clear it when the panel goes away.
  const geojson = useMemo(() => (route ? routeToGeoJSON(route) : null), [route]);
  useEffect(() => {
    onRoute(status === 'ready' ? geojson : null);
  }, [geojson, status]);
  useEffect(() => () => onRoute(null), []);

  function chooseStation(id) {
    setFromId(id);
    try {
      localStorage.setItem(ORIGIN_KEY, id);
    } catch {
      // not remembered, still applied
    }
  }

  async function handleLog() {
    setBusy(true);
    try {
      await logTrip(route);
      setLogged(true);
      onLogged?.();
    } finally {
      setBusy(false);
    }
  }

  const em = route?.emissions;
  const transitBar = em && em.car_kg > 0 ? Math.max(4, Math.min(100, (100 * em.transit_kg) / em.car_kg)) : 0;
  const savesSomething = em && em.saved_kg >= 0.05;
  const walkOnly = route?.mode === 'walk';

  return (
    <section className="directions" aria-label="Directions">
      {locating ? (
        <p className="muted dir-note">Finding where you are…</p>
      ) : useStation ? (
        <div className="dir-from">
          <label>
            <span>Starting from</span>
            <select value={fromId} onChange={(e) => chooseStation(e.target.value)}>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.lines.join(', ')})
                </option>
              ))}
            </select>
          </label>
          {note && <p className="muted small">{note}</p>}
          <button className="link" onClick={locate}>Use my current location</button>
        </div>
      ) : (
        <p className="dir-origin">
          From <b>your current location</b>
          <button className="link" onClick={() => setUseStation(true)}>Choose a station instead</button>
        </p>
      )}

      {!locating && status === 'loading' && <p className="muted dir-note">Finding the way…</p>}
      {!locating && status === 'error' && <p className="error">Could not work out a route from here.</p>}

      {!locating && status === 'ready' && route && (
        <>
          <p className="dir-headline">
            <span className="dir-arrive"><small>Arrive</small><strong>{fmtClock(route.arrive_at)}</strong></span>
            <span className="dir-total">{route.totals.minutes} min {walkOnly ? 'on foot' : 'by T and on foot'}</span>
            {route.live && <span className="dir-live-tag"><i className="dir-live" /> Live MBTA times</span>}
          </p>

          <ol className="dir-steps">
            {route.legs.map((leg, i) => {
              const isLast = i === route.legs.length - 1;
              if (leg.type === 'walk') {
                return (
                  <Step key={i} time={`${Math.max(1, Math.round(leg.minutes))} min`}>
                    Walk {fmtMiles(leg.distance_m / 1609.344)} mi to <b>{isLast ? route.to.name : leg.to.name}</b>
                  </Step>
                );
              }
              if (leg.type === 'board') {
                return (
                  <Step key={i} color={leg.color} time={leg.wait_source === 'live' ? `${leg.minutes} min` : `~${leg.minutes} min`} live={leg.wait_source === 'live'}>
                    {leg.wait_source === 'live' ? (
                      <>Next <b>{leg.line_name}</b> at {leg.at.name}<small className="dir-clock"> · leaves {fmtClock(leg.departs_at)}</small></>
                    ) : (
                      <>Wait for the <b>{leg.line_name}</b> at {leg.at.name}</>
                    )}
                  </Step>
                );
              }
              if (leg.type === 'ride') {
                return (
                  <Step key={i} color={leg.color} time={`${Math.max(1, Math.round(leg.minutes))} min`} live={leg.live}>
                    Ride {leg.stops} {leg.stops === 1 ? 'stop' : 'stops'} to <b>{leg.to.name}</b>
                  </Step>
                );
              }
              return (
                <Step key={i} time={`${Math.round(leg.minutes)} min`}>
                  Change to the <b>{leg.to_line} Line</b> at {leg.at.name}
                </Step>
              );
            })}
          </ol>

          <div className="dir-compare">
            <h4><Icon name="leaf" size={15} /> Carbon emissions</h4>
            <div className="dir-bar-row">
              <span className="dir-bar-label">Car</span>
              <span className="dir-bar"><i className="car" style={{ width: '100%' }} /></span>
              <span className="dir-bar-value">{fmtKg(em.car_kg)} kg CO₂</span>
            </div>
            <div className="dir-bar-row">
              <span className="dir-bar-label">{walkOnly ? 'Walk' : 'T + walk'}</span>
              <span className="dir-bar"><i className="green" style={{ width: `${walkOnly ? 0 : transitBar}%` }} /></span>
              <span className="dir-bar-value">{fmtKg(em.transit_kg)} kg CO₂</span>
            </div>
            {savesSomething && (
              <p className="dir-saves">
                <Icon name="check" size={18} /> <span><b>{fmtKg(em.saved_kg)} kg CO₂ saved</b> vs driving ({em.percent}% less)</span>
              </p>
            )}
          </div>

          <div className="dir-actions">
            {logged ? (
              <p className="collected">✓ Added to your green trips</p>
            ) : (
              <button className="btn btn-primary" onClick={handleLog} disabled={busy}>
                I took this trip
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
