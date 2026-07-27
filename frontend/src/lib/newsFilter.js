/**
 * Filtres et couleurs de la page Actus. Module PUR (aucune API navigateur),
 * testé depuis le backend : c'est la logique multi-sélection qui doit être sûre.
 */

/**
 * Couleur stable d'un secteur → indice 1..8 (mappé sur var(--c1..--c8) côté CSS).
 * Déterministe : le même secteur garde sa couleur d'une session à l'autre, et
 * entre le filtre et les tags des articles.
 */
export function sectorColorIndex(sector) {
  const s = String(sector || '').trim().toLowerCase();
  if (!s) return 0; // 0 = neutre (secteur inconnu)
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 997;
  return (h % 8) + 1;
}

/** Liste des secteurs distincts présents, triés — pour les chips de filtre. */
export function distinctSectors(stocks) {
  const set = new Set();
  for (const s of stocks || []) if (s.sector) set.add(s.sector);
  return [...set].sort((a, b) => a.localeCompare(b, 'fr'));
}

/**
 * Filtre les articles selon deux dimensions multi-sélection.
 * Règle : ET entre dimensions, OU à l'intérieur d'une dimension. Un ensemble
 * vide = pas de contrainte sur cette dimension (« tout »).
 * @param items    articles ({ isin, sector, … })
 * @param isins    Set d'ISIN sélectionnés (titres)
 * @param sectors  Set de secteurs sélectionnés
 */
export function filterNews(items, isins, sectors) {
  const byIsin = isins && isins.size > 0;
  const bySector = sectors && sectors.size > 0;
  if (!byIsin && !bySector) return items || [];
  return (items || []).filter((it) => {
    if (byIsin && !isins.has(it.isin)) return false;
    if (bySector && !sectors.has(it.sector)) return false;
    return true;
  });
}

/**
 * État à afficher au-dessus de la liste. Trois situations donnaient jusqu'ici le
 * même écran vide : rien à dire sur ces titres, source publique indisponible, et
 * portefeuille pas encore enrichi. Chacune appelle pourtant une action
 * différente de la part du lecteur.
 * @returns {{ kind:'ok'|'stale'|'down'|'empty', message:string|null }}
 */
export function newsStatus({ available, degraded } = {}) {
  if (degraded && available) {
    return {
      kind: 'stale',
      message:
        "La source d'actualités n'a pas répondu au dernier rafraîchissement. Les articles ci-dessous sont ceux de la récupération précédente.",
    };
  }
  if (degraded) {
    return {
      kind: 'down',
      message:
        "La source d'actualités est momentanément indisponible. Réessaie dans quelques minutes — rien n'est perdu côté portefeuille.",
    };
  }
  if (!available) {
    return {
      kind: 'empty',
      message:
        "Aucune actualité pour tes titres en ce moment. Si tes secteurs ne sont pas encore renseignés, lance l'enrichissement depuis Import / Réglages.",
    };
  }
  return { kind: 'ok', message: null };
}

/** « il y a 3 min », pour dater la dernière récupération réussie. */
export function relTime(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const min = Math.round((now - t) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return new Date(t).toLocaleDateString('fr-FR');
}

/** Bascule une valeur dans un Set (retourne un NOUVEset — immutable pour React). */
export function toggleInSet(set, value) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
