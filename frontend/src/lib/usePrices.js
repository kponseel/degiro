import { useEffect, useState } from 'react';
import { getPrices } from './api.js';

// Une seule lecture par chargement de page : l'historique ne change qu'à la
// capture suivante, et plusieurs composants le demandent (tableau, panneau).
let cache = null;

/**
 * Historique des cours enregistré par l'extension : `{ byIsin: Map, fx }`, ou
 * null tant qu'il n'est pas chargé. Une erreur donne un historique vide — le
 * reste de la page n'en dépend pas.
 */
export function usePrices() {
  const [prices, setPrices] = useState(null);
  useEffect(() => {
    let alive = true;
    cache ||= getPrices()
      .then((r) => ({ byIsin: new Map((r?.series || []).map((s) => [s.isin, s])), fx: r?.fx || {} }))
      .catch(() => { cache = null; return { byIsin: new Map(), fx: {} }; });
    cache.then((p) => { if (alive) setPrices(p); });
    return () => { alive = false; };
  }, []);
  return prices;
}
