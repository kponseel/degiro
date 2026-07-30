/**
 * Relevé de compte capturé en direct : dépôts, retraits, dividendes, taxes et
 * frais — ce que l'utilisateur devait jusqu'ici exporter à la main dans un
 * `Account.csv`. C'est la source de la performance réelle (TWR, qui a besoin des
 * dates et montants des versements) et des dividendes.
 *
 * Repéré dans l'extension Zeus, confirmé par degiro-connector 3.0.36 :
 *   GET /portfolio-reports/secure/v6/accountoverview
 *       ?fromDate=JJ/MM/AAAA&toDate=JJ/MM/AAAA&intAccount=…&sessionId=…
 *   → { data: { cashMovements: [{ id, date, valueDate, productId, type,
 *                                 description, currency, change, balance }] } }
 *
 * Module PUR (`fetchRange` injecté) : toute la stratégie est testable hors
 * navigateur — voir backend/test/extensionAccountOverview.test.js.
 */

/**
 * DEGIRO plafonne la largeur d'une plage de relevé. Zeus découpe au-delà de
 * ~182 jours ; on prend 180 pour garder une marge, et on découpe en amont plutôt
 * que de réagir à un refus (une plage refusée ne dit pas pourquoi elle l'est).
 */
export const CASH_MAX_DAYS = 180;

/**
 * Les jambes de trésorerie des ORDRES (`type: 'TRANSACTION'`) sont exclues :
 * les achats et ventes viennent de l'historique des ordres, où ils portent leur
 * quantité et leurs frais. Les reprendre ici les compterait deux fois.
 * Tout le reste est conservé, y compris les types inconnus — perdre un dividende
 * par excès de prudence coûte plus cher qu'un mouvement « autre » de trop.
 */
const EXCLUS = /^transaction$/i;

const pad2 = (n) => String(n).padStart(2, '0');
const ddmmyyyy = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;

/** « 2026-07-29T13:00:24+02:00 » → « 2026-07-29 13:00:24 » (heure murale, comme l'import CSV). */
export function cashDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(v ?? ''));
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] ?? '00'}`;
  // Certains mouvements (versements) n'ont qu'une date de valeur, sans heure.
  const j = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? ''));
  return j ? `${j[1]}-${j[2]}-${j[3]} 00:00:00` : null;
}

/**
 * Nombre tolérant : DEGIRO renvoie aujourd'hui `change` en nombre, mais une API
 * non documentée peut le passer en chaîne du jour au lendemain. Refuser
 * « 12.00 » ferait tomber TOUS les mouvements en silence — et le relevé
 * passerait pour vide au lieu d'illisible.
 */
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v.trim().replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};
const round2 = (n) => Math.round(n * 100) / 100;

/** Jambe de trésorerie d'un ordre : exclue volontairement, ce n'est pas une perte. */
const estJambeOrdre = (row) => EXCLUS.test(String(row?.type ?? ''));

/**
 * Découpe [from, to] en fenêtres de `maxDays` jours au plus.
 * `from`/`to` sont des `Date`; la dernière fenêtre s'arrête à `to`.
 */
export function cashRanges(from, to, maxDays = CASH_MAX_DAYS) {
  const out = [];
  if (!(from instanceof Date) || !(to instanceof Date) || from > to) return out;
  let debut = new Date(from);
  while (debut <= to) {
    const fin = new Date(debut);
    fin.setDate(fin.getDate() + maxDays - 1);
    out.push({ du: ddmmyyyy(debut), au: ddmmyyyy(fin > to ? to : fin) });
    debut = new Date(fin);
    debut.setDate(debut.getDate() + 1);
  }
  return out;
}

/**
 * Traduit les mouvements DEGIRO vers le schéma d'ingestion (table
 * `transactions`).
 *
 * `type` est VOLONTAIREMENT provisoire — dérivé du seul champ structuré de
 * DEGIRO. Le serveur le recalcule depuis la description avec sa table
 * multilingue (`classifyDescription`, la même que pour l'import CSV) : une seule
 * table de classification, dans un seul dépôt, impossible à faire diverger.
 */
export function mapCashMovements(rows) {
  const vus = new Map();
  const out = [];
  for (const row of rows || []) {
    if (!row || typeof row !== 'object') continue;
    if (EXCLUS.test(String(row.type ?? ''))) continue;

    const txDate = cashDate(row.date) || cashDate(row.valueDate);
    const change = num(row.change);
    if (!txDate || change === undefined) continue;

    const currency = String(row.currency ?? '').trim().toUpperCase().slice(0, 3) || null;
    // Même règle que l'import CSV : sans contre-valeur en euros fournie, on ne
    // l'invente pas. Le serveur signale alors les dividendes en devise.
    const amountEur = currency === 'EUR' ? round2(change) : null;

    let externalId = row.id !== undefined && row.id !== null && String(row.id) !== ''
      ? `dgx-cash-${row.id}`
      : `dgx-cash-${txDate.slice(0, 10)}-${change}-${row.productId ?? 'x'}`;
    // Deux mouvements sans identifiant et par ailleurs identiques existent
    // (deux jambes de frais à la même minute) : les suffixer évite qu'ils
    // s'écrasent, comme pour l'import du relevé.
    const n = (vus.get(externalId) || 0) + 1;
    vus.set(externalId, n);
    if (n > 1) externalId = `${externalId}#${n}`;

    out.push({
      tx_date: txDate,
      type: 'other',
      productId: row.productId === undefined || row.productId === null ? null : String(row.productId),
      description: String(row.description ?? '').slice(0, 255) || null,
      qty: null,
      amount: round2(change),
      currency,
      amount_eur: amountEur,
      external_id: externalId.slice(0, 64),
    });
  }
  return out;
}

