import { useEffect, useState } from 'react';
import { IS_MOCK, getCampusBoard, getCampusPopular, getPlaces } from '../../lib/api.js';
import { Icon, XpBar } from '../../components/ui.jsx';
import { SCHOOLS } from '../../lib/schools.js';

const BOARD_SHOWN = 5;

/**
 * This week's campus challenge. It rotates every week and is always something the whole school does
 * together; progress is the school's row on the leaderboard, so nothing extra is stored.
 */
const CHALLENGES = [
  { key: 'neighborhoods', target: 8, title: 'Eat in 8 different neighborhoods', unit: 'neighborhoods' },
  { key: 'places', target: 20, title: 'Try 20 different places', unit: 'places' },
  { key: 'explorers', target: 10, title: 'Get 10 students logging a meal', unit: 'students' },
];
const weekNumber = (d = new Date()) => Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 1).getTime()) / (7 * 86400000));

const schoolName = (id) => SCHOOLS.find((s) => s.id === id)?.name ?? id;

/**
 * Your campus: a weekly challenge for the whole school, the school leaderboard, and the places your
 * school's students log most. Shown on Home once the user has a school (from onboarding).
 */
export default function CampusCard({ version, school, signedIn, onSetup, onExplore }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!school) return undefined;
    let cancelled = false;
    Promise.all([getCampusBoard(), getCampusPopular(school.id, { limit: 3 }), getPlaces()])
      .then(([board, popular, places]) => {
        if (cancelled) return;
        const byId = new Map(places.map((p) => [p.id, p]));
        setData({ board, popular: popular.map((r) => ({ ...r, place: byId.get(r.place_id) })).filter((r) => r.place) });
      })
      .catch(() => !cancelled && setData({ board: [], popular: [] }));
    return () => {
      cancelled = true;
    };
  }, [version, school?.id]);

  if (!signedIn) return null;

  if (!school) {
    return (
      <section className="card area-campus campus-empty" aria-label="Your campus">
        <div>
          <h2>Join your campus</h2>
          <p className="muted">Pick your school to see its leaderboard, weekly challenge, and what classmates are eating.</p>
        </div>
        <button className="btn btn-solid" onClick={onSetup}>Pick my school</button>
      </section>
    );
  }
  if (!data) return null;

  const { board, popular } = data;
  const rank = board.findIndex((r) => r.school_id === school.id);
  const mine = rank >= 0 ? board[rank] : { neighborhoods: 0, places: 0, explorers: 0, meals: 0 };
  const top = board.slice(0, BOARD_SHOWN);
  const challenge = CHALLENGES[weekNumber() % CHALLENGES.length];
  const value = mine[challenge.key] ?? 0;
  const done = value >= challenge.target;

  return (
    <section className="card area-campus" aria-label="Your campus">
      <div className="sec-head">
        <h2>{school.name}</h2>
        <span className="muted small">This week{IS_MOCK ? ' · sample data' : ''}</span>
      </div>

      {/* Weekly challenge */}
      <div className={done ? 'campus-challenge done' : 'campus-challenge'}>
        <p>
          <b>Campus challenge:</b> {challenge.title}
          {done && <span className="challenge-done"><Icon name="check" size={13} />Done</span>}
        </p>
        <div className="badge-progress">
          <XpBar percent={(100 * value) / challenge.target} label="Campus challenge progress" />
          <span>{Math.min(value, challenge.target)} / {challenge.target} {challenge.unit}</span>
        </div>
      </div>

      {/* Leaderboard */}
      <h3 className="label">Campus leaderboard</h3>
      {board.length === 0 ? (
        <p className="muted small">No school has logged a meal this week yet. Be the first.</p>
      ) : (
        <ol className="board">
          {top.map((r, i) => (
            <li key={r.school_id} className={r.school_id === school.id ? 'me' : undefined}>
              <b>{i + 1}</b>
              <span>{schoolName(r.school_id)}</span>
              <small>{r.neighborhoods} areas · {r.places} places</small>
            </li>
          ))}
          {rank >= BOARD_SHOWN && (
            <li className="me">
              <b>{rank + 1}</b>
              <span>{school.name}</span>
              <small>{mine.neighborhoods} areas · {mine.places} places</small>
            </li>
          )}
        </ol>
      )}

      {/* Popular with your school */}
      {popular.length > 0 && (
        <>
          <h3 className="label">Popular with {school.name} students</h3>
          <ul className="next-list">
            {popular.map((r) => (
              <li key={r.place_id}>
                <button onClick={() => onExplore({ type: 'place', id: r.place.id, center: [r.place.lng, r.place.lat] })}>
                  <span className="next-ico"><Icon name="meal" size={18} /></span>
                  <span>
                    <b>{r.place.name}</b>
                    <small>
                      {r.meals} {r.meals === 1 ? 'visit' : 'visits'}
                      {r.rating != null ? ` · ★ ${r.rating.toFixed(1)}` : ''}
                      {r.place.neighborhood ? ` · ${r.place.neighborhood.name}` : ''}
                    </small>
                  </span>
                  <Icon name="next" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
