import { getPool } from '../db/pool.js';
import { computePerformance } from './performance.js';

/**
 * Outils d'analyse de portefeuille — dans l'esprit des bons gestionnaires :
 * performance par titre (contribution), métriques de risque, concentration.
 *
 * Les calculs sont des fonctions PURES (testées sans base) ; `computeAnalytics`
 * ne fait que rassembler les données et les leur passer.
 */

const round = (n, d = 2) => {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
};

// ── Performance par titre (attribution) ──────────────────────────────

/**
 * Ventile la performance latente par position.
 * @param positions  [{ isin, name, sector, currency, value_eur, pl_eur }]
 * @param dividends   Map isin -> montant net perçu (EUR), optionnel
 * @returns { rows, totals }
 */
export function attribution(positions, dividends = new Map()) {
  const total = positions.reduce((s, p) => s + (Number(p.value_eur) || 0), 0);
  const totalPl = positions.reduce((s, p) => s + (Number(p.pl_eur) || 0), 0);

  const rows = positions.map((p) => {
    const value = Number(p.value_eur) || 0;
    const pl = p.pl_eur == null ? null : Number(p.pl_eur);
    const cost = pl == null ? null : value - pl; // prix de revient reconstitué
    return {
      isin: p.isin,
      name: p.name || p.isin,
      sector: p.sector || null,
      currency: p.currency || null,
      value_eur: round(value),
      weight: total ? round(value / total, 4) : 0,
      pl_eur: pl == null ? null : round(pl),
      // Rendement de la ligne = P/L rapporté à son coût (pas à sa valeur actuelle).
      pl_pct: pl == null || !cost ? null : round(pl / cost, 4),
      // Contribution : part de cette ligne dans le P/L total (peut dépasser 100 %
      // si d'autres lignes sont en perte — c'est voulu et informatif).
      contribution: pl == null || !totalPl ? null : round(pl / totalPl, 4),
      dividends_eur: dividends.has(p.isin) ? round(dividends.get(p.isin)) : null,
    };
  }).sort((a, b) => (b.pl_eur ?? -Infinity) - (a.pl_eur ?? -Infinity));

  return {
    rows,
    totals: {
      value_eur: round(total),
      pl_eur: round(totalPl),
      pl_pct: total - totalPl ? round(totalPl / (total - totalPl), 4) : null,
      dividends_eur: round([...dividends.values()].reduce((s, v) => s + (Number(v) || 0), 0)),
    },
  };
}

// ── Concentration ────────────────────────────────────────────────────

/** Indices de concentration à partir des poids (fractions sommant ~1). */
export function concentration(weights) {
  const w = weights.filter((x) => x > 0).sort((a, b) => b - a);
  if (!w.length) return { top1: 0, top5: 0, hhi: 0, effectiveHoldings: 0, lines: 0 };
  const hhi = w.reduce((s, x) => s + x * x, 0);
  return {
    top1: round(w[0], 4),
    top5: round(w.slice(0, 5).reduce((s, x) => s + x, 0), 4),
    hhi: round(hhi, 4),
    // Nombre « effectif » de lignes (inverse de Herfindahl) : mesure intuitive
    // de la diversification réelle — 20 lignes dont une pèse 80 % ≈ 1,5 effective.
    effectiveHoldings: round(1 / hhi, 1),
    lines: w.length,
  };
}

// ── Risque, à partir de la série TWR cumulée ─────────────────────────

/**
 * Métriques de risque dérivées de la courbe de performance (TWR cumulé).
 * @param series  [{ date, twr }] où twr est la performance cumulée (0 = départ)
 * @param periodsPerYear  ~252 si points quotidiens (annualisation de la vol)
 */
