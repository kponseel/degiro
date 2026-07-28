/**
 * Traduction du format DEGIRO vers le schéma d'ingestion de l'API.
 *
 * Module volontairement PUR (aucune API navigateur) : c'est la seule partie de
 * l'extension qui peut être testée hors navigateur, et c'est aussi celle qui
 * casse en premier si DEGIRO change son format. Les tests vivent dans
 * `backend/test/extensionMapping.test.js`.
 *
 * DEGIRO renvoie ses objets sous forme de listes `[{ name, value }]` imbriquées ;
 * tout commence donc par un aplatissement.
 */

/** Aplatit une ligne DEGIRO `{ value: [{name, value}] }` en objet simple. */
export function flattenRow(row) {
  const out = {};
  for (const field of row?.value || []) {
    if (field && typeof field.name === 'string') out[field.name] = field.value;
  }
  return out;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Certains montants arrivent en `{ EUR: -1234.5 }` (devise de référence). */
function amount(v) {
  const direct = num(v);
  if (direct !== undefined) return direct;
  if (v && typeof v === 'object') {
    const eur = num(v.EUR);
    if (eur !== undefined) return eur;
    const first = Object.values(v).find((x) => num(x) !== undefined);
    return num(first);
  }
  return undefined;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Sépare les lignes du portefeuille : titres détenus, positions **soldées** et
 * liquidités.
 *
 * Les lignes soldées (quantité nulle) restent présentes chez DEGIRO. On les
 * conservait autrefois comme des fantômes ; on les remonte désormais à part
 * (`closed`) pour capturer un maximum de données — l'historique complet des
 * positions fermées vient toutefois des transactions, pas de cet instantané.
 */
export function parsePortfolio(update) {
  const rows = (update?.portfolio?.value || []).map(flattenRow);
  const products = [];
  const closed = [];
  const cashOther = [];
  let cashEur;

  for (const row of rows) {
    const id = String(row.id ?? '');
    const isCash = row.positionType === 'CASH' || (!row.positionType && !/^\d+$/.test(id));

    if (isCash) {
      // L'identifiant vaut « EUR » ou « FLATEX_EUR » selon l'entité qui détient
      // le cash. Les autres devises ne sont pas additionnables ici, faute de
      // taux de change dans cette réponse — mais on les COMPTE, car les ignorer
      // en silence creusait un écart avec le total de DEGIRO sans que rien ne
      // dise d'où il venait (un solde en dollars, typiquement, alimenté par les
      // dividendes de titres américains).
      const devise = id.replace(/^FLATEX_/, '');
      const value = amount(row.value);
      if (devise !== 'EUR') {
        if (value) cashOther.push({ currency: devise, value });
        continue;
      }
      if (value !== undefined) cashEur = round2((cashEur ?? 0) + value);
      continue;
    }

    const size = num(row.size);
    if (size === undefined) continue; // ligne sans quantité exploitable
    const entry = { ...row, productId: id };
    if (size === 0) closed.push(entry); // position soldée
    else products.push(entry); // position détenue
  }

  return { products, closed, cashEur, cashOther };
}

/** Totaux affichés par DEGIRO — sert de contrôle face à notre propre somme. */
export function parseTotals(update) {
  const t = flattenRow(update?.totalPortfolio);
  const positions = num(t.reportPortfValue);
  const cash = num(t.reportCashBal) ?? num(t.totalCash);
  const netLiq = num(t.reportNetliq)
    ?? (positions !== undefined && cash !== undefined ? round2(positions + cash) : undefined);
  return { positions, cash, netLiq };
}

/** Extrait les identifiants produit à résoudre en ISIN. */
export const productIds = (products) => products.map((p) => p.productId).filter(Boolean);

/** Découpe en lots : l'endpoint `products/info` refuse les listes trop longues. */
export function chunk(list, size = 100) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * `products/info` renvoie `{ data: { "<id>": { isin, symbol, name, productType, currency } } }`.
 * On fusionne les lots en un seul index.
 */
export function indexProducts(responses) {
  const index = {};
  for (const res of responses || []) {
    for (const [id, info] of Object.entries(res?.data || {})) {
      if (info && typeof info === 'object') index[String(id)] = info;
    }
  }
  return index;
}

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const clip = (v, n) => (v === undefined || v === null ? undefined : String(v).slice(0, n));

/**
 * Assemble une position au format de l'API.
 * Renvoie `null` si l'ISIN manque ou est malformé : l'API l'exige, et une ligne
 * sans ISIN ne serait de toute façon rattachable à rien.
 */
export function toPosition(row, info) {
  const isin = String(info?.isin || '').trim().toUpperCase();
  if (!ISIN_RE.test(isin)) return null;

  const value = amount(row.value);
  // `plBase` porte le coût d'acquisition en négatif : value + plBase = P/L.
  const plBase = amount(row.plBase);
  const correction = amount(row.portfolioValueCorrection) ?? 0;
  const todayPlBase = amount(row.todayPlBase);

  const currency = clip(info?.currency, 3);

  return {
    isin,
    symbol: clip(info?.symbol, 20),
    name: clip(info?.name, 255),
    product_type: clip(info?.productType, 20),
    qty: num(row.size),
    price: num(row.price),
    currency: currency && currency.length === 3 ? currency : undefined,
    fx_rate: num(row.averageFxRate),
    break_even_price: num(row.breakEvenPrice),
    value_eur: value === undefined ? undefined : round2(value),
    pl_eur: value !== undefined && plBase !== undefined ? round2(value + plBase + correction) : undefined,
    pl_day_eur: value !== undefined && todayPlBase !== undefined ? round2(value + todayPlBase) : undefined,
  };
}

// ─── Transactions (historique des ordres) ────────────────────────────────────

/** Récupère la liste des ordres, que DEGIRO enveloppe dans `{ data: [...] }`. */
export function parseTransactions(response) {
  const data = response?.data ?? response;
  return Array.isArray(data) ? data : [];
}

/**
 * Convertit une date DEGIRO ISO (« 2024-03-15T09:30:00+01:00 ») en
 * « YYYY-MM-DD HH:MM:SS ». On garde l'heure murale telle que DEGIRO la rapporte
 * (fuseau du compte) : le calcul du réalisé ne raisonne qu'au jour près, et
 * l'import CSV stocke lui aussi l'heure locale sans conversion.
 */
function degiroDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(v ?? ''));
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  return `${y}-${mo}-${d} ${hh}:${mm}:${ss ?? '00'}`;
}

