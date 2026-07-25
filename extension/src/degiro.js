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
 * Sépare les lignes du portefeuille : titres détenus d'un côté, liquidités de
 * l'autre. Les lignes soldées (quantité nulle) restent présentes chez DEGIRO :
 * on les écarte, sinon le portefeuille se remplit de fantômes.
 */
export function parsePortfolio(update) {
  const rows = (update?.portfolio?.value || []).map(flattenRow);
  const products = [];
  let cashEur;

  for (const row of rows) {
    const id = String(row.id ?? '');
    const isCash = row.positionType === 'CASH' || (!row.positionType && !/^\d+$/.test(id));

    if (isCash) {
      // L'identifiant vaut « EUR » ou « FLATEX_EUR » selon l'entité qui détient
      // le cash ; les deux comptent, les autres devises non (pas de taux ici).
      if (id.replace(/^FLATEX_/, '') !== 'EUR') continue;
      const value = amount(row.value);
      if (value !== undefined) cashEur = round2((cashEur ?? 0) + value);
      continue;
    }

    if (!num(row.size)) continue;
    products.push({ ...row, productId: id });
  }

  return { products, cashEur };
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

/**
 * Construit le corps du POST /api/ingest à partir d'une capture DEGIRO.
 *
 * `total_value_eur` suit la convention de l'import CSV : titres **plus**
 * liquidités. On préfère le total annoncé par DEGIRO quand il est là, et on
 * retombe sur notre propre somme sinon — l'écart entre les deux est remonté
 * dans le diagnostic pour repérer tout de suite une lecture qui a dérivé.
 */
export function buildPayload({ update, products: infoByLot, captureId, capturedAt }) {
  const { products, cashEur } = parsePortfolio(update);
  const index = indexProducts(infoByLot);

  const positions = [];
  const skipped = [];
  for (const row of products) {
    const position = toPosition(row, index[row.productId]);
    if (position) positions.push(position);
    else skipped.push({ productId: row.productId, name: index[row.productId]?.name || null });
  }

  const totals = parseTotals(update);
  const summed = round2(positions.reduce((s, p) => s + (p.value_eur || 0), 0) + (cashEur ?? 0));

  const payload = {
    schema_version: 1,
    source: 'extension',
    capture_id: String(captureId).slice(0, 36),
    captured_at: capturedAt,
    total_value_eur: totals.netLiq ?? summed,
    positions,
  };
  if (cashEur !== undefined) payload.cash_eur = cashEur;

  return {
    payload,
    diagnostics: {
      rows: (update?.portfolio?.value || []).length,
      held: products.length,
      sent: positions.length,
      skipped,
      cashEur,
      degiroTotal: totals.netLiq,
      computedTotal: summed,
      // Un écart > 1 € signale un champ mal lu : à vérifier avant de se fier aux chiffres.
      totalGap: totals.netLiq === undefined ? null : round2(totals.netLiq - summed),
    },
  };
}
