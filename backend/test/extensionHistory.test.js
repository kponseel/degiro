import { describe, it, expect } from 'vitest';
import {
  vwdIdOf, chartUrl, durationMs, parseChart, parseJsonLoose, fxCurrencyOf, fxUrl, parseFx, pool,
} from '../../extension/src/history.js';
import { clientIdFromClient } from '../../extension/src/session.js';

describe('extension — historique des cours (vwd)', () => {
  it('identifiant vwd : issueid par défaut, vwdkey reconnu, secours sur le secondaire', () => {
    expect(vwdIdOf({ vwdId: '360148977', vwdIdentifierType: 'issueid' })).toEqual({ id: '360148977', type: 'issueid' });
    expect(vwdIdOf({ vwdId: 'US0378331005.NASDAQ' , vwdIdentifierType: 'vwdkey' })).toEqual({ id: 'US0378331005.NASDAQ', type: 'vwdkey' });
    expect(vwdIdOf({ vwdIdSecondary: 42 })).toEqual({ id: '42', type: 'issueid' });
    expect(vwdIdOf({})).toBeNull();
  });

  it('URL : série de prix, période, résolution et jeton client', () => {
    const u = new URL(chartUrl({ vwd: { id: '360148977', type: 'issueid' }, userToken: '1234567', period: 'P1Y', resolution: 'P1D' }));
    expect(u.origin).toBe('https://charting.vwdservices.com');
    expect(u.searchParams.get('series')).toBe('price:issueid:360148977');
    expect(u.searchParams.get('period')).toBe('P1Y');
    expect(u.searchParams.get('resolution')).toBe('P1D');
    expect(u.searchParams.get('userToken')).toBe('1234567');
  });

  it('durées ISO', () => {
    expect(durationMs('P1D')).toBe(86400000);
    expect(durationMs('P1W')).toBe(7 * 86400000);
    expect(durationMs('PT1H')).toBe(3600000);
    expect(durationMs('P1M')).toBeNull(); // mois : ambigu, refusé
    expect(durationMs('')).toBeNull();
  });

  it('points en rang depuis le début de la plage (format des clients communautaires)', () => {
    const json = {
      requestid: '1',
      resolution: 'P1D',
      series: [
        { id: 'issueid:360148977', type: 'object', data: { name: 'X' } },
        { id: 'price:issueid:360148977', type: 'time', times: '2026-10-20T00:00:00/P1D', data: [[0, 10.5], [1, 11], [3, 12.25]] },
      ],
    };
    expect(parseChart(json)).toEqual([['2026-10-20', 10.5], ['2026-10-21', 11], ['2026-10-23', 12.25]]);
  });

  it('points horodatés, OHLC, JSONP et valeurs aberrantes', () => {
    const t = Date.UTC(2026, 9, 22);
    const txt = `vwd.hchart.cb(${JSON.stringify({
      series: [{ id: 'price:vwdkey:X', data: [[t, 1, 2, 0.5, 1.5], [t / 1000 + 86400, 1.7], [t + 2 * 86400000, 0], ['x', 3]] }],
    })});`;
    expect(parseChart(txt)).toEqual([['2026-10-22', 1.5], ['2026-10-23', 1.7]]);
  });

  it('réponse vide ou inattendue : aucun point, pas d’exception', () => {
    expect(parseChart(null)).toEqual([]);
    expect(parseChart('<html>refusé</html>')).toEqual([]);
    expect(parseChart({ series: [{ id: 'price:issueid:1', data: [[0, 5]] }] })).toEqual([]); // ni début ni pas
    expect(parseJsonLoose('cb({"a":1})')).toEqual({ a: 1 });
  });

  it('identifiant client = userToken vwd', () => {
    expect(clientIdFromClient({ data: { id: 1234567, intAccount: 11012985 } })).toBe('1234567');
    expect(clientIdFromClient({ data: {} })).toBeNull();
  });
});

describe('extension — taux de change BCE', () => {
  it('pence londoniens → livre / 100', () => {
    expect(fxCurrencyOf('GBX')).toEqual({ code: 'GBP', divisor: 100 });
    expect(fxCurrencyOf('USD')).toEqual({ code: 'USD', divisor: 1 });
  });

  it('URL et lecture Frankfurter', () => {
    expect(fxUrl('https://api.frankfurter.dev/v1', ['USD', 'GBP'], '2021-10-14', '2026-10-24'))
      .toBe('https://api.frankfurter.dev/v1/2021-10-14..2026-10-24?base=EUR&symbols=USD,GBP');
    const fx = parseFx({ base: 'EUR', rates: { '2026-10-23': { USD: 1.09, GBP: 0.86 }, '2026-10-22': { USD: 1.08, BAD: -1 } } });
    expect(fx).toEqual({ USD: [['2026-10-22', 1.08], ['2026-10-23', 1.09]], GBP: [['2026-10-23', 0.86]] });
  });

  it('pool : limite le parallélisme, garde l’ordre, isole les erreurs', async () => {
    let enCours = 0;
    let pic = 0;
    const tasks = [1, 2, 3, 4, 5, 6].map((n) => async () => {
      enCours += 1; pic = Math.max(pic, enCours);
      await new Promise((r) => setTimeout(r, 5));
      enCours -= 1;
      if (n === 3) throw new Error('boum');
      return n;
    });
    const out = await pool(tasks, 2);
    expect(pic).toBeLessThanOrEqual(2);
    expect(out[0]).toBe(1);
    expect(out[2]).toEqual({ error: 'boum' });
    expect(out[5]).toBe(6);
  });
});