/**
 * Identifiant stable d'un ordre, pour le dédoublonnage (contrainte `uq_external`,
 * globale). On privilégie l'`orderId` (UUID) : globalement unique, et **identique**
 * à celui de l'import Transactions.csv — un même ordre importé par les deux voies
 * ne compte donc qu'une fois. À défaut, un identifiant déterministe reconstruit.
 */
function txExternalId(row, isin) {
  const orderId = String(row?.orderId ?? '').trim();
  if (orderId) return orderId.slice(0, 64);
  const id = row?.id ?? row?.transactionId;
  if (id !== undefined && id !== null && String(id) !== '') return `dgx-tx-${id}`.slice(0, 64);
  const date = degiroDate(row?.date)?.slice(0, 10) ?? '';
  return `dgx-${isin}-${date}-${num(row?.quantity) ?? ''}`.slice(0, 64);
}

/**
 * Assemble un ordre au format normalisé attendu par l'API (table `transactions`).
 * Renvoie `null` sans ISIN exploitable ou sans date : une ligne inclassable.
 *
 * Conventions reprises telles quelles de l'import CSV, dont dépend le calcul des
 * plus-values (`realizedPnl`) : `qty` signée (vente < 0), `amount_eur` brut EUR
 * signé (achat < 0, vente > 0), `amount` = frais.
 */
