import { useCallback, useEffect, useState } from 'react';

/** The five main screens, in navigation order. */
export const TABS = ['home', 'explore', 'stamps', 'dex', 'pets'];

/** "#/pets/allston" -> { tab: 'pets', id: 'allston' }. Anything unknown is the Home screen. */
function parse(hash) {
  const [tab, id] = hash.replace(/^#\/?/, '').split('/');
  if (!TABS.includes(tab)) return { tab: 'home', id: null };
  return { tab, id: id ? decodeURIComponent(id) : null };
}

/**
 * Tiny hash router: keeps the current screen in the URL so the browser (and phone) back button
 * works, without adding a routing dependency.
 * @returns {[{tab: string, id: string|null}, (tab: string, id?: string) => void]}
 */
export function useRoute() {
  const [route, setRoute] = useState(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const go = useCallback((tab, id) => {
    const next = `#/${tab}${id ? `/${encodeURIComponent(id)}` : ''}`;
    if (window.location.hash !== next) window.location.hash = next;
  }, []);

  return [route, go];
}
