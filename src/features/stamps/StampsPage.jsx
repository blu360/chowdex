import { useEffect, useState } from 'react';
import { getStamps, getRoutes, getStations } from '../../lib/api.js';
import { TIER_COLORS } from '../../lib/lines.js';
import { Cloud, LineCross, Sparkle } from '../../components/Doodles.jsx';

const TIER_LABEL = { none: 'No badge yet', bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const NEXT = { none: ['bronze', 25], bronze: ['silver', 50], silver: ['gold', 100] };

/** Progress drawn like a stretch of subway line: a dashed track, a thick colored line, and a station dot at the end. */
function SubwayProgress({ percent, color }) {
  return (
    <div className="subway" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div className="subway-track" />
      <div className="subway-fill" style={{ width: `${percent}%`, background: color }} />
      <span className="subway-dot" style={{ left: `clamp(13px, ${percent}%, calc(100% - 13px))` }} />
    </div>
  );
}

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

  if (!data) {
    return (
      <div className="page paper">
        <p className="page-inner muted">Loading…</p>
      </div>
    );
  }
  const { stamps, routes, stations } = data;
  const nameById = Object.fromEntries(stations.map((s) => [s.id, s.name]));

  return (
    <div className="page paper">
      <div className="page-inner">
        <section className="hero">
          <div className="hero-text">
            <h1><span className="hl">Station stamps</span></h1>
            <p>Eat within 400 m of a T station to stamp it. Fill a line to earn bronze, silver, and gold badges.</p>
          </div>
          <div className="hero-art" aria-hidden="true">
            <Cloud className="art-cloud" />
            <LineCross className="art-lines" />
            <Sparkle className="art-sparkle" />
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
              <section key={line.id} className="line-card" style={{ boxShadow: `6px 6px 0 ${line.color}` }}>
                <header style={{ background: line.color }}>
                  <h2>{line.name}</h2>
                  <span className="tier" style={{ background: TIER_COLORS[line.tier] }}>
                    {TIER_LABEL[line.tier]}
                  </span>
                </header>
                <div className="line-body">
                  <SubwayProgress percent={line.percent} color={line.color} />
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
                          style={got ? { background: line.color } : undefined}
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
    </div>
  );
}
