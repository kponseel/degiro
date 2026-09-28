import { describe, it, expect } from 'vitest';
import {
  buildPrompt, objectivesFor, isinsFromHash, plPct, positionsTable, OBJECTIVES,
} from '../../frontend/src/lib/promptBuilder.js';

// Données synthétiques : le dépôt est public, aucune position réelle ici.
const pf = {
  snapshot: { snapshot_date: '2026-09-01', cash_eur: 1200 },
  positions: [
    { isin: 'US0000000001', name: 'Alpha Corp', ticker: 'ALPH', sector: 'Technology', country: 'US', qty: 10, price: 150, currency: 'USD', break_even_price: 100, value_eur: 1400, pl_eur: 400 },
    { isin: 'FR0000000002', name: 'Beta | SA', qty: 50, price: 20, currency: 'EUR', break_even_price: 25, value_eur: 1000, pl_eur: -250 },
    { isin: 'IE0000000003', name: 'Gamma ETF', qty: 3, price: 100, currency: 'EUR', value_eur: 300, pl_eur: null },
  ],
};
const exposure = { sector: [{ key: 'Technology', weight: 0.52 }], country: [], currency: [{ key: 'USD', weight: 0.52 }] };

describe('Générateur de prompts', () => {
  it('portefeuille entier : toutes les lignes, liquidités, répartition, questions et cadre', () => {
    const r = buildPrompt({ pf, exposure, scope: 'portfolio', objective: 'bilan' });
    expect(r.error).toBeUndefined();
    expect(r.count).toBe(3);
    for (const isin of ['US0000000001', 'FR0000000002', 'IE0000000003']) expect(r.text).toContain(isin);
    expect(r.text).toMatch(/3 lignes/);
    expect(r.text).toMatch(/liquidités/);
    expect(r.text).toContain('Secteurs : Technology 52,0 %');
    expect(r.text).toContain('## Ce que je te demande');
    expect(r.text).toContain('Réponds en français.');
    // Aller seulement : aucun contrat de réponse imposé.
    expect(r.text).not.toMatch(/json/i);
  });

  it('filtre par valeur : les petites lignes sont omises mais annoncées, poids sur le total', () => {
    const r = buildPrompt({ pf, scope: 'portfolio', objective: 'risques', options: { minValue: 500 } });
    expect(r.count).toBe(2);
    expect(r.text).not.toContain('IE0000000003');
    expect(r.text).toMatch(/1 petites lignes/);
    // 1400 / 2700 = 51,9 % : le filtre ne regonfle pas les poids.
    expect(r.text).toContain('51,9 %');
  });

  it('titres choisis : seuls ceux-là, dans l’ordre des valeurs, avec leur part du portefeuille', () => {
    const r = buildPrompt({ pf, scope: 'stocks', isins: ['FR0000000002', 'US0000000001'], objective: 'analyse' });
    expect(r.count).toBe(2);
    expect(r.text).not.toContain('IE0000000003');
    expect(r.text.indexOf('US0000000001')).toBeLessThan(r.text.indexOf('FR0000000002'));
    expect(r.text).toMatch(/Ces titres pèsent/);
    expect(r.text).toMatch(/Pour chacun de ces titres/);
    // Pas de répartition du portefeuille entier sur une sélection.
    expect(r.text).not.toContain('Répartition du portefeuille');
  });

  it('un seul titre : formulation au singulier et nom dans l’intro', () => {
    const r = buildPrompt({ pf, scope: 'stocks', isins: ['US0000000001'], objective: 'sortie' });
    expect(r.text).toMatch(/un titre de mon portefeuille \(Alpha Corp\)/);
    expect(r.text).toMatch(/Ce titre pèse/);
  });

  it('refuse proprement les cas incomplets', () => {
    expect(buildPrompt({ pf, scope: 'stocks', isins: [], objective: 'analyse' }).error).toMatch(/au moins un titre/);
    expect(buildPrompt({ pf, scope: 'stocks', isins: ['US0000000001'], objective: 'comparer' }).error).toMatch(/au moins 2/);
    expect(buildPrompt({ pf, scope: 'portfolio', objective: 'comparer' }).error).toBeTruthy();
    expect(buildPrompt({ pf: { snapshot: {}, positions: [] }, scope: 'portfolio', objective: 'bilan' }).error).toBeTruthy();
    expect(buildPrompt({ pf, scope: 'portfolio', objective: 'bilan', options: { minValue: 99999 } }).error).toMatch(/seuil/);
  });

  it('options : horizon, profil, budget (rééquilibrage seulement), web, précision', () => {
    const r = buildPrompt({
      pf, scope: 'portfolio', objective: 'reequilibrage',
      options: { horizon: 'long', profile: 'prudent', cash: 'frais', web: false, note: '  besoin de\n5 000 €  ' },
    });
    expect(r.text).toMatch(/long terme/);
    expect(r.text).toMatch(/profil est prudent/);
    expect(r.text).toMatch(/argent frais/);
    expect(r.text).not.toMatch(/recherche web/);
    expect(r.text).toContain('Précision de ma part : besoin de 5 000 €');
    const b = buildPrompt({ pf, scope: 'portfolio', objective: 'bilan', options: { cash: 'frais' } });
    expect(b.text).not.toMatch(/argent frais/);
  });

  it('l’objectif « actus » force la recherche web', () => {
    const r = buildPrompt({ pf, scope: 'stocks', isins: ['US0000000001'], objective: 'actus', options: { web: false } });
    expect(r.text).toMatch(/recherche web/);
  });

  it('chaque objectif produit un prompt sur chacune de ses portées', () => {
    for (const o of OBJECTIVES) {
      for (const scope of o.scopes) {
        const r = buildPrompt({ pf, scope, isins: ['US0000000001', 'FR0000000002'], objective: o.id });
        expect(r.error, `${o.id}/${scope}`).toBeUndefined();
        expect(r.text).not.toMatch(/undefined|null|NaN/);
      }
    }
  });

  it('objectifs proposés selon la portée et le nombre de titres', () => {
    expect(objectivesFor('stocks', 1).map((o) => o.id)).not.toContain('comparer');
    expect(objectivesFor('stocks', 2).map((o) => o.id)).toContain('comparer');
    expect(objectivesFor('portfolio').map((o) => o.id)).toContain('reequilibrage');
    expect(objectivesFor('stocks', 0)).toEqual([]);
  });

  it('+/- value en % du coût, jamais inventée', () => {
    expect(plPct({ value_eur: 1400, pl_eur: 400 })).toBeCloseTo(0.4);
    expect(plPct({ value_eur: 300, pl_eur: null })).toBeNull();
    expect(plPct({ value_eur: 100, pl_eur: 100 })).toBeNull();
  });

  it('tableau : séparateur neutralisé dans les noms, colonnes stables', () => {
    const t = positionsTable(pf.positions, 2700).table.split('\n');
    const cols = t[0].split('|').length;
    for (const line of t) expect(line.split('|').length).toBe(cols);
    expect(t[2]).toContain('Beta   SA');
  });

  it('tableau : une colonne vide sur toutes les lignes disparaît', () => {
    // Forme d'un import Portfolio.csv : ni prix de revient, ni plus-value, ni secteur.
    const csv = pf.positions.map(({ isin, name, qty, price, currency, value_eur }) => ({ isin, name, qty, price, currency, value_eur }));
    const { heads } = positionsTable(csv, 2700);
    expect(heads).toEqual(['Titre', 'ISIN', 'Qté', 'Cours', 'Devise', 'Valeur €', 'Poids']);
    const r = buildPrompt({ pf: { ...pf, positions: csv }, scope: 'portfolio', objective: 'bilan' });
    expect(r.text).not.toMatch(/PRU/);
    // Présente sur une ligne seulement : la colonne reste, tiret pour les autres.
    expect(positionsTable(pf.positions, 2700).heads).toContain('PRU');
  });

  it('présélection par le hash : uniquement les titres détenus', () => {
    expect(isinsFromHash('#/ai?isin=us0000000001', pf.positions)).toEqual(['US0000000001']);
    expect(isinsFromHash('#/ai?isin=US0000000001,XX0000000000,FR0000000002', pf.positions))
      .toEqual(['US0000000001', 'FR0000000002']);
    expect(isinsFromHash('#/ai', pf.positions)).toEqual([]);
  });
});
