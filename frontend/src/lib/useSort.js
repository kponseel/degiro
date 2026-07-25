import { useState, useMemo, useCallback } from 'react';

/**
 * Tri de tableau piloté par en-têtes cliquables.
 * @param rows    lignes à trier
 * @param initial { key, dir } tri par défaut ('asc' | 'desc')
 * @param getters { key: (row) => valeur } accès personnalisés (sinon row[key])
 */
export function useSort(rows, initial = { key: null, dir: 'desc' }, getters = {}) {
  const [sort, setSort] = useState(initial);

  const toggle = useCallback((key) => {
    setSort((s) => {
      if (s.key !== key) {
        // Les colonnes numériques partent en décroissant (le plus gros d'abord).
        return { key, dir: 'desc' };
      }
      return { key, dir: s.dir === 'desc' ? 'asc' : 'desc' };
    });
  }, []);

  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    const get = getters[sort.key] || ((r) => r[sort.key]);
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const na = typeof va === 'number' ? va : Number(va);
      const nb = typeof vb === 'number' ? vb : Number(vb);
      const bothNum = Number.isFinite(na) && Number.isFinite(nb);
      if (bothNum) return (na - nb) * factor;
      return String(va ?? '').localeCompare(String(vb ?? ''), 'fr') * factor;
    });
  }, [rows, sort, getters]);

  return { sorted, sort, toggle };
}