export function riskMetrics(series, periodsPerYear = 252) {
  if (!series || series.length < 3) return null;

  // Facteur de richesse cumulé (1 + twr), et rendements période à période.
  const wealth = series.map((s) => 1 + (Number(s.twr) || 0));
  const rets = [];
  for (let i = 1; i < wealth.length; i += 1) {
    if (wealth[i - 1] > 0) rets.push(wealth[i] / wealth[i - 1] - 1);
  }
  if (rets.length < 2) return null;

  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  const stdev = Math.sqrt(variance);

  // Drawdown : plus forte baisse depuis un sommet, sur la courbe de richesse.
  let peak = wealth[0];
  let maxDd = 0;
  for (const v of wealth) {
    if (v > peak) peak = v;
    const dd = peak > 0 ? v / peak - 1 : 0;
    if (dd < maxDd) maxDd = dd;
  }
  const currentDd = peak > 0 ? wealth[wealth.length - 1] / Math.max(...wealth) - 1 : 0;

  // Sharpe simplifié (taux sans risque = 0) : rendement moyen / volatilité, annualisé.
  const sharpe = stdev > 0 ? (mean / stdev) * Math.sqrt(periodsPerYear) : null;

  let best = rets[0];
  let worst = rets[0];
  for (const r of rets) { if (r > best) best = r; if (r < worst) worst = r; }

  return {
    volatility: round(stdev * Math.sqrt(periodsPerYear), 4), // annualisée
    maxDrawdown: round(maxDd, 4),
    currentDrawdown: round(currentDd, 4),
    bestPeriod: round(best, 4),
    worstPeriod: round(worst, 4),
    sharpe: sharpe == null ? null : round(sharpe, 2),
    periods: rets.length,
  };
}

// ── Plus/moins-values réalisées (prix moyen pondéré / PMP) ───────────

/**
 * Calcule les plus-values réalisées à chaque vente, par la méthode du prix
 * moyen pondéré — celle qu'exige aussi le fisc français pour une même ligne.
 *
 * @param txs  ordres { tx_date, isin, description, qty (signé), amount_eur
 *             (brut EUR signé : achat < 0, vente > 0), amount (frais, < 0) }
 * @returns { events, byIsin, totals } — events = une entrée par vente
 */
export function realizedPnl(txs) {
  const ordered = [...txs].sort((a, b) => String(a.tx_date).localeCompare(String(b.tx_date)));
  const state = new Map(); // isin -> { qty, cost, reliable }
  const events = [];

  for (const t of ordered) {
    const isin = t.isin;
    if (!isin || t.qty == null) continue;
    const st = state.get(isin) || { qty: 0, cost: 0, reliable: true };
    const gross = t.amount_eur == null ? null : Math.abs(Number(t.amount_eur));
    const fee = Math.abs(Number(t.amount) || 0);

    if (t.qty > 0) {
      // Achat : entre dans le coût de revient (frais inclus).
      if (gross == null) st.reliable = false;
      else st.cost += gross + fee;
      st.qty += t.qty;
    } else if (t.qty < 0) {
      // Vente : réalise une plus/moins-value sur la quantité cédée.
      const sellQty = Math.min(Math.abs(t.qty), st.qty > 0 ? st.qty : Math.abs(t.qty));
      const avg = st.qty > 0 ? st.cost / st.qty : 0;
      const costOfSold = round(avg * sellQty);
      const net = gross == null ? null : round(gross - fee);
      const unknown = !st.reliable || st.qty <= 0 || gross == null;
      events.push({
        date: String(t.tx_date).slice(0, 10),
        isin,
        name: t.description || isin,
        qty: round(sellQty, 6),
        proceeds_eur: net,
        cost_eur: unknown ? null : costOfSold,
        gain_eur: unknown || net == null ? null : round(net - costOfSold),
        costUnknown: unknown,
      });
      st.qty = round(st.qty - sellQty, 6);
      st.cost = st.qty <= 0 ? 0 : round(st.cost - costOfSold);
    }
    state.set(isin, st);
  }

  const byIsin = new Map();
  for (const e of events) {
    const b = byIsin.get(e.isin) || { isin: e.isin, name: e.name, gain_eur: 0, sales: 0, hasUnknown: false };
    if (e.gain_eur != null) b.gain_eur = round(b.gain_eur + e.gain_eur);
    b.sales += 1;
    if (e.costUnknown) b.hasUnknown = true;
    byIsin.set(e.isin, b);
  }

  const known = events.filter((e) => e.gain_eur != null);
  const totals = {
    gains: round(known.filter((e) => e.gain_eur > 0).reduce((s, e) => s + e.gain_eur, 0)),
    losses: round(known.filter((e) => e.gain_eur < 0).reduce((s, e) => s + e.gain_eur, 0)),
    net: round(known.reduce((s, e) => s + e.gain_eur, 0)),
    sales: events.length,
    unknown: events.filter((e) => e.costUnknown).length,
  };
  return { events, byIsin: [...byIsin.values()].sort((a, b) => b.gain_eur - a.gain_eur), totals };
}

// ── Assemblage ───────────────────────────────────────────────────────

