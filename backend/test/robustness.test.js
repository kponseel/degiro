import { describe, it, expect } from 'vitest';
import { attribution, realizedPnl } from '../src/services/analytics.js';
import { fmtEur, fmtPct, fmtSignedEur, toneOf, fmtDate, fmtDateShort } from '../../frontend/src/lib/format.js';
import { ingestSchema } from '../src/schemas/ingest.js';

// ── Affichage : jamais de « NaN » ni de « ∞ » à l'écran ───────────────

describe('Formatage — valeurs non affichables', () => {
  it('rend un tiret plutôt que NaN ou l’infini', () => {
    // 0/0 et x/0 arrivent dès qu'un portefeuille est vide ou valorisé à zéro.
    expect(fmtPct(0 / 0)).toBe('—');
    expect(fmtPct(1 / 0)).toBe('—');
    expect(fmtEur(Number.NaN)).toBe('—');
    expect(fmtEur(-Infinity)).toBe('—');
    expect(fmtPct(undefined)).toBe('—');
  });

  it('formate normalement une valeur exploitable', () => {
    expect(fmtPct(0.146, 1)).toContain('14,6');
    expect(fmtEur(1234.5)).toContain('1');
  });

  it('n’écrit jamais « +- » sur un montant négatif', () => {
    expect(fmtSignedEur(-158.59)).not.toContain('+-');
    expect(fmtSignedEur(-158.59).startsWith('-')).toBe(true);
    expect(fmtSignedEur(158.59).startsWith('+')).toBe(true);
    expect(fmtSignedEur(0).startsWith('+')).toBe(false);
    expect(fmtSignedEur(null)).toBe('—');
  });

  it('associe le bon ton à une valeur', () => {
    expect(toneOf(5)).toBe('pos');
    expect(toneOf(-5)).toBe('neg');
    expect(toneOf(0)).toBe('');
    expect(toneOf(Number.NaN)).toBe('');
  });

  it('écrit les dates en français, pas en ISO brut', () => {
    // L'interface est en français : « au 2026-07-27 » n'y a pas sa place.
    expect(fmtDate('2026-07-27')).toBe('27/07/2026');
    expect(fmtDate('2026-07-27T15:30:00Z')).toBe('27/07/2026');
    expect(fmtDate(null)).toBe('—');
    // Format court des axes de graphiques, où la place manque.
    expect(fmtDateShort('2026-07-27')).toBe('27/07');
  });

  it('ne casse pas sur une date d’un format inattendu', () => {
    expect(fmtDate('pas-une-date')).toBe('pas-une-da');
    expect(fmtDateShort('')).toBe('—');
  });
});

// ── Contribution : le signe suit le gain de la ligne ──────────────────

describe('Attribution — contribution d’une ligne', () => {
  it('garde une contribution POSITIVE pour une ligne gagnante, même portefeuille en perte', () => {
    // Total P/L = -100 + 40 = -60. La ligne gagnante ne doit pas ressortir
    // négative (elle s'affichait alors en rouge, à contresens).
    const { rows } = attribution([
      { isin: 'A', name: 'Perdante', value_eur: 900, pl_eur: -100 },
      { isin: 'B', name: 'Gagnante', value_eur: 140, pl_eur: 40 },
    ]);
    const gagnante = rows.find((r) => r.isin === 'B');
    const perdante = rows.find((r) => r.isin === 'A');
    expect(gagnante.contribution).toBeGreaterThan(0);
    expect(perdante.contribution).toBeLessThan(0);
  });

  it('conserve le comportement habituel quand le portefeuille est en gain', () => {
    const { rows } = attribution([
      { isin: 'A', name: 'A', value_eur: 1100, pl_eur: 100 },
      { isin: 'B', name: 'B', value_eur: 140, pl_eur: 40 },
    ]);
    expect(rows.find((r) => r.isin === 'A').contribution).toBeCloseTo(100 / 140, 3);
  });
});

describe('Attribution — plus-value inconnue ≠ zéro', () => {
  it('ne totalise pas 0 € quand AUCUNE position ne porte de plus-value', () => {
    // Cas d'un compte alimenté par Portfolio.csv : DEGIRO n'y fournit aucun P/L.
    // Afficher « 0,00 € » laisserait croire à un portefeuille à l'équilibre.
    const { totals } = attribution([
      { isin: 'A', name: 'A', value_eur: 1000, pl_eur: null },
      { isin: 'B', name: 'B', value_eur: 500, pl_eur: null },
    ]);
    expect(totals.pl_eur).toBeNull();
    expect(totals.pl_pct).toBeNull();
    expect(totals.value_eur).toBe(1500);
  });

  it('totalise sur les seules positions renseignées', () => {
    const { totals } = attribution([
      { isin: 'A', name: 'A', value_eur: 1000, pl_eur: 100 },
      { isin: 'B', name: 'B', value_eur: 500, pl_eur: null },
    ]);
    expect(totals.pl_eur).toBe(100);
  });
});

// ── Réalisé : inchangé par les durcissements ─────────────────────────

describe('Plus-values réalisées — non-régression', () => {
  it('calcule la plus-value au prix moyen pondéré, frais inclus', () => {
    const { totals } = realizedPnl([
      { tx_date: '2024-01-10', isin: 'X', description: 'X', qty: 10, amount_eur: -1000, amount: -1 },
      { tx_date: '2025-01-10', isin: 'X', description: 'X', qty: -10, amount_eur: 1500, amount: -1 },
    ]);
    // Produit net 1499, coût 1001 → +498.
    expect(totals.net).toBe(498);
    expect(totals.sales).toBe(1);
  });
});

// ── Contrat d'ingestion : bornes et dates ────────────────────────────

describe('Contrat d’ingestion — valeurs hors bornes', () => {
  const base = { source: 'csv', capture_id: 'c1', captured_at: '2026-07-27T10:00:00Z' };

  it('refuse une date de transaction inanalysable plutôt que de stocker 0000-00-00', () => {
    const r = ingestSchema.safeParse({
      ...base,
      transactions: [{ tx_date: 'pas-une-date', type: 'buy', external_id: 'a' }],
    });
    expect(r.success).toBe(false);
  });

  it('refuse un montant démesuré plutôt que de laisser MySQL trancher', () => {
    expect(ingestSchema.safeParse({ ...base, total_value_eur: 1e308 }).success).toBe(false);
    expect(ingestSchema.safeParse({ ...base, positions: [{ isin: 'US67066G1040', qty: 1e30 }] }).success).toBe(false);
  });

  it('accepte les valeurs réalistes', () => {
    const r = ingestSchema.safeParse({
      ...base,
      total_value_eur: 90088.38,
      positions: [{ isin: 'US67066G1040', qty: 6, value_eur: 1091.49 }],
      transactions: [{ tx_date: '2026-03-05 10:30:00', type: 'sell', qty: -5, amount_eur: 150, external_id: 'o1' }],
    });
    expect(r.success).toBe(true);
  });
});
