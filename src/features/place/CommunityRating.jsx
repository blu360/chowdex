import { useEffect, useState } from 'react';
import { getCommunityRating } from '../../lib/api.js';
import { SCHOOLS } from '../../lib/schools.js';

/**
 * What Chowdex users rated a place, and what students at your school rated it:
 * "★ 4.6 from 14 Chowdex explorers · ★ 4.8 from 5 at Northeastern University".
 * This is our own data (the stars people give when they log a meal), separate from Google's rating.
 */
export default function CommunityRating({ placeId, version }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    getCommunityRating(placeId)
      .then((r) => !cancelled && setData(r))
      .catch(() => !cancelled && setData(null));
    return () => {
      cancelled = true;
    };
  }, [placeId, version]);

  if (!data || !data.count) return null;
  const school = data.school?.count ? SCHOOLS.find((s) => s.id === data.school.id) : null;

  return (
    <div className="rating community-rating">
      <strong>★ {data.rating.toFixed(1)}</strong>
      <span className="muted"> from {data.count} Chowdex {data.count === 1 ? 'explorer' : 'explorers'}</span>
      {school && (
        <span className="school-rating">
          <strong>★ {data.school.rating.toFixed(1)}</strong> from {data.school.count} at {school.name}
        </span>
      )}
    </div>
  );
}