export function toTransaction(row, info) {
  if (!row || typeof row !== 'object') return null;
  const isin = String(info?.isin || '').trim().toUpperCase();
  if (!ISIN_RE.test(isin)) return null;

  const txDate = degiroDate(row.date);
  if (!txDate) return null;

  let qty = num(row.quantity);
  if (qty === undefined) return null;
  // DEGIRO fournit `quantity` signée ET `buysell` ('B'/'S') : on aligne le signe
  // sur le sens de l'ordre pour ne pas dépendre d'une seule des deux sources.
  const side = String(row.buysell ?? '').toUpperCase();
  if (side === 'S') qty = -Math.abs(qty);
  else if (side === 'B') qty = Math.abs(qty);

  // Montant brut EUR, resigné : achat = sortie de cash (< 0), vente = entrée (> 0).
  const gross = amount(row.totalInBaseCurrency);
  const grossEur = gross === undefined ? undefined : (qty < 0 ? Math.abs(gross) : -Math.abs(gross));
  const fee = amount(row.feeInBaseCurrency);
  const currency = clip(info?.currency, 3);

  return {
    tx_date: txDate,
    type: qty < 0 ? 'sell' : 'buy',
    isin,
    description: clip(info?.name, 255),
    qty: num(qty),
    amount: fee === undefined ? undefined : round2(fee),
    currency: currency && currency.length === 3 ? currency : undefined,
    amount_eur: grossEur === undefined ? undefined : round2(grossEur),
    external_id: txExternalId(row, isin),
  };
}

/** Identifiants produit portés par des transactions (à résoudre en ISIN). */
export const transactionProductIds = (txRows) =>
  txRows.map((t) => String(t?.productId ?? '')).filter((s) => /^\d+$/.test(s));

// ─── Assemblage du payload ────────────────────────────────────────────────────

/**
 * Construit le corps du POST /api/ingest à partir d'une capture DEGIRO :
 * l'instantané (positions détenues + soldées + liquidités) et l'historique des
 * ordres (achats/ventes) pour la vue réalisé/fiscal.
 *
 * `total_value_eur` suit la convention de l'import CSV : titres **plus**
 * liquidités. On préfère le total annoncé par DEGIRO quand il est là, et on
 * retombe sur notre propre somme sinon — l'écart entre les deux est remonté
 * dans le diagnostic pour repérer tout de suite une lecture qui a dérivé.
 */
export function buildPayload({ update, products: infoByLot, transactions, captureId, capturedAt }) {
  const { products, closed, cashEur, cashOther } = parsePortfolio(update);
  const index = indexProducts(infoByLot);

  const positions = [];
  const skipped = [];
  for (const row of products) {
    const position = toPosition(row, index[row.productId]);
    if (position) positions.push(position);
    else skipped.push({ productId: row.productId, name: index[row.productId]?.name || null });
  }
  // Positions soldées : rattachées si l'ISIN se résout, laissées tomber en
  // silence sinon (une ligne déjà fermée n'est pas un problème à signaler).
  let closedSent = 0;
  for (const row of closed) {
    const position = toPosition(row, index[row.productId]);
    if (position) { positions.push(position); closedSent += 1; }
  }

  // Ordres → transactions normalisées ; sans ISIN résolu, l'ordre est ignoré.
  const txRows = parseTransactions(transactions);
  const txs = [];
  for (const row of txRows) {
    const tx = toTransaction(row, index[String(row?.productId ?? '')]);
    if (tx) txs.push(tx);
  }

  const totals = parseTotals(update);
  // Liquidités : on préfère le solde total que DEGIRO a lui-même converti en
  // euros (`reportCashBal`). Sommer nos seules lignes en euros laissait de côté
  // les devises — un solde en dollars alimenté par les dividendes américains —
  // et creusait un écart inexpliqué avec le total affiché par DEGIRO.
  const cash = totals.cash ?? cashEur;
  const summed = round2(positions.reduce((s, p) => s + (p.value_eur || 0), 0) + (cash ?? 0));

  const payload = {
    schema_version: 1,
    source: 'extension',
    capture_id: String(captureId).slice(0, 36),
    captured_at: capturedAt,
    total_value_eur: totals.netLiq ?? summed,
    positions,
    transactions: txs,
  };
  if (cash !== undefined) payload.cash_eur = round2(cash);

  return {
    payload,
    diagnostics: {
      rows: (update?.portfolio?.value || []).length,
      held: products.length,
      closed: closedSent,
      sent: positions.length,
      transactions: txs.length,
      transactionsRead: txRows.length,
      skipped,
      cashEur,
      // Devises non converties, pour expliquer un éventuel reliquat au lieu de
      // laisser l'utilisateur devant un écart nu.
      cashOther,
      degiroTotal: totals.netLiq,
      computedTotal: summed,
      // Un écart > 1 € signale un champ mal lu : à vérifier avant de se fier aux chiffres.
      totalGap: totals.netLiq === undefined ? null : round2(totals.netLiq - summed),
    },
  };
}
