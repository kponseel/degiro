import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { bornes } from '../../frontend/src/lib/usePagination.js';
import { filtrerTitres } from '../../frontend/src/pages/History.jsx';
import { filtrerVentes, RESULTATS } from '../../frontend/src/components/RealizedPanel.jsx';
import { filtrerPayeurs } from '../../frontend/src/pages/Dividends.jsx';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('Pagination', () => {
  it('découpe la liste en pages', () => {
    expect(bornes(113, 1, 25)).toEqual({ pages: 5, page: 1, debut: 0, fin: 25 });
    expect(bornes(113, 3, 25)).toEqual({ pages: 5, page: 3, debut: 50, fin: 75 });
    // Dernière page incomplète : 113 = 4 × 25 + 13.
    expect(bornes(113, 5, 25)).toEqual({ pages: 5, page: 5, debut: 100, fin: 113 });
  });

  it('ramène une page devenue hors bornes sur la dernière', () => {
    // Le cas qui casse en vrai : on est page 5, on filtre, il ne reste que
    // 12 lignes. Sans ce garde-fou le tableau se vide, et l'utilisateur croit
    // son filtre sans résultat.
    expect(bornes(12, 5, 25)).toEqual({ pages: 1, page: 1, debut: 0, fin: 12 });
    expect(bornes(60, 9, 25)).toMatchObject({ pages: 3, page: 3 });
  });

  it('reste cohérente sur une liste vide', () => {
    expect(bornes(0, 1, 25)).toEqual({ pages: 1, page: 1, debut: 0, fin: 0 });
    expect(bornes(0, 4, 25)).toMatchObject({ page: 1, debut: 0 });
  });

  it('ne divise jamais par zéro ni ne recule avant la première page', () => {
    expect(bornes(50, 0, 25)).toMatchObject({ page: 1 });
    expect(bornes(50, -3, 25)).toMatchObject({ page: 1 });
    expect(bornes(50, 1, 0)).toMatchObject({ pages: 50, debut: 0 });
  });
});

describe('Filtres — détail par titre', () => {
  const rows = [
    { isin: 'A', name: 'NVIDIA Corporation', sector: 'Technologie', pl_eur: 1200 },
    { isin: 'B', name: 'Renault SA', sector: 'Automobile', pl_eur: -300 },
    { isin: 'C', name: 'TotalEnergies SE', sector: 'Énergie', pl_eur: 0 },
  ];

  it('cherche dans le nom, l’ISIN et le secteur', () => {
    expect(filtrerTitres(rows, { texte: 'nvidia' }).map((r) => r.isin)).toEqual(['A']);
    expect(filtrerTitres(rows, { texte: 'AUTOMOBILE' }).map((r) => r.isin)).toEqual(['B']);
    // Les espaces autour de la saisie sont ignorés — un copier-coller en traîne
    // presque toujours, et sans `trim` la recherche ne rendrait rien.
    expect(filtrerTitres(rows, { texte: '  totalenergies  ' }).map((r) => r.isin)).toEqual(['C']);
  });

  it('isole gagnants et perdants — ce qu’un tri ne fait pas', () => {
    // Trier rapproche les perdants ; seul le filtre fait disparaître les autres.
    expect(filtrerTitres(rows, { sens: 'gagnants' }).map((r) => r.isin)).toEqual(['A']);
    expect(filtrerTitres(rows, { sens: 'perdants' }).map((r) => r.isin)).toEqual(['B']);
    // Une ligne exactement à zéro n'est ni en gain ni en perte.
    expect(filtrerTitres(rows, { sens: 'gagnants' }).some((r) => r.isin === 'C')).toBe(false);
  });

  it('combine recherche et sens', () => {
    expect(filtrerTitres(rows, { texte: 'Technologie', sens: 'perdants' })).toEqual([]);
  });

  it('sans filtre, rend la liste entière', () => {
    expect(filtrerTitres(rows, {})).toHaveLength(3);
    expect(filtrerTitres(null, { texte: 'x' })).toEqual([]);
  });
});

