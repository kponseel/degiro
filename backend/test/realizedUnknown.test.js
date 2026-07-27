import { describe, it, expect } from 'vitest';
import { realizedPnl } from '../src/services/analytics.js';
import { periodSummary, explainUnknown, UNKNOWN_REASONS } from '../../frontend/src/lib/realized.js';

/** Ordre d'achat/vente minimal. `eur = null` simule une ligne sans montant en euros. */
const ordre = (date, qty, eur, fee = -1) => ({
  tx_date: date,
  isin: 'US67066G1040',
  description: 'NVIDIA CORP',
  qty,
  amount_eur: eur === null ? null : (qty < 0 ? Math.abs(eur) : -Math.abs(eur)),
  amount: fee,
});

describe('plus-values réalisées — une ligne soldée repart à zéro', () => {
  it("un achat sans montant en euros n'annule plus les plus-values des années suivantes", () => {
    // Le défaut : `reliable` passait à false en 2018 et n'était JAMAIS remis à
    // vrai. Les ventes de 2024 et 2025, pourtant parfaitement calculables sur
    // un achat de 2021 bien renseigné, restaient à « — » pour toujours.
    const { events, totals } = realizedPnl([
      ordre('2018-01-05', 5, null),      // achat atypique, sans montant EUR
      ordre('2019-02-10', -5, 275),      // on solde entièrement la ligne
      ordre('2021-03-12', 10, 925),      // rachat propre
      ordre('2024-06-20', -6, 826.5),
      ordre('2025-06-21', -4, 586.5),
    ]);

    expect(events).toHaveLength(3);
    // La vente de 2019 reste incalculable : elle porte les titres empoisonnés.
    expect(events[0].gain_eur).toBeNull();
    expect(events[0].unknownReason).toBe('incomplete_cost');
    // Celles d'après sont calculées — c'est tout l'objet du correctif.
    expect(events[1].gain_eur).not.toBeNull();
    expect(events[2].gain_eur).not.toBeNull();
    expect(totals.unknown).toBe(1);
    expect(totals.net).toBeGreaterThan(0);
  });

  it('un rachat après sortie complète ouvre un nouveau prix moyen', () => {
    const { events } = realizedPnl([
      ordre('2020-01-01', 10, 1000),
      ordre('2020-06-01', -10, 1200),   // +200 environ
      ordre('2021-01-01', 10, 3000),    // rachat bien plus haut
      ordre('2021-06-01', -10, 3300),   // +300 environ, sans mélange avec 2020
    ]);
    expect(events).toHaveLength(2);
    expect(events[0].gain_eur).toBeCloseTo(198, 0);
    expect(events[1].gain_eur).toBeCloseTo(298, 0);
  });

  it('la position reste empoisonnée tant que les titres douteux sont détenus', () => {
    // Comportement volontairement conservé : au prix moyen pondéré, si une part
    // des titres détenus a un coût inconnu, la moyenne l'est aussi.
    const { events } = realizedPnl([
      ordre('2018-01-05', 5, null),
      ordre('2021-03-12', 10, 925),
      ordre('2024-06-20', -10, 1378.5),
    ]);
    expect(events[0].gain_eur).toBeNull();
    expect(events[0].unknownReason).toBe('incomplete_cost');
  });
});

describe('motif de non-calcul', () => {
  it('distingue les trois causes', () => {
    const venteSeule = realizedPnl([ordre('2024-06-20', -10, 1378.5)]);
    expect(venteSeule.events[0].unknownReason).toBe('no_history');

    const venteSansMontant = realizedPnl([
      ordre('2021-03-12', 10, 925),
      ordre('2024-06-20', -10, null),
    ]);
    expect(venteSansMontant.events[0].unknownReason).toBe('amount_missing');

    const achatSansMontant = realizedPnl([
      ordre('2021-03-12', 10, null),
      ordre('2024-06-20', -10, 1378.5),
    ]);
    expect(achatSansMontant.events[0].unknownReason).toBe('incomplete_cost');
  });

  it('ventile les motifs dans les totaux', () => {
    const { totals } = realizedPnl([
      ordre('2024-01-01', -1, 100),        // no_history
      ordre('2024-02-01', -1, 100),        // no_history
      ordre('2024-03-01', 10, 1000),
      ordre('2024-04-01', -5, null),       // amount_missing
    ]);
    expect(totals.unknownBy).toEqual({ no_history: 2, amount_missing: 1 });
  });

  it('aucun motif quand tout est calculé', () => {
    const { totals } = realizedPnl([ordre('2021-01-01', 10, 1000), ordre('2024-01-01', -10, 1200)]);
    expect(totals.unknown).toBe(0);
    expect(totals.unknownBy).toEqual({});
  });
});

describe('résumé de période et explication affichée', () => {
  it('compte les ventes calculées séparément du total', () => {
    const s = periodSummary([
      { date: '2024-01-01', gain_eur: 100, costUnknown: false },
      { date: '2024-02-01', gain_eur: null, costUnknown: true, unknownReason: 'no_history' },
      { date: '2024-03-01', gain_eur: -40, costUnknown: false },
    ], []);
    expect(s.sales).toBe(3);
    expect(s.computed).toBe(2);
    expect(s.unknown).toBe(1);
    expect(s.net).toBe(60);
    expect(s.unknownBy).toEqual({ no_history: 1 });
  });

  it('produit une explication par motif, la plus fréquente d’abord', () => {
    const d = explainUnknown({ no_history: 1, incomplete_cost: 4 });
    expect(d).toHaveLength(2);
    expect(d[0].motif).toBe('incomplete_cost');
    expect(d[0].n).toBe(4);
    expect(d[0].texte).toContain('4 ventes');
    expect(d[0].remede).toBe(UNKNOWN_REASONS.incomplete_cost.remede);
    // L'ancien message imputait toujours la cause à un historique trop court :
    // il ne doit plus apparaître quand ce n'est pas le motif.
    expect(d[0].texte).not.toMatch(/avant la période couverte/);
  });

  it('ne dit rien quand tout est calculé', () => {
    expect(explainUnknown({})).toBeNull();
    expect(explainUnknown()).toBeNull();
  });

  it('accorde le singulier', () => {
    expect(explainUnknown({ no_history: 1 })[0].texte).toMatch(/^1 vente :/);
  });
});
