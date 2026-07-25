import { useEffect, useState, useCallback } from 'react';

/**
 * Routage minimal par hash (#/exposition) — sans dépendance.
 * Donne à l'app ce qui lui manquait : URL partageable, bouton Retour du
 * navigateur, rafraîchissement qui reste sur la page courante.
 */
export function useHashRoute(defaultRoute) {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('?')[0] || defaultRoute;
  const [route, setRoute] = useState(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, [defaultRoute]);

  const navigate = useCallback((next, { replace = false } = {}) => {
    const target = `#/${next}`;
    if (window.location.hash === target) return;
    if (replace) window.history.replaceState({}, '', target);
    else window.location.hash = target;
    setRoute(next);
  }, []);

  return [route, navigate];
}
