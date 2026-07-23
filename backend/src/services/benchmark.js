import { getPool } from '../db/pool.js';
import { computePerformance } from './performance.js';

/**
 * Indices/ETF de référence proposés. Le ticker Stooq sert à récupérer les cours
 * de clôture historiques (CSV public, sans clé). Les proxys ETF sont libellés en
 * EUR quand c'est possible pour rester cohérent avec un portefeuille en euros.
 */
export const BENCHMARKS = {
  world: { stooq: 'iwda.uk', name: 'MSCI World (IWDA)', ccy: 'USD' },
  sp500: { stooq: '^spx', name: 'S&P 500', ccy: 'USD' },
  stoxx600: { stooq: '^stoxx', name: 'STOXX Europe 600', ccy: 'EUR' },
  acwi: { stooq: 'issa.uk', name: 'MSCI ACWI (SSAC)', ccy: 'USD' },
};

export const DEFAULT_BENCHMARK = 'world';

/**
 * Récupère les cours de clôture quotidiens depuis Stooq (CSV public).
 * Best-effort : réseau bloqué/indisponible → tableau vide (jamais bloquant).
 * @returns {Promise<Array<{ date: string, close: number }>>}
 */
async function fetchStooqDaily(ticker, from, to) {
  const d1 = String(from).replaceAll('-', '');
  const d2 = String(to).replaceAll('-', '');
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker)}&d1=${d1}&d2=${d2}&i=d`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'text/csv' } });
    clearTimeout(timer);
    if (!res.ok) return [];
    const text = await res.text();
    // En-tête attendu : Date,Open,High,Low,Close,Volume
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2 || !/date/i.test(lines[0])) return [];
    const out = [];
    for (const line of lines.slice(1)) {
      const cols = line.split(',');
      const date = cols[0];
      const close = Number(cols[4]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(close) && close > 0) {
        out.push({ date, close });
      }
    }
    return out;
  } catch {
    clearTimeout(timer);
    return [];
  }
}

/** Cours en cache pour une série sur un intervalle (table market_prices). */
async function cachedPrices(series, from, to) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT price_date, close FROM market_prices WHERE series = ? AND price_date BETWEEN ? AND ? ORDER BY price_date ASC',
    [series, from, to],
  );
  return rows.map((r) => ({ date: String(r.price_date).slice(0, 10), close: Number(r.close) }));
}

async function upsertPrices(series, prices) {
  if (!prices.length) return;
  const pool = getPool();
  const rows = prices.map((p) => [series, p.date, p.close]);
  await pool.query(
    'INSERT INTO market_prices (series, price_date, close) VALUES ? ' +
      'ON DUPLICATE KEY UPDATE close = VALUES(close)',
    [rows],
  );
}

/**
 * Série de cours pour un benchmark sur [from, to] : sert le cache, complète via
 * Stooq si trop clairsemé, met en cache le résultat.
 */
async function getBenchmarkPrices(symbol, ticker, from, to) {
  let prices = await cachedPrices(symbol, from, to);
  // Heuristique : ~5 jours de cotation / semaine. Si le cache couvre mal la
  // période, on tente un rafraîchissement réseau (best-effort).
  const spanDays = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000));
  const expected = Math.max(2, Math.floor((spanDays / 7) * 5 * 0.6));
  if (prices.length < expected) {
    const fetched = await fetchStooqDaily(ticker, from, to);
    if (fetched.length) {
      await upsertPrices(symbol, fetched);
      prices = await cachedPrices(symbol, from, to);
    }
  }
  return prices;
}

/** Cours de clôture à la date donnée ou, à défaut, le dernier connu avant. */
function closeOnOrBefore(prices, date) {
  let last = null;
  for (const p of prices) {
    if (p.date <= date) last = p.close;
    else break;
  }
  return last;
}

/**
 * Compare la performance du portefeuille (TWR) à un benchmark buy-and-hold sur
 * la même fenêtre. Le TWR neutralisant les apports, la comparaison est équitable.
 *
 * @param {string} key clé de BENCHMARKS (défaut : world)
 * @returns {Promise<object>} { available, symbol, name, from, to, twr,
 *   benchmarkReturn, alpha, series:[{date, twr, benchmark}], reason? }
 */
export async function computeBenchmark(key = DEFAULT_BENCHMARK, accountId = 1) {
  const conf = BENCHMARKS[key] || BENCHMARKS[DEFAULT_BENCHMARK];
  const symbol = key in BENCHMARKS ? key : DEFAULT_BENCHMARK;
  const perf = await computePerformance(accountId);

  const base = {
    symbol,
    name: conf.name,
    ccy: conf.ccy,
    twr: perf.twr,
    from: perf.from,
    to: perf.to,
    benchmarks: Object.entries(BENCHMARKS).map(([k, v]) => ({ key: k, name: v.name })),
  };

  if (perf.insufficient || !perf.from || !perf.to) {
    return { ...base, available: false, reason: 'insufficient_history', series: [] };
  }

  const prices = await getBenchmarkPrices(symbol, conf.stooq, perf.from, perf.to);
  const baseClose = closeOnOrBefore(prices, perf.from) ?? prices[0]?.close ?? null;
  if (!baseClose) {
    // Réseau bloqué (sandbox) ou symbole indisponible : la page reste utile
    // (TWR seul), le benchmark s'affichera dès que les cours seront joignables.
    return { ...base, available: false, reason: 'no_prices', series: [] };
  }

  const series = perf.series.map((pt) => {
    const c = closeOnOrBefore(prices, pt.date);
    return {
      date: pt.date,
      twr: pt.twr,
      benchmark: c != null ? c / baseClose - 1 : null,
    };
  });

  const lastClose = closeOnOrBefore(prices, perf.to);
  const benchmarkReturn = lastClose != null ? lastClose / baseClose - 1 : null;
  const alpha = benchmarkReturn != null && perf.twr != null ? perf.twr - benchmarkReturn : null;

  return { ...base, available: true, benchmarkReturn, alpha, series };
}
