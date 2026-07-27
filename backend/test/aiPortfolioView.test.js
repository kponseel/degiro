import { describe, it, expect } from 'vitest';
import { portfolioInsightView, ACTION_LABELS } from '../../frontend/src/lib/aiPortfolioView.js';

/** Ligne telle que renvoyée par GET /api/ai/insights (champ `portfolio`). */
const row = (payload = {}, cols = {}) => ({
  id: 2,
  scope: 'portfolio',
  provider: 'chatgpt',
  risk_score: 8,
  summary: 'Résumé colonne',
  as_of: '2026-07-25',
  ...cols,
  payload: {
    schema_version: 1, ref: 'p_gybjaphh', scope: 'portfolio', as_of: '2026-07-25', ...payload,
  },
});

describe('portfolioInsightView — cas vides', () => {
  it('rien à afficher sans avis', () => {
    expect(portfolioInsightView(null)).toBeNull();
    expect(portfolioInsightView(undefined)).toBeNull();
  });

  it('ignore un avis par titre (mauvais scope)', () => {
    expect(portfolioInsightView({ ...row(), scope: 'position', isin: 'US02079K3059' })).toBeNull();
  });

  it('pas de carte vide : sans résumé, sans score et sans liste', () => {
    expect(portfolioInsightView(row({}, { risk_score: null, summary: null }))).toBeNull();
  });
});

describe('portfolioInsightView — contenu', () => {
  it('expose résumé, scores, date et assistant', () => {
    const v = portfolioInsightView(row({ risk_score: 8, diversification_score: 4, summary: 'Trop de tech US.' }));
    expect(v.summary).toBe('Trop de tech US.');
    expect(v.risk).toBe(8);
    expect(v.diversification).toBe(4);
    expect(v.asOf).toBe('2026-07-25');
    expect(v.provider).toBe('ChatGPT');
    expect(v.id).toBe(2);
  });

  it('le payload prime sur la colonne indexée (c’est ce que l’IA a écrit)', () => {
    const v = portfolioInsightView(row({ summary: 'Résumé payload', risk_score: 3 }));
    expect(v.summary).toBe('Résumé payload');
    expect(v.risk).toBe(3);
  });

  it('retombe sur les colonnes quand le payload est incomplet', () => {
    const v = portfolioInsightView(row({}, { summary: 'Résumé colonne', risk_score: '7' }));
    expect(v.summary).toBe('Résumé colonne');
    expect(v.risk).toBe(7);
    expect(v.diversification).toBeNull();
  });

  it('assistant inconnu ou absent → pas de mention inventée', () => {
    expect(portfolioInsightView(row({}, { provider: null })).provider).toBeNull();
    expect(portfolioInsightView(row({}, { provider: 'perplexity' })).provider).toBeNull();
  });
});

describe('portfolioInsightView — avertissements', () => {
  it('trie du plus grave au moins grave et colore la pastille', () => {
    const v = portfolioInsightView(row({
      warnings: [
        { severity: 'low', label: 'Peu de liquidités', isin: null },
        { severity: 'high', label: 'Concentration tech US', isin: null },
        { severity: 'medium', label: 'Alphabet pèse 11 %', isin: 'US02079K3059' },
      ],
    }));
    expect(v.warnings.map((w) => w.text)).toEqual([
      'Concentration tech US', 'Alphabet pèse 11 %', 'Peu de liquidités',
    ]);
    expect(v.warnings.map((w) => w.tone)).toEqual(['sev-high', 'warn', '']);
    expect(v.warnings[0].severityLabel).toBe('Élevé');
    expect(v.warnings[1].isin).toBe('US02079K3059');
  });

  it('écarte les entrées sans libellé et tolère une sévérité absente', () => {
    const v = portfolioInsightView(row({
      warnings: [{ label: '' }, { label: 'Sans sévérité' }],
    }));
    expect(v.warnings).toHaveLength(1);
    expect(v.warnings[0].severity).toBe('low');
    expect(v.warnings[0].severityLabel).toBe('Faible');
  });
});

describe('portfolioInsightView — actions suggérées', () => {
  it('traduit l’action et donne un ton achat / vente', () => {
    const v = portfolioInsightView(row({
      suggested_actions: [
        { action: 'reduce', isin: 'US02079K3059', rationale: 'Alléger la première ligne' },
        { action: 'buy', isin: null, rationale: 'Ajouter un ETF Europe' },
        { action: 'watch', isin: null },
      ],
    }));
    expect(v.actions.map((a) => a.label)).toEqual(['Alléger', 'Achat', 'Surveiller']);
    expect(v.actions.map((a) => a.tone)).toEqual(['neg', 'pos', '']);
    expect(v.actions[2].rationale).toBeNull();
  });

  it('couvre tout le vocabulaire du contrat partagé', () => {
    for (const a of ['buy', 'hold', 'reduce', 'sell', 'watch']) {
      expect(ACTION_LABELS[a]).toBeTruthy();
    }
  });
});
