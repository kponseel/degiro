import { getPool } from '../db/pool.js';
import { computePerformance } from './performance.js';
import { logger } from '../logger.js';

/**
 * Indices/ETF de référence proposés, avec DEUX tickers : Stooq (CSV public) et
 * Yahoo (JSON), essayés dans cet ordre.
 *
 * Tous les proxys sont désormais des ETF cotés en EUR. Trois des quatre étaient
 * libellés en dollars et comparés tels quels à un TWR en euros : l'écart affiché
 * embarquait alors tout le mouvement EUR/USD de la période — plusieurs points de
 * pourcentage, du bruit pur pour qui veut savoir s'il bat son indice.
 */
export const BENCHMARKS = {
  world: { stooq: 'iwda.uk', yahoo: 'IWDA.AS', name: 'MSCI World (IWDA)', ccy: 'EUR' },
  sp500: { stooq: '^spx', yahoo: 'SXR8.DE', name: 'S&P 500', ccy: 'EUR' },
  stoxx600: { stooq: '^stoxx', yahoo: '^STOXX', name: 'STOXX Europe 600', ccy: 'EUR' },
  acwi: { stooq: 'issa.uk', yahoo: 'IUSQ.DE', name: 'MSCI ACWI', ccy: 'EUR' },
};

export const DEFAULT_BENCHMARK = 'world';

/**
 * Sans `User-Agent`, Node s'annonce comme un script : Stooq répond alors 403 ou
 * sert une page de quota au lieu du CSV. C'est l'un des soupçons les plus
 * probables derrière un « source publique injoignable » permanent en production,
 * alors que la même URL fonctionne depuis un navigateur.
 */
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/** Analyse le CSV Stooq : Date,Open,High,Low,Close,Volume */
export function parseStooqCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/);
  if (lines.length < 2 || !/date/i.test(lines[0])) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const close = Number(cols[4]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(cols[0]) && Number.isFinite(close) && close > 0) {
      out.push({ date: cols[0], close });
    }
  }
  return out;
}

/** Analyse la réponse `chart` de Yahoo : horodatages + clôtures alignés. */
export function parseYahooChart(json) {
  const r = json?.chart?.result?.[0];
  const ts = r?.timestamp;
  const closes = r?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(ts) || !Array.isArray(closes)) return [];
  const out = [];
  for (let i = 0; i < ts.length; i += 1) {
    const close = Number(closes[i]);
    // Yahoo laisse des trous (jours fériés locaux) : ils arrivent en `null` et
    // doivent être ÉCARTÉS, pas convertis en zéro — un cours nul ferait plonger
    // la courbe de l'indice à −100 %.
    if (Number.isFinite(close) && close > 0) {
      out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close });
    }
  }
  return out;
}

/** Appel réseau borné, qui rend le MOTIF de l'échec au lieu de l'avaler. */
async function recuperer(url, accept) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: accept } });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, motif: `HTTP ${res.status}` };
    return { ok: true, texte: await res.text() };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, motif: err?.name === 'AbortError' ? 'délai dépassé' : String(err?.cause?.code || err?.message || err).slice(0, 60) };
  }
}

async function fetchStooqDaily(ticker, from, to) {
  const d1 = String(from).replaceAll('-', '');
  const d2 = String(to).replaceAll('-', '');
  const res = await recuperer(
    `https://stooq.com/q/d/l/?s=${encodeURIComponent(ticker)}&d1=${d1}&d2=${d2}&i=d`,
    'text/csv',
  );
  if (!res.ok) return { prices: [], motif: res.motif };
  const prices = parseStooqCsv(res.texte);
  return { prices, motif: prices.length ? null : 'réponse sans cours' };
}

async function fetchYahooDaily(ticker, from, to) {
  if (!ticker) return { prices: [], motif: 'pas de ticker' };
  const p1 = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
  const p2 = Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000);
  const res = await recuperer(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`
      + `?period1=${p1}&period2=${p2}&interval=1d`,
    'application/json',
  );
  if (!res.ok) return { prices: [], motif: res.motif };
  try {
    const prices = parseYahooChart(JSON.parse(res.texte));
    return { prices, motif: prices.length ? null : 'réponse sans cours' };
  } catch {
    return { prices: [], motif: 'réponse illisible' };
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
 * Série de cours sur [from, to] : sert le cache, le complète via les sources
 * réseau s'il est trop clairsemé, et renvoie les motifs d'échec le cas échéant.
 */
async function getBenchmarkPrices(symbol, conf, from, to) {
  let prices = await cachedPrices(symbol, from, to);
  // Heuristique : ~5 jours de cotation / semaine. Si le cache couvre mal la
  // période, on tente un rafraîchissement réseau (best-effort).
  const spanDays = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000));
  const expected = Math.max(2, Math.floor((spanDays / 7) * 5 * 0.6));
  if (prices.length >= expected) return { prices, motifs: [] };

  // DEUX sources, essayées dans l'ordre. Une source unique et gratuite crée une
  // boucle morte : elle échoue, le cache ne peut donc jamais s'amorcer, et le
  // comparatif reste indisponible à jamais — c'est exactement ce qui se passait
  // en production, avec pour seule explication « source publique injoignable ».
  const motifs = [];
  for (const [nom, prendre] of [
    ['stooq', () => fetchStooqDaily(conf.stooq, from, to)],
    ['yahoo', () => fetchYahooDaily(conf.yahoo, from, to)],
  ]) {
    const { prices: recus, motif } = await prendre();
    if (recus.length) {
      await upsertPrices(symbol, recus);
      return { prices: await cachedPrices(symbol, from, to), motifs };
    }
    motifs.push(`${nom} : ${motif || 'aucun cours'}`);
  }
  // Un cache partiel vaut mieux que rien : la courbe sera plus courte, pas fausse.
  return { prices, motifs };
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

  const { prices, motifs } = await getBenchmarkPrices(symbol, conf, perf.from, perf.to);
  const baseClose = closeOnOrBefore(prices, perf.from) ?? prices[0]?.close ?? null;
  if (!baseClose) {
    // Réseau bloqué ou symbole indisponible : la page reste utile (TWR seul).
    // Le MOTIF est journalisé ET renvoyé : « source injoignable » ne permettait
    // pas de distinguer un pare-feu d'un quota dépassé ou d'un ticker mort, et
    // laissait donc sans prise pour agir.
    logger.warn({ indice: symbol, motifs }, 'Benchmark : aucune source de cours n’a répondu');
    return { ...base, available: false, reason: 'no_prices', detail: motifs, series: [] };
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
