import { describe, it, expect } from 'vitest';
import { shouldAutoCapture, parisDay, RETRY_AFTER_MS } from '../../extension/src/auto.js';
import { buildPayload, parseTotals } from '../../extension/src/degiro.js';
import { ingestSchema } from '../src/schemas/ingest.js';

const base = { enabled: true, configured: true, lastCapture: null, lastAuto: null, now: new Date('2026-10-12T08:00:00Z') };

describe('capture automatique — décision', () => {
  it('capture à la première ouverture du jour', () => {
    expect(shouldAutoCapture(base).go).toBe(true);
  });

  it('jamais sans accord ni sans réglages', () => {
    expect(shouldAutoCapture({ ...base, enabled: false })).toMatchObject({ go: false, reason: 'désactivée' });
    expect(shouldAutoCapture({ ...base, configured: false }).go).toBe(false);
  });

  it('une seule capture par jour civil à Paris', () => {
    expect(shouldAutoCapture({ ...base, lastCapture: { at: '2026-10-12T06:30:00Z' } }).go).toBe(false);
    // Capturée hier à 23 h 30 Paris (21 h 30 UTC) : aujourd'hui reste à faire.
    expect(shouldAutoCapture({ ...base, lastCapture: { at: '2026-10-11T21:30:00Z' } }).go).toBe(true);
    // 22 h 30 UTC le 11/10 = 0 h 30 le 12/10 à Paris : déjà aujourd'hui.
    expect(shouldAutoCapture({ ...base, lastCapture: { at: '2026-10-11T22:30:00Z' } }).go).toBe(false);
  });

  it('après un échec, attend avant de réessayer', () => {
    const recent = { at: new Date(base.now - 5 * 60 * 1000).toISOString(), ok: false };
    expect(shouldAutoCapture({ ...base, lastAuto: recent }).go).toBe(false);
    const ancien = { at: new Date(base.now - RETRY_AFTER_MS - 1000).toISOString(), ok: false };
    expect(shouldAutoCapture({ ...base, lastAuto: ancien }).go).toBe(true);
  });

  it('jour civil de Paris', () => {
    expect(parisDay(new Date('2026-10-11T22:30:00Z'))).toBe('2026-10-12');
  });
});

describe('versements nets lus dans totalPortfolio', () => {
  const totals = (fields) => ({ totalPortfolio: { value: Object.entries(fields).map(([name, value]) => ({ name, value })) } });

  it('lus quand DEGIRO les fournit, en nombre ou en { EUR }', () => {
    expect(parseTotals(totals({ reportNetliq: 100, totalDepositWithdrawal: 80.456, todayDepositWithdrawal: { EUR: 10 } })))
      .toMatchObject({ netDeposits: 80.46, todayFlow: 10 });
  });

  it('absents : jamais un zéro inventé', () => {
    expect(parseTotals(totals({ reportNetliq: 100 }))).toMatchObject({ netDeposits: undefined, todayFlow: undefined });
  });

  it('transmis dans le payload, accepté par le schéma', () => {
    const update = {
      portfolio: { value: [{ value: [{ name: 'id', value: 'EUR' }, { name: 'positionType', value: 'CASH' }, { name: 'value', value: 50 }] }] },
      ...totals({ reportNetliq: 50, reportCashBal: 50, totalDepositWithdrawal: 40 }),
    };
    const { payload, diagnostics } = buildPayload({ update, products: [], captureId: 'a', capturedAt: '2026-10-12T08:00:00Z' });
    expect(payload.net_deposits_eur).toBe(40);
    expect(diagnostics.netDeposits).toBe(40);
    expect(ingestSchema.safeParse(payload).success).toBe(true);
  });
});
