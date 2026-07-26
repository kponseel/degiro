import { describe, it, expect } from 'vitest';
import {
  GOALS, goalById, stepDefault, compactContext, assemblePrompt,
} from '../../frontend/src/lib/promptWizard.js';
import { insightSchema } from '../src/schemas/aiInsight.js';
import { REF_RE } from '../../shared/aiInsightContract.js';

/**
 * Le générateur de prompts est un module pur : on le teste ici, avec le vitest
 * du backend, car le front n'a pas de runner. On vérifie surtout que le prompt
 * produit embarque bien les instructions que le parseur serveur attend — sinon
 * la boucle « générer → coller → ingérer » se casse en silence.
 */

const pf = {
  snapshot: { snapshot_date: '2026-07-23', cash_eur: 3501.02 },
  positions: [
    { isin: 'US67066G1040', name: 'NVIDIA Corp', symbol: 'NVDA', qty: 10, price: 205, currency: 'USD', value_eur: 1900 },
    { isin: 'IE00B4L5Y983', name: 'iShares Core MSCI World', qty: 100, price: 95, currency: 'EUR', value_eur: 9500 },
    { isin: 'FR001400X2S4', name: 'Atos Group SE', qty: 10, price: 28.66, currency: 'EUR', value_eur: 286 },
  ],
};
const expo = {
  sector: [{ key: 'Tech', weight: 0.62 }, { key: 'Santé', weight: 0.1 }],
  country: [{ key: 'US', weight: 0.7 }],
  currency: [{ key: 'USD', weight: 0.65 }, { key: 'EUR', weight: 0.35 }],
};
const nvda = pf.positions[0];

describe('contexte compacté', () => {
  const ctx = compactContext(pf, expo);

  it('est un tableau serré, pas des phrases', () => {
    expect(ctx).toContain('ISIN|nom|poids%|cours|devise');
    expect(ctx).toContain('US67066G1040|NVIDIA Corp|');
    expect(ctx).toContain('Secteur: Tech 62.0%');
  });

  it('chaque ligne de position est plus courte qu’une phrase équivalente', () => {
    // L'invariant réel du gain de tokens : une ligne « ISIN|nom|… » est plus
    // courte que la phrase d'avant, et l'écart se cumule sur des dizaines de lignes.
    const compactLine = ctx.split('\n').find((l) => l.startsWith('US67066G1040'));
    const phraseLine = `- ${nvda.name} (${nvda.isin}) · ${nvda.qty} × ${nvda.price} ${nvda.currency} = ${nvda.value_eur} € (poids)`;
    expect(compactLine.length).toBeLessThan(phraseLine.length);
  });

  it('peut se limiter aux N plus grosses lignes et le signale', () => {
    const top = compactContext(pf, expo, { top: 2, withExpo: false });
    expect(top).toContain('US67066G1040');
    expect(top).toContain('IE00B4L5Y983');
    expect(top).not.toContain('FR001400X2S4');
    expect(top).toContain('+1 lignes plus petites omises');
  });

  it('échappe les barres verticales d’un nom pour ne pas casser le tableau', () => {
    const tricky = { ...pf, positions: [{ ...nvda, name: 'A|B|C Corp' }] };
    const line = compactContext(tricky, null).split('\n').find((l) => l.startsWith('US67066G1040'));
    expect(line.split('|')).toHaveLength(5); // ISIN, nom, poids, cours, devise
  });
});

describe('assemblage du prompt', () => {
  it('tous les objectifs produisent un prompt avec le bloc attendu', () => {
    for (const g of GOALS) {
      const built = assemblePrompt({ goalId: g.id, answers: {}, pf, expo, sel: nvda });
      expect(built.ref, g.id).toMatch(REF_RE);
      expect(built.scope, g.id).toBe(g.scope);
      // Le squelette de fin doit reprendre la ref et la version.
      expect(built.text, g.id).toContain(`"ref": "${built.ref}"`);
      expect(built.text, g.id).toContain('"schema_version": 1');
      expect(built.text, g.id).toContain('FORMAT DE FIN DE RÉPONSE');
    }
  });

  it('un objectif « titre » fixe l’ISIN et l’injecte dans le squelette', () => {
    const built = assemblePrompt({ goalId: 'stock_full', answers: {}, pf, expo, sel: nvda });
    expect(built.scope).toBe('position');
    expect(built.isin).toBe('US67066G1040');
    expect(built.text).toContain('"isin": "US67066G1040"');
    expect(built.text).toContain('NVIDIA'); // contexte du titre
  });

  it('un objectif « portefeuille » n’a pas d’ISIN', () => {
    const built = assemblePrompt({ goalId: 'risk', answers: { horizon: 'court' }, pf, expo });
    expect(built.scope).toBe('portfolio');
    expect(built.isin).toBeNull();
    expect(built.text).toContain('court terme');
  });

  it('le mode « réponse courte » ajoute la consigne de concision', () => {
    // Le gain porte sur la RÉPONSE de l'IA, pas sur le prompt : on vérifie donc
    // la présence de la consigne, pas une longueur de prompt (qui, elle, augmente
    // légèrement puisqu'on ajoute une instruction).
    const court = assemblePrompt({ goalId: 'risk', answers: { length: 'court' }, pf, expo });
    const long = assemblePrompt({ goalId: 'risk', answers: { length: 'detaille' }, pf, expo });
    expect(court.text).toContain('5 à 8 lignes');
    expect(long.text).not.toContain('5 à 8 lignes');
  });

  it('le ton optionnel passé (null) ne laisse pas de trou dans la consigne', () => {
    const built = assemblePrompt({ goalId: 'rebalance', answers: { horizon: 'long', tone: null, length: 'court' }, pf, expo });
    // On inspecte le corps rédigé, hors squelette d'instructions (qui, lui,
    // contient légitimement « ISIN ou null »).
    const body = built.text.split('FORMAT DE FIN')[0];
    expect(body).toContain('long terme');
    expect(body).not.toContain('undefined');
    expect(body).not.toMatch(/\bnull\b/);
    expect(body).toContain('conseiller en allocation.'); // pas « allocation, null »
  });

  it('rejette un objectif inconnu', () => {
    expect(() => assemblePrompt({ goalId: 'nope', pf, expo })).toThrow();
  });
});

describe('cohérence avec le schéma serveur', () => {
  it('une réponse remplie selon le squelette d’un prompt est acceptée', () => {
    // On simule ce qu'une IA renverrait en suivant les instructions générées.
    const built = assemblePrompt({ goalId: 'stock_full', answers: {}, pf, expo, sel: nvda });
    const answer = {
      schema_version: 1,
      ref: built.ref,
      scope: 'position',
      isin: 'US67066G1040',
      as_of: '2026-07-26',
      risk_score: 7,
      recommendation: 'hold',
      confidence: 'medium',
      summary: 'Solide.',
    };
    expect(insightSchema.safeParse(answer).success).toBe(true);
  });
});

describe('métadonnées du wizard', () => {
  it('chaque étape a une valeur par défaut résoluble', () => {
    for (const g of GOALS) {
      for (const step of g.steps) {
        expect(step.options.some((o) => o.value === stepDefault(step))).toBe(true);
      }
    }
  });

  it('goalById retrouve ou renvoie null', () => {
    expect(goalById('risk').scope).toBe('portfolio');
    expect(goalById('inexistant')).toBeNull();
  });
});
