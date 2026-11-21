import { useEffect, useState } from 'react';
import { getStamps, getRoutes, getStations } from '../../lib/api.js';
import { TIER_COLORS } from '../../lib/lines.js';

const TIER_LABEL = { none: 'No badge yet', bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const NEXT = { none: ['bronze', 25], bronze: ['silver', 50], silver: ['gold', 100] };

export default function StampsPage({ version, signedIn }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getStamps(), getRoutes(), getStations()]).then(([stamps, routes, stations]) => {
      if (!cancelled) setData({ stamps, routes, stations });
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;
  const { stamps, routes, stations } = data;
  const nameById = Object.fromEntries(stations.map((s) => [s.id, s.name]));

  return (
    <div className="page">
      <section className="hero">
        <div>
          <h1>Station stamps</h1>
          <p className="muted">
            Eat within 400 m of a T station to stamp it. Fill a line to earn bronze, silver, and gold badges.
          </p>
        </div>
        <div className="big-count">
          <strong>{stamps.stamped_total}</strong>
          <span>of {stamps.station_total} stations</span>
        </div>
      </section>

      {!signedIn && (
        <p className="notice">Sign in (or load the demo data) to start collecting stamps.</p>
      )}

      <div className="line-grid">
        {stamps.lines.map((line) => {
          const route = routes.find((r) => r.id === line.id);
          const next = NEXT[line.tier];
          return (
            <section key={line.id} className="line-card">
              <header style={{ background: line.color }}>
                <h2>{line.name}</h2>
                <span className="tier" style={{ background: TIER_COLORS[line.tier] }}>
                  {TIER_LABEL[line.tier]}
                </span>
              </header>
              <div className="line-body">
                <div className="progress" role="progressbar" aria-valuenow={line.percent} aria-valuemin={0} aria-valuemax={100}>
                  <div style={{ width: `${line.percent}%`, background: line.color }} />
                </div>
                <p>
                  <strong>{line.stamped}</strong> / {line.total} stations · {line.percent}%
                  {next && <span className="muted"> · {next[0]} at {next[1]}%</span>}
                </p>
                <ul className="stamp-grid">
                  {route.station_ids.map((id) => {
                    const got = Boolean(stamps.by_station[id]);
                    return (
                      <li
                        key={id}
                        className={got ? 'stamp got' : 'stamp'}
                        style={got ? { background: line.color, borderColor: line.color } : { borderColor: '#cfc8bb' }}
                        title={`${nameById[id]}${got ? ' (stamped)' : ''}`}
                      >
                        {nameById[id]}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