/** Identifiants produit cités par des mouvements (à résoudre en ISIN). */
export const cashProductIds = (rows) =>
  (rows || []).map((r) => String(r?.productId ?? '')).filter((s) => /^\d+$/.test(s));

const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * Quelle période lire, selon ce qu'on a déjà couvert.
 *
 * Même économie que pour l'historique des ordres : la première capture remonte
 * jusqu'à la première année connue du compte (découverte par `history.js` — on
 * évite ainsi de balayer des années où le compte n'existait pas), les suivantes
 * ne relisent que la période récente avec un recouvrement confortable.
 *
 * @param floorSince  'AAAA-MM-JJ' — début connu du compte, ou null.
 */
export function cashWindow({ today, state, floorSince = null, overlapDays = 31, floorYear = 2013 }) {
  if (state?.capturedThrough) {
    const from = new Date(`${state.capturedThrough}T00:00:00`);
    from.setDate(from.getDate() - overlapDays);
    return { from, to: today, since: state.completeSince || isoDay(from) };
  }
  const from = floorSince ? new Date(`${floorSince}T00:00:00`) : new Date(floorYear, 0, 1);
  return { from, to: today, since: isoDay(from) };
}

/** Mémoire à poser après un envoi réussi, ou null si la couverture est incomplète. */
export const cashNextState = ({ complete, since, to }) =>
  (complete ? { completeSince: since, capturedThrough: isoDay(to) } : null);

/**
 * Plancher de lecture déduit du PREMIER ORDRE connu, avec un an de marge.
 *
 * Sans ça, la première capture d'un compte ouvert en 2018 balayait quand même
 * depuis 2013 — vingt-huit fenêtres au lieu de dix-huit, pour des années où le
 * compte n'existait pas. Le risque n'est pas la lenteur mais la limitation de
 * débit : une rafale de requêtes refusées laisse la couverture incomplète, et la
 * capture suivante recommence la rafale.
 *
 * L'année de marge couvre le versement initial, toujours antérieur au premier
 * achat — de quelques jours en pratique.
 */
export function cashFloorFromOrders(rows, fallback = null) {
  let min = null;
  for (const r of rows || []) {
    const d = String(r?.date ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!min || d < min)) min = d;
  }
  if (!min) return fallback;
  return `${Number(min.slice(0, 4)) - 1}-01-01`;
}

/**
 * Récupère le relevé sur [from, to], fenêtre par fenêtre.
 *
 * Best-effort assumé : une fenêtre refusée ne condamne pas les autres — un
 * relevé partiel vaut mieux que pas de dividendes du tout — mais le compte de
 * refus est remonté pour que la capture suivante retente (la mémoire de
 * couverture n'est posée que si tout est passé).
 *
 * @param fetchRange async (du, au) => { ok, rows? } | { ok:false, reason? }
 * @returns {Promise<{ rows, failed, ranges, detail, complete }>}
 */
export async function captureCash({ from, to, fetchRange }) {
  const ranges = cashRanges(from, to);
  if (!ranges.length) {
    return { rows: [], failed: 0, ranges: 0, detail: 'aucune période à lire', complete: true };
  }

  const rows = [];
  const vus = new Set();
  let failed = 0;
  let refus = null;

  for (const { du, au } of ranges) {
    const lot = await fetchRange(du, au);
    if (!lot?.ok) {
      failed += 1;
      refus = refus || lot?.reason || 'refus sans motif';
      continue;
    }
    // Le dédoublonnage ne porte que sur les fenêtres PRÉCÉDENTES : les fenêtres
    // ne se recouvrent pas, mais un mouvement peut être renvoyé sur ses deux
    // bornes (date de valeur au lendemain). À l'intérieur d'une même réponse, en
    // revanche, deux lignes identiques sont deux mouvements RÉELS — deux frais à
    // la même seconde, par exemple — et les confondre en perdrait un. Ce cas est
    // massif sur un relevé réel : 143 sur 6 794.
    const cettesFenetre = [];
    for (const row of lot.rows || []) {
      const cle = `${row?.id ?? ''}|${row?.date ?? ''}|${row?.change ?? ''}|${row?.productId ?? ''}|${row?.description ?? ''}`;
      if (vus.has(cle)) continue;
      cettesFenetre.push(cle);
      rows.push(row);
    }
    for (const cle of cettesFenetre) vus.add(cle);
  }

  const mouvements = mapCashMovements(rows);
  // Lignes que DEGIRO a bien renvoyées, qui ne sont pas des jambes d'ordre, et
  // que le mapping n'a pourtant pas su lire : un format qui a changé. Sans ce
  // compte, une réponse HTTP 200 dont TOUTES les lignes seraient illisibles
  // passait pour une couverture complète — la mémoire était posée, et le relevé
  // ne serait plus jamais relu. Un silence, là où il faut un signal.
  const candidats = rows.filter((r) => !estJambeOrdre(r)).length;
  const illisibles = Math.max(0, candidats - mouvements.length);

  const complete = failed === 0 && illisibles === 0;
  const parts = [`${mouvements.length} mouvement(s) sur ${ranges.length} période(s)`];
  if (failed) parts.push(`${failed} période(s) refusée(s) — ${refus}`);
  if (illisibles) parts.push(`${illisibles} ligne(s) illisibles (format inattendu) — signale-le`);

  return {
    rows: mouvements, failed, illisibles, ranges: ranges.length, detail: parts.join(' ; '), complete,
  };
}