/** Positions du dernier snapshot enrichies (secteur), pour l'attribution. */
async function latestPositions(accountId) {
  const [rows] = await getPool().query(
    `SELECT p.isin, MAX(p.name) AS name, MAX(p.value_eur) AS value_eur,
            MAX(p.pl_eur) AS pl_eur, MAX(p.currency) AS currency, r.sector
     FROM positions p LEFT JOIN isin_ref r ON r.isin = p.isin
     WHERE p.snapshot_id = (SELECT id FROM snapshots WHERE account_id = ? ORDER BY captured_at DESC LIMIT 1)
       AND (p.qty IS NULL OR p.qty <> 0)
     GROUP BY p.isin, r.sector
     ORDER BY value_eur DESC`,
    [accountId],
  );
  return rows;
}

/** Dividendes nets perçus par ISIN (12 mois glissants), en EUR uniquement. */
async function dividendsByIsin(accountId) {
  const [rows] = await getPool().query(
    `SELECT isin, SUM(COALESCE(amount_eur, CASE WHEN currency = 'EUR' THEN amount END)) AS eur
     FROM transactions
     WHERE account_id = ? AND type IN ('dividend', 'tax') AND isin IS NOT NULL
       AND tx_date >= (NOW() - INTERVAL 1 YEAR)
     GROUP BY isin`,
    [accountId],
  );
  const map = new Map();
  for (const r of rows) {
    const v = Number(r.eur);
    if (Number.isFinite(v) && v !== 0) map.set(r.isin, v);
  }
  return map;
}

/** Ordres d'achat/vente (tout l'historique) pour les plus-values réalisées. */
async function buySellTxs(accountId) {
  const [rows] = await getPool().query(
    `SELECT tx_date, isin, description, qty, amount, amount_eur
     FROM transactions
     WHERE account_id = ? AND type IN ('buy', 'sell') AND isin IS NOT NULL AND qty IS NOT NULL
     ORDER BY tx_date ASC, id ASC`,
    [accountId],
  );
  return rows;
}

/** Flux de dividendes nets (dividende + retenue à la source), datés, en EUR. */
async function dividendFlows(accountId) {
  const [rows] = await getPool().query(
    `SELECT tx_date, isin, description,
            COALESCE(amount_eur, CASE WHEN currency = 'EUR' THEN amount END) AS eur
     FROM transactions
     WHERE account_id = ? AND type IN ('dividend', 'tax') AND isin IS NOT NULL
     ORDER BY tx_date ASC`,
    [accountId],
  );
  return rows
    .map((r) => ({
      date: String(r.tx_date).slice(0, 10),
      isin: r.isin,
      name: r.description || r.isin,
      amount_eur: r.eur == null ? null : round(Number(r.eur)),
    }))
    .filter((d) => d.amount_eur != null);
}

/**
 * Vue « réalisé / fiscal » : plus-values encaissées à chaque vente et flux de
 * dividendes, datés, pour un filtrage par année/mois côté client. Chiffres
 * bruts (aucun taux d'imposition appliqué).
 */
export async function computeRealized(accountId = 1) {
  const txs = await buySellTxs(accountId);
  const { events, byIsin, totals } = realizedPnl(txs);
  const dividends = await dividendFlows(accountId);
  const years = [...new Set([
    ...events.map((e) => e.date.slice(0, 4)),
    ...dividends.map((d) => d.date.slice(0, 4)),
  ])].filter(Boolean).sort();
  const dividendsTotal = round(dividends.reduce((s, d) => s + d.amount_eur, 0));
  return { events, byIsin, totals, dividends, dividendsTotal, years };
}

/**
 * Analyse complète du portefeuille : attribution par titre, concentration,
 * risque, et plus-values réalisées. Best-effort — chaque bloc peut être
 * null/vide si les données manquent.
 */
export async function computeAnalytics(accountId = 1) {
  const positions = await latestPositions(accountId);
  const divs = await dividendsByIsin(accountId);
  const attr = attribution(positions, divs);
  const conc = concentration(attr.rows.map((r) => r.weight));

  const perf = await computePerformance(accountId);
  const risk = perf && !perf.insufficient ? riskMetrics(perf.series) : null;

  let realized = null;
  try { realized = await computeRealized(accountId); } catch { /* best-effort */ }

  return {
    hasPl: positions.some((p) => p.pl_eur != null),
    attribution: attr,
    concentration: conc,
    risk,
    realized,
    twr: perf && !perf.insufficient ? perf.twr : null,
    from: perf?.from ?? null,
    to: perf?.to ?? null,
  };
}
