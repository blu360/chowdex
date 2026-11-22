import { useEffect, useMemo, useState } from 'react';
import { getBadges, getPetJournal, getPets, getStamps, getTrips } from '../../lib/api.js';
import { Icon, PetArt } from '../../components/ui.jsx';
import { titleCase } from '../../lib/game.js';
import { buildRecap, previousSemester, semesterOf } from '../../lib/semester.js';
import { drawRecapImage } from './recapImage.js';

/**
 * The semester recap: what you ate, where you went, and who joined you this semester, on one card
 * you can save as an image or share. Everything is counted from your own journal.
 */
export default function SemesterRecap({ user, school, onClose }) {
  const [data, setData] = useState(null);
  const [semester, setSemester] = useState(() => semesterOf());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPetJournal('starter'), getPets(), getBadges(), getStamps(), getTrips()]).then(
      ([journal, pets, badges, stamps, trips]) => !cancelled && setData({ entries: journal.entries, pets, badges, stamps, trips }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const recap = useMemo(() => (data ? buildRecap({ semester, ...data }) : null), [data, semester]);
  const current = semesterOf();
  const previous = previousSemester(current);
  const hasPrevious = data?.entries.some((e) => e.visited_at >= previous.start && e.visited_at < previous.end);

  /** Draw the card to an image, then share it (phones) or download it. */
  const exportImage = async (share) => {
    setBusy(true);
    setMessage(null);
    try {
      const blob = await drawRecapImage({ recap, name: user.display_name, school: school?.name ?? null });
      const file = new File([blob], `chowdex-${recap.semester.id}.png`, { type: 'image/png' });
      if (share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `My ${recap.semester.label} on Chowdex` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setMessage(share ? 'Sharing is not available in this browser, so the image was saved instead.' : 'Saved to your downloads.');
      }
    } catch (err) {
      if (err.name !== 'AbortError') setMessage('Could not make the image. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboard-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="onboard recap" role="dialog" aria-modal="true" aria-labelledby="recap-title">
        <header className="onboard-head">
          <div className="chip-row">
            <button className={semester.id === current.id ? 'chip-btn on' : 'chip-btn'} onClick={() => setSemester(current)}>{current.label}</button>
            {hasPrevious && (
              <button className={semester.id === previous.id ? 'chip-btn on' : 'chip-btn'} onClick={() => setSemester(previous)}>{previous.label}</button>
            )}
          </div>
          <button className="panel-close recap-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="onboard-body">
          {!recap ? (
            <p className="muted">Loading…</p>
          ) : recap.meals === 0 ? (
            <>
              <h2 id="recap-title">{recap.semester.label}</h2>
              <p className="muted">No meals logged this semester yet. Log one on the Explore map and your recap starts filling in.</p>
            </>
          ) : (
            <>
              <div className="recap-card">
                <p className="recap-kicker">Chowdex recap</p>
                <h2 id="recap-title">{recap.semester.label}</h2>
                <p className="muted small">{user.display_name}{school ? ` · ${school.name}` : ''}</p>

                <dl className="recap-stats">
                  <div><dd>{recap.meals}</dd><dt>{recap.meals === 1 ? 'meal' : 'meals'}</dt></div>
                  <div><dd>{recap.places}</dd><dt>{recap.places === 1 ? 'place' : 'places'}</dt></div>
                  <div><dd>{recap.neighborhoods.length}</dd><dt>{recap.neighborhoods.length === 1 ? 'area' : 'areas'}</dt></div>
                  <div><dd>{recap.stamps}</dd><dt>{recap.stamps === 1 ? 'T stamp' : 'T stamps'}</dt></div>
                </dl>

                {recap.newPets.length > 0 && (
                  <div className="recap-row">
                    <h3 className="label">New friends</h3>
                    <div className="recap-pets">
                      {recap.newPets.slice(0, 6).map((p) => <PetArt key={p.id} pet={p} tint="var(--accent)" />)}
                    </div>
                  </div>
                )}

                <ul className="recap-facts">
                  {recap.topCuisines.length > 0 && (
                    <li><b>Top tastes</b>{recap.topCuisines.map((c) => titleCase(c.cuisine)).join(', ')}</li>
                  )}
                  {recap.favorite && (
                    <li><b>Favorite</b>{recap.favorite.name} {'★'.repeat(recap.favorite.rating)}</li>
                  )}
                  {recap.topNeighborhood && <li><b>Home turf</b>{recap.topNeighborhood}</li>}
                  {recap.badges.length > 0 && <li><b>Badges</b>{recap.badges.slice(0, 4).join(', ')}{recap.badges.length > 4 ? ` +${recap.badges.length - 4}` : ''}</li>}
                  {recap.greenTrips > 0 && (
                    <li><b>Green trips</b>{recap.greenTrips}, saving {recap.co2SavedKg} kg of CO₂</li>
                  )}
                </ul>
              </div>
              {message && <p className="muted small">{message}</p>}
            </>
          )}
        </div>

        {recap && recap.meals > 0 && (
          <footer className="onboard-foot">
            <button className="btn" disabled={busy} onClick={() => exportImage(false)}><Icon name="camera" size={15} /> Save image</button>
            <button className="btn btn-solid" disabled={busy} onClick={() => exportImage(true)}>{busy ? 'Working…' : 'Share'}</button>
          </footer>
        )}
      </section>
    </div>
  );
}
