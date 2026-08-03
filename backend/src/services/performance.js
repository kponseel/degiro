import { getPool } from '../db/pool.js';

const DAY = 86400000;
const daysBetween = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / DAY));
const round = (n, d = 2) => {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
};

/**
 * Capital net investi et bénéfice, snapshot par snapshot.
 *
 * La courbe de valeur seule ne dit RIEN de la réussite : elle monte aussi bien
 * parce que le marché progresse que parce qu'on a versé 10 000 € le mois
 * dernier. Ce qu'on veut voir, c'est l'écart entre les deux — l'argent apporté
 * d'un côté, ce que le portefeuille vaut de l'autre.
 *
 * `invested(t)` cumule dépôts moins retraits jusqu'à `t`, **y compris ceux
 * antérieurs au premier snapshot** : l'argent versé en 2018 finance encore le
 * portefeuille d'aujourd'hui, et l'omettre ferait passer un apport pour un gain.
 * `pnl(t) = value(t) − invested(t)` est alors le bénéfice réellement encaissé
 * depuis le premier euro versé — dividendes perçus et frais payés compris,
 * puisque les uns comme les autres ont déjà agi sur la valeur.
 *
 * @param points [{ date, value }] triés par date croissante
 * @param flows  [{ date, amount }] dépôts (+) et retraits (−), toute l'histoire
 */
export function capitalSeries(points, flows) {
  const ordered = [...(flows || [])].sort((a, b) => a.date.localeCompare(b.date));
  let next = 0;
  let cumul = 0;
  return (points || []).map((p) => {
    while (next < ordered.length && ordered[next].date <= p.date) {
      cumul += ordered[next].amount;
      next += 1;
    }
    return {
      date: p.date,
      value: round(p.value),
      invested: round(cumul),
      pnl: round(p.value - cumul),
    };
  });
}

/**
 * Rendement TWR par mois calendaire, pour un histogramme « mois par mois ».
 *
 * Un mois sans aucun snapshot est ABSENT de la liste plutôt que rendu à 0 % :
 * une barre à zéro se lit comme « mois blanc », alors qu'il s'agit d'un trou
 * dans les captures. Le premier mois se mesure depuis le début de la série,
 * dont le TWR vaut zéro par construction.
 */
export function monthlyReturns(series) {
  if (!series || series.length < 2) return [];
  const fin = new Map();
  for (const s of series) fin.set(String(s.date).slice(0, 7), 1 + (Number(s.twr) || 0));
  const mois = [...fin.keys()].sort();
  const out = [];
  let base = 1;
  for (const m of mois) {
    const w = fin.get(m);
    if (base > 0) out.push({ month: m, ret: round(w / base - 1, 4) });
    base = w;
  }
  return out;
}

/**
 * Courbe « sous l'eau » : écart au plus haut historique, à chaque date.
 *
 * Toujours ≤ 0. C'est la représentation qui parle le plus d'un risque vécu —
 * un chiffre unique de « pire baisse » ne dit ni quand ni combien de temps.
 */
export function drawdownSeries(series) {
  let sommet = -Infinity;
  return (series || []).map((s) => {
    const w = 1 + (Number(s.twr) || 0);
    if (w > sommet) sommet = w;
    return { date: s.date, dd: sommet > 0 ? round(w / sommet - 1, 4) : 0 };
  });
}

/**
 * Fiabilité du capital investi, seule inconnue du bénéfice.
 *
 * `invested` se déduit du relevé de compte. Si l'historique des versements
 * commence APRÈS les premiers ordres, il en manque : le capital est sous-estimé
 * et le bénéfice d'autant surestimé. Mieux vaut le dire que d'afficher un gain
 * flatteur et faux — d'où ce verdict, que l'écran traduit en avertissement.
 */
export function flowCoverage({ firstFlow, firstTx }) {
  if (!firstFlow) return 'none';
  if (!firstTx) return 'complete';
  // Un mois de battement : les premiers jours d'un compte mêlent souvent
  // versement et premier ordre, et un décalage de quelques jours ne prouve rien.
  return daysBetween(firstTx, firstFlow) > 31 && firstTx < firstFlow ? 'partial' : 'complete';
}

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

  // Tous les versements/retraits connus, sans borne de date : ceux qui précèdent
  // le premier snapshot ne pèsent pas sur le TWR (qui ne mesure que la fenêtre
  // observée) mais constituent l'essentiel du capital investi.
  const [flowRows] = await pool.query(
    `SELECT DATE(tx_date) AS d, COALESCE(amount_eur, CASE WHEN currency = 'EUR' THEN amount END) AS eur
     FROM transactions
     WHERE account_id = ? AND type IN ('deposit', 'withdrawal')`,
    [accountId],
  );
  const tousFlux = flowRows
    .map((r) => ({ date: String(r.d).slice(0, 10), amount: Number(r.eur) || 0 }))
    .filter((f) => f.amount !== 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const [[bornes]] = await pool.query(
    `SELECT MIN(CASE WHEN type IN ('deposit', 'withdrawal') THEN DATE(tx_date) END) AS firstFlow,
            MIN(DATE(tx_date)) AS firstTx
     FROM transactions WHERE account_id = ?`,
    [accountId],
  );
  const capitalOf = (pts) => {
    const serie = capitalSeries(pts, tousFlux);
    const dernier = serie[serie.length - 1] || null;
    const verses = round(tousFlux.filter((f) => f.amount > 0).reduce((s, f) => s + f.amount, 0));
    const retires = round(tousFlux.filter((f) => f.amount < 0).reduce((s, f) => s + f.amount, 0));
    return {
      series: serie,
      invested: dernier?.invested ?? null,
      pnl: dernier?.pnl ?? null,
      // Rapporté au capital, pas à la valeur : « j'ai mis 81 k€, j'ai gagné
      // 5,7 k€ » se lit +7 %, ce que la division par la valeur finale sous-estime.
      pnlPct: dernier && dernier.invested > 0 ? round(dernier.pnl / dernier.invested, 4) : null,
      deposits: verses,
      withdrawals: retires,
      flows: tousFlux.length,
      firstFlow: bornes.firstFlow ? String(bornes.firstFlow).slice(0, 10) : null,
      coverage: flowCoverage({
        firstFlow: bornes.firstFlow ? String(bornes.firstFlow).slice(0, 10) : null,
        firstTx: bornes.firstTx ? String(bornes.firstTx).slice(0, 10) : null,
      }),
    };
  };

  if (points.length < 2) {
    const serie = points.map((p) => ({ ...p, twr: 0 }));
    return {
      twr: null,
      insufficient: true,
      points: points.length,
      from: points[0]?.date ?? null,
      to: points[0]?.date ?? null,
      flows: 0,
      series: serie,
      // Le capital investi ne demande qu'UN point de valeur : le bénéfice
      // s'affiche donc dès la première capture, quand le TWR, lui, doit attendre.
      capital: capitalOf(points),
      monthly: [],
      drawdown: drawdownSeries(serie),
    };
  }

  const from = points[0].date;
  const to = points[points.length - 1].date;

  const flows = tousFlux.filter((f) => f.date > from && f.date <= to);

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

  return {
    twr: chain - 1,
    insufficient: false,
    points: points.length,
    from,
    to,
    flows: flows.length,
    series,
    capital: capitalOf(points),
    monthly: monthlyReturns(series),
    drawdown: drawdownSeries(series),
  };
}