describe('Filtres — ventes réalisées', () => {
  const ventes = [
    { isin: 'A', name: 'NVIDIA', gain_eur: 800 },
    { isin: 'B', name: 'Renault', gain_eur: -120 },
    { isin: 'C', name: 'Worldline', gain_eur: null, costUnknown: true },
  ];

  it('sépare plus-values, moins-values et ventes incalculables', () => {
    expect(filtrerVentes(ventes, { resultat: 'gains' }).map((e) => e.isin)).toEqual(['A']);
    expect(filtrerVentes(ventes, { resultat: 'pertes' }).map((e) => e.isin)).toEqual(['B']);
    // Les ventes sans prix de revient s'affichent en tirets un peu partout :
    // aucun tri ne les rassemble, seul ce filtre les sort.
    expect(filtrerVentes(ventes, { resultat: 'inconnues' }).map((e) => e.isin)).toEqual(['C']);
  });

  it('propose exactement les quatre choix de l’écran', () => {
    expect(RESULTATS.map((r) => r.key)).toEqual(['tous', 'gains', 'pertes', 'inconnues']);
    expect(RESULTATS[0].test).toBeUndefined(); // « Toutes » ne filtre rien
  });

  it('cherche par nom sans tenir compte de la casse', () => {
    expect(filtrerVentes(ventes, { texte: 'WORLD' }).map((e) => e.isin)).toEqual(['C']);
  });
});

describe('Filtres — payeurs de dividendes', () => {
  const payeurs = [
    { isin: 'US0378331005', name: 'Apple Inc', currency: 'USD' },
    { isin: 'FR0000120271', name: 'TotalEnergies', currency: 'EUR' },
  ];

  it('cherche par nom, ISIN ou devise', () => {
    expect(filtrerPayeurs(payeurs, 'apple')).toHaveLength(1);
    expect(filtrerPayeurs(payeurs, 'FR0000')).toHaveLength(1);
    expect(filtrerPayeurs(payeurs, 'usd')).toHaveLength(1);
  });

  it('rend tout sur une recherche vide', () => {
    expect(filtrerPayeurs(payeurs, '   ')).toHaveLength(2);
    expect(filtrerPayeurs(undefined, 'x')).toEqual([]);
  });
});

/**
 * Contrat balisage + feuille de style, sur le modèle de `mobileTable.test.js`.
 *
 * Le défaut constaté sur téléphone : les noms de titres, insécables, poussaient
 * la colonne « +/- value » hors de l'écran — la seule qu'on vienne y lire. Rien
 * à l'exécution ne le signale, d'où ces garde-fous sur les sources.
 */
describe('Réalisé — colonnes tenables sur téléphone', () => {
  const panel = read('../../frontend/src/components/RealizedPanel.jsx');
  const styles = read('../../frontend/src/styles.css');

  it('ne masque jamais la date, le titre ni la plus/moins-value', () => {
    const detail = panel.slice(panel.indexOf('{pg.lignes.map'), panel.indexOf('</tbody>', panel.indexOf('{pg.lignes.map')));
    const ligneValue = detail.split('\n').find((l) => l.includes('tone(e.gain_eur)'));
    expect(ligneValue, 'cellule +/- value introuvable').toBeDefined();
    expect(ligneValue).not.toContain('col-opt');
  });

  it('tronque le nom du titre plutôt que de chasser le chiffre', () => {
    expect(panel).toContain('className="col-titre"');
    const regle = styles.split('\n').find((l) => l.includes('td.col-titre'));
    expect(regle, 'règle col-titre absente de la feuille de style').toBeDefined();
    expect(regle).toContain('text-overflow: ellipsis');
  });

  it('met de côté quantité, produit et coût de revient', () => {
    for (const entete of ['Qté', 'Produit', 'Coût de revient']) {
      const th = panel.split('\n').find((l) => l.includes(`>${entete}<`));
      expect(th, `en-tête « ${entete} » introuvable`).toBeDefined();
      expect(th, `« ${entete} » doit porter col-opt`).toContain('col-opt');
    }
  });
});
