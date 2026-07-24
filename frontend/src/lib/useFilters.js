import { useState, useCallback } from 'react';

/** État mémorisé dans localStorage (par vue). */
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? { ...initial, ...JSON.parse(s) } : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next) => {
      setValue((prev) => {
        const val = typeof next === 'function' ? next(prev) : next;
        try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota / privé */ }
        return val;
      });
    },
    [key],
  );
  return [value, set];
}

/** Valeurs distinctes triées (fr) d'un accès sur une liste. */
export function distinctValues(items, getter) {
  const set = new Set();
  for (const it of items) {
    const v = getter(it);
    if (v !== null && v !== undefined && v !== '') set.add(v);
  }
  return [...set].sort((a, b) => String(a).localeCompare(String(b), 'fr'));
}

/**
 * Filtre une liste par recherche texte (sur searchFields) + facettes exactes.
 * @param state { q, ...facetValues }
 * @param opts  { searchFields:string[], facetGetters:{ key:(item)=>value } }
 */
export function applyFilters(items, state, { searchFields = [], facetGetters = {} } = {}) {
  const needle = String(state.q || '').trim().toLowerCase();
  return items.filter((it) => {
    if (needle) {
      const hay = searchFields.map((f) => String(it[f] ?? '')).join(' ').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    for (const [key, getter] of Object.entries(facetGetters)) {
      const wanted = state[key];
      if (wanted && String(getter(it) ?? '') !== String(wanted)) return false;
    }
    return true;
  });
}
