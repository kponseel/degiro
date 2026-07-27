import { getPool } from '../db/pool.js';

const DAY = 86400000;
const daysBetween = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / DAY));

/**
 * TWR (Time-Weighted Return) par la méthode de Dietz modifiée, chaînée
 * géométriquement entre snapshots consécutifs. Neutralise les flux externes
 * (dépôts/retraits) pour mesurer la vraie performance, indépendante des apports.
 *
 * Flux externes = transactions 'deposit' (+) et 'withdrawal' (−) du relevé de
 * compte. Dividendes/frais restent internes (ils font partie de la performance).
 */
export async function computePerformance(accountId = 1) {
  const pool = getPool();

  const [snaps] = await pool.query(
    `SELECT snapshot_date, total_value_eur
     FROM snapshots
     WHERE account_id = ? AND total_value_eur IS NOT NULL
     ORDER BY snapshot_date ASC, (source = 'extension') DESC`,
    [accountId],
  );

  // Un point par jour (préséance extension via le ORDER BY).
  const points = [];
  const seen = new Set();
  for (const s of snaps) {
    const date = String(s.snapshot_date).slice(0, 10);
    if (!seen.has(date)) {
      seen.add(date);
      points.push({ date, value: Number(s.total_value_eur) });
    }
  }

  if (points.length < 2) {
    return { twr: null, insufficient: true, points: points.length, from: points[0]?.date ?? null, to: points[0]?.date ?? null, flows: 0, series: points.map((p) => ({ ...p, twr: 0 })) };
  }

  const from = points[0].date;
  const to = points[points.length - 1].date;

  const [flowRows] = await pool.query(
    `SELECT DATE(tx_date) AS d, COALESCE(amount_eur, CASE WHEN currency = 'EUR' THEN amount END) AS eur
     FROM transactions
     WHERE account_id = ? AND type IN ('deposit', 'withdrawal')
       AND DATE(tx_date) > ? AND DATE(tx_date) <= ?`,
    [accountId, from, to],
  );
  const flows = flowRows
    .map((r) => ({ date: String(r.d).slice(0, 10), amount: Number(r.eur) || 0 }))
    .filter((f) => f.amount !== 0);

  let chain = 1;
  const series = [{ date: points[0].date, value: points[0].value, twr: 0 }];

  for (let k = 1; k < points.length; k += 1) {
    const { date: dBeg, value: vBeg } = points[k - 1];
    const { date: dEnd, value: vEnd } = points[k];
    const span = daysBetween(dBeg, dEnd);
    const periodFlows = flows.filter((f) => f.date > dBeg && f.date <= dEnd);
    const cf = periodFlows.reduce((s, f) => s + f.amount, 0);
    const weighted = periodFlows.reduce((s, f) => s + f.amount * (daysBetween(f.date, dEnd) / span), 0);
    const denom = vBeg + weighted;
    // Le chaînage `chain *= 1 + r` est irréversible : une seule sous-période
    // aberrante contamine définitivement toute la courbe. Deux cas produisent
    // des rendements absurdes sur des données pourtant plausibles :
    //  - un capital de départ négligeable (premier jour à 1 €, versement le
    //    lendemain) → dénominateur minuscule, rendement de plusieurs millions
    //    de pour cent ;
    //  - un passage par zéro (portefeuille soldé puis réalimenté) → -100 %
    //    définitif, la courbe ne remonte plus jamais.
    // Ces sous-périodes ne mesurent aucune performance de gestion : on les
    // neutralise (r = 0) plutôt que de propager un chiffre faux.
    const negligible = denom <= 0 || denom < 100;
    const r = negligible ? 0 : (vEnd - vBeg - cf) / denom;
    // Garde-fou de dernier recours : ±1 000 % sur une sous-période relève de la
    // donnée corrompue, pas du marché.
    const bounded = Math.max(-10, Math.min(10, r));
    chain *= 1 + bounded;
    series.push({ date: dEnd, value: vEnd, twr: chain - 1 });
  }

  return { twr: chain - 1, insufficient: false, points: points.length, from, to, flows: flows.length, series };
}
