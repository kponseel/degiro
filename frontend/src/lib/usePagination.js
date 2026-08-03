import { useEffect, useMemo, useState } from 'react';

export const TAILLES = [25, 50, 100];

/**
 * Pagination d'un tableau.
 *
 * Un historique de plusieurs milliers d'ordres rendu d'un bloc ne pose pas
 * qu'un problème de performance : il enterre tout ce qui suit sous des écrans
 * de défilement. Le lecteur qui veut un graphique doit traverser la liste.
 *
 * @param rows   lignes déjà filtrées et triées
 * @param taille lignes par page au départ
 * @param cle    signature des filtres actifs — la page revient à 1 quand elle
 *               change. Rester en page 7 après avoir changé de filtre affiche
 *               un extrait arbitraire d'une liste que l'on vient de redéfinir.
 */
/**
 * Arithmétique de la pagination, isolée du rendu pour être testable.
 *
 * Le point qui casse en pratique : un filtre qui raccourcit la liste laisse la
 * page courante au-delà de la dernière. Le tableau se vide alors sans que rien
 * ne l'explique — l'utilisateur croit son filtre sans résultat.
 */
export function bornes(total, page, taille) {
  const t = Math.max(1, Math.floor(taille) || 1);
  const n = Math.max(0, total || 0);
  const pages = Math.max(1, Math.ceil(n / t));
  const courante = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { pages, page: courante, debut: (courante - 1) * t, fin: Math.min(courante * t, n) };
}

export function usePagination(rows, { taille: tailleInitiale = 25, cle = '' } = {}) {
  const [page, setPage] = useState(1);
  const [taille, setTaille] = useState(tailleInitiale);

  const total = rows?.length || 0;
  const b = bornes(total, page, taille);

  useEffect(() => { setPage(1); }, [cle, taille]);

  const lignes = useMemo(() => (rows || []).slice(b.debut, b.debut + taille), [rows, b.debut, taille]);

  return {
    page: b.page, setPage, taille, setTaille, pages: b.pages, total, debut: b.debut, lignes,
  };
}
