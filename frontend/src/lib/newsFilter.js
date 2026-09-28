/**
 * Couleurs et secteurs de la page Actus. Module PUR (aucune API navigateur),
 * testé depuis le backend.
 */

/**
 * Couleur stable d'un secteur → indice 1..8 (mappé sur var(--c1..--c8) côté CSS).
 * Déterministe : le même secteur garde sa couleur d'une session à l'autre, et
 * et d'un écran à l'autre.
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
