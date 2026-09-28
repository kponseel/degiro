import { describe, it, expect } from 'vitest';
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

// ── Contrat d'ingestion : bornes et dates ────────────────────────────

describe('Contrat d’ingestion — valeurs hors bornes', () => {
  const base = { source: 'csv', capture_id: 'c1', captured_at: '2026-07-27T10:00:00Z' };

  it('accepte puis ignore les transactions d’une ancienne extension, même mal formées', () => {
    // Une extension < 0.6 envoie encore son historique d'ordres. Il ne sert plus :
    // un ordre invalide ne doit pas faire échouer la capture des positions.
    const r = ingestSchema.safeParse({
      ...base,
      positions: [{ isin: 'US0000000001', qty: 1, value_eur: 100 }],
      transactions: [{ tx_date: 'pas-une-date', type: 'buy', external_id: 'a' }],
    });
    expect(r.success).toBe(true);
    expect(r.data.transactions).toBeUndefined();
    expect(r.data.positions).toHaveLength(1);
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
    });
    expect(r.success).toBe(true);
  });
});
