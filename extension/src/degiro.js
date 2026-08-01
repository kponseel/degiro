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
  const unsized = [];
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
    const entry = { ...row, productId: id };
    if (size === undefined) {
      // Ligne sans quantité exploitable : hors de notre somme, mais gardée à
      // part — si elle porte une valeur, elle explique un écart avec le total
      // DEGIRO, et le diagnostic doit pouvoir la nommer.
      unsized.push(entry);
      continue;
    }
    if (size === 0) closed.push(entry); // position soldée
    else products.push(entry); // position détenue
  }

  return { products, closed, cashEur, cashOther, unsized };
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
 * Regroupe les exécutions partielles d'un même ordre en une seule ligne.
 *
 * Sans agrégation côté DEGIRO (repli `groupTransactionsByOrder=false`), un
 * ordre servi en plusieurs fois arrive en plusieurs lignes qui partagent le
 * même `orderId`. Or l'identifiant externe côté serveur est précisément cet
 * `orderId` : envoyées telles quelles, seules les quantités de la première
 * exécution étaient conservées — les autres disparaissaient en silence, et le
 * prix moyen pondéré était faux d'autant.
 *
 * Sur des lignes déjà agrégées (le cas normal), les `orderId` sont uniques et
 * cette fonction est neutre.
 */
export function aggregateByOrder(rows) {
  const parOrdre = new Map();
  const out = [];
  for (const row of rows || []) {
    const oid = String(row?.orderId ?? '').trim();
    if (!oid) { out.push(row); continue; }
    const cumul = parOrdre.get(oid);
    if (!cumul) {
      // Les montants sont normalisés dès la première exécution : DEGIRO les
      // renvoie parfois en objet `{ EUR: x }`, qu'une simple addition ignorerait.
      const copie = { ...row };
      copie.quantity = num(row.quantity);
      copie.totalInBaseCurrency = amount(row.totalInBaseCurrency);
      copie.feeInBaseCurrency = amount(row.feeInBaseCurrency) ?? 0;
      parOrdre.set(oid, copie);
      out.push(copie);
      continue;
    }
    // Quantité : indispensable — une exécution sans quantité rend l'ordre
    // inutilisable, comme le veut toTransaction.
    const q = num(row?.quantity);
    cumul.quantity = cumul.quantity === undefined || q === undefined ? undefined : cumul.quantity + q;
    // Montant : une exécution sans montant rend le TOTAL inconnaissable. Une
    // somme partielle présentée comme complète serait pire qu'une absence.
    const total = amount(row?.totalInBaseCurrency);
    cumul.totalInBaseCurrency = cumul.totalInBaseCurrency === undefined || total === undefined
      ? undefined
      : cumul.totalInBaseCurrency + total;
    // Frais : un frais absent vaut zéro (cas normal d'une exécution sans frais).
    cumul.feeInBaseCurrency += amount(row?.feeInBaseCurrency) ?? 0;
    // La date la plus ancienne fait foi.
    if (row?.date && (!cumul.date || String(row.date) < String(cumul.date))) cumul.date = row.date;
  }
  return out;
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
export function buildPayload({
  update, products: infoByLot, transactions, cashMovements = [], captureId, capturedAt,
}) {
  const { products, closed, cashEur, cashOther, unsized } = parsePortfolio(update);
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
  const txRows = aggregateByOrder(parseTransactions(transactions));
  const txs = [];
  for (const row of txRows) {
    const tx = toTransaction(row, index[String(row?.productId ?? '')]);
    if (tx) txs.push(tx);
  }

  // Mouvements du relevé de compte (déjà normalisés par `cash.js`) : on leur
  // rattache l'ISIN quand le produit a pu être résolu. Contrairement aux ordres,
  // un ISIN manquant ne les disqualifie PAS — un versement n'a pas de titre, et
  // un dividende sans ISIN reste un dividende encaissé.
  let cashSent = 0;
  for (const m of cashMovements || []) {
    const info = m.productId ? index[m.productId] : null;
    const isin = String(info?.isin || '').trim().toUpperCase();
    // `productId` ne fait pas partie du contrat d'ingestion : il ne servait qu'à
    // retrouver l'ISIN, et n'a rien à faire dans le payload envoyé.
    const mouvement = { ...m, isin: ISIN_RE.test(isin) ? isin : null };
    delete mouvement.productId;
    txs.push(mouvement);
    cashSent += 1;
  }

  const totals = parseTotals(update);
  const positionsTotal = round2(positions.reduce((s, p) => s + (p.value_eur || 0), 0));

  /**
   * Liquidités — et le piège qu'il a fallu une capture d'écran pour voir.
   *
   * DEGIRO expose DEUX découpages incompatibles du même patrimoine :
   *  - son interface montre « Portfolio » (les titres) et « EUR » (les
   *    liquidités), et le fonds de trésorerie est compté dans les LIQUIDITÉS ;
   *  - son API expose `reportPortfValue` et `reportCashBal`, où ce même fonds
   *    est compté dans les TITRES.
   * Les deux découpages donnent bien le même total (`reportNetliq`), mais nous
   * prenions nos titres d'un côté (sans le fonds, comme l'interface) et nos
   * liquidités de l'autre (`reportCashBal`, sans le fonds non plus). Le fonds
   * tombait donc entre les deux chaises : sur un cas réel, 2 400 € de
   * liquidités disparus, et un « écart » que rien n'expliquait.
   *
   * Le total de DEGIRO faisant foi, les liquidités s'en déduisent : ce qui n'est
   * pas en titres est de la trésorerie. Ce calcul embarque du même coup les
   * soldes en devises, que nous ne savons pas convertir nous-mêmes.
   *
   * Contrepartie assumée : une position dont la valeur n'a pas pu être lue
   * compte pour 0 € dans `positionsTotal` et gonflerait d'autant les liquidités
   * — un titre manquant se déguiserait en cash. C'est le rôle du contrôle plus
   * bas, qui confronte NOS deux lectures indépendantes au total de DEGIRO et
   * rend cet accident bruyant, tandis que la liste des suspects nomme la ligne.
   */
  const cash = totals.netLiq !== undefined
    ? round2(totals.netLiq - positionsTotal)
    : totals.cash ?? cashEur;
  const cashSource = totals.netLiq !== undefined
    ? 'DEGIRO (total − titres)'
    : (totals.cash !== undefined ? 'DEGIRO (converti)' : 'lignes en euros');

  // Ce que `reportCashBal` laisse de côté par rapport à nos propres lignes de
  // trésorerie : le fonds de trésorerie, précisément. Le nommer transforme un
  // écart inexpliqué en une ligne de diagnostic qui se lit.
  const fondsTresorerie = cashEur !== undefined && totals.cash !== undefined
    ? round2(cashEur - totals.cash) : null;

  // Répartition par devise de cotation : ce que nous sommons (`value`) face à
  // `cours × quantité`, la valeur exprimée dans la devise du titre.
  //
  // Sur une ligne convertie par DEGIRO, le second vaut le premier multiplié par
  // le taux de change. S'ils sont ÉGAUX sur une devise étrangère, c'est que la
  // valeur reçue est LOCALE et que nous la comptons comme des euros — ce qui
  // fausserait le total sans qu'aucun contrôle actuel ne s'en aperçoive, tous
  // se limitant aux lignes en euros. C'est la mesure qui tranche un écart dont
  // aucune ligne ne semble responsable.
  const parDevise = [...products.reduce((acc, row) => {
    const devise = String(index[row.productId]?.currency || '?').toUpperCase();
    const e = acc.get(devise) || { devise, lignes: 0, valeur: 0, local: 0, localConnu: true };
    const prix = num(row.price);
    const qte = num(row.size);
    e.lignes += 1;
    e.valeur += amount(row.value) ?? 0;
    if (prix === undefined || qte === undefined) e.localConnu = false;
    else e.local += prix * qte;
    return acc.set(devise, e);
  }, new Map()).values()].map((e) => ({
    ...e, valeur: round2(e.valeur), local: e.localConnu ? round2(e.local) : null,
  }));
  // Contrôle de cohérence : NOS deux lectures indépendantes (titres lus ligne à
  // ligne + trésorerie lue ligne à ligne) face au total de DEGIRO. Comparer
  // `cash` — désormais déduit de ce total — l'aurait rendu tautologique : c'est
  // exactement ce qui masquait le problème, le diagnostic annonçant « liquidités
  // exactes au centime » en confrontant le chiffre de DEGIRO à lui-même.
  //
  // Sans ligne de trésorerie en euros, il n'y a pas de seconde lecture : le
  // contrôle est alors ANNULÉ plutôt que faussé. Le faire tourner quand même
  // aurait crié « écart de 7 600 € » là où il ne manque rien — le genre de
  // fausse alerte qui envoie chercher un bug inexistant.
  const summed = cashEur === undefined ? undefined : round2(positionsTotal + cashEur);
  const totalRetenu = totals.netLiq ?? summed ?? round2(positionsTotal + (cash ?? 0));
  const totalGap = totals.netLiq === undefined || summed === undefined
    ? null : round2(totals.netLiq - summed);

  /**
   * L'angle mort assumé du contrôle ci-dessus : un solde en devise étrangère
   * compte dans le total de DEGIRO (qui le convertit) mais pas dans notre somme
   * (cette réponse ne porte aucun taux de change). Le reliquat vaut alors
   * « erreur de lecture + devises non converties », et crier à l'erreur serait
   * une fausse alerte.
   *
   * Le plafond — deux fois le montant local — couvre largement toute devise
   * négociable chez DEGIRO (l'euro n'en vaut jamais le double) sans dégénérer en
   * blanc-seing : un titre mal lu de 20 000 € ne passera pas pour du change sur
   * 115 $ de dividendes.
   */
  const plafondDevises = round2(cashOther.reduce((s, c) => s + Math.abs(c.value), 0) * 2);
  const gapExplique = totalGap !== null && totalGap > 0 && totalGap <= plafondDevises;

  // ── Pistes pour un écart côté titres ─────────────────────────────────
  // Un « écart de 1 412 € » nu ne se corrige pas ; « Worldline : valeur
  // incohérente » se vérifie en dix secondes. Trois familles de suspects :
  // ligne valorisée mais sans quantité (exclue de notre somme), valeur reçue
  // dans une autre devise que l'euro (prise telle quelle, elle fausse la
  // somme), et action/ETF en euros dont la valeur DEGIRO contredit
  // cours × quantité (donnée DEGIRO elle-même incohérente — cas des
  // opérations sur titres mal répercutées).
  const suspects = [];
  const nomDe = (row) => index[row.productId]?.name || `produit ${row.productId}`;

  // `portfolioValueCorrection` : DEGIRO l'applique à certains produits pour
  // arriver à son total, nous ne l'ajoutons pas à `value`. Quand un écart
  // subsiste sans qu'aucune ligne ne paraisse fautive, c'est le premier chiffre
  // à comparer — s'il vaut l'écart, la cause est trouvée d'un coup d'œil.
  const corrections = round2([...products, ...closed]
    .reduce((s, r) => s + (amount(r.portfolioValueCorrection) ?? 0), 0));
  if (Math.abs(corrections) > 1) {
    suspects.push(`corrections de valeur DEGIRO non appliquées : ${corrections} € au total`);
  }
  for (const row of unsized) {
    const v = amount(row.value);
    if (v) suspects.push(`${nomDe(row)} : valorisée ${round2(v)} € mais sans quantité — hors de notre somme`);
  }
  // Position détenue dont la VALEUR n'a pas pu être lue : elle compte pour 0 €
  // dans notre somme et creuse l'écart d'autant. C'était le point aveugle des
  // contrôles ci-dessous, qui exigent tous une valeur pour se déclencher — une
  // ligne sans valeur leur échappait donc par construction.
  for (const row of products) {
    if (num(row.size) && amount(row.value) === undefined) {
      suspects.push(`${nomDe(row)} : aucune valeur lue — compte pour 0 € dans notre total`);
    }
  }
  for (const row of [...products, ...closed]) {
    const info = index[row.productId] || {};
    if (row.value && typeof row.value === 'object' && !('EUR' in row.value)) {
      suspects.push(`${nomDe(row)} : valeur reçue en ${Object.keys(row.value)[0] || 'devise inconnue'}, pas en euros`);
      continue;
    }
    const value = amount(row.value);
    const price = num(row.price);
    const size = num(row.size);
    if (info.currency === 'EUR' && size
      && ['STOCK', 'ETF', 'FUND', 'ETC', 'ETN'].includes(String(info.productType || '').toUpperCase())
      && value !== undefined && price !== undefined) {
      const attendu = round2(price * size);
      if (Math.abs(attendu - value) > Math.max(2, Math.abs(value) * 0.01)) {
        suspects.push(`${nomDe(row)} : valeur DEGIRO ${round2(value)} € ≠ cours × quantité ${attendu} €`);
      }
    }
  }

  const payload = {
    schema_version: 1,
    source: 'extension',
    capture_id: String(captureId).slice(0, 36),
    captured_at: capturedAt,
    total_value_eur: totalRetenu,
    positions,
    transactions: txs,
  };
  if (cash !== undefined) payload.cash_eur = round2(cash);

  return {
    payload,
    diagnostics: {
      rows: (update?.portfolio?.value || []).length,
      held: products.length,
      // Positions détenues dont la valeur a pu être lue : distingue « il manque
      // une ligne » de « la valorisation ligne à ligne diverge ».
      valued: products.filter((r) => amount(r.value) !== undefined).length,
      closed: closedSent,
      sent: positions.length,
      transactions: txs.length,
      transactionsRead: txRows.length,
      // Mouvements du relevé compris dans `transactions` : les distinguer permet
      // au diagnostic de dire ce qui vient des ordres et ce qui vient du relevé.
      cashMovements: cashSent,
      skipped,
      cashEur,
      // Devises non converties, pour expliquer un éventuel reliquat au lieu de
      // laisser l'utilisateur devant un écart nu.
      cashOther,
      // Décomposition de notre total : sans elle, un écart ne désigne pas son
      // origine — titres mal lus, ou liquidités mal comptées.
      positionsTotal,
      cash: cash === undefined ? undefined : round2(cash),
      cashSource,
      degiroPositions: totals.positions,
      degiroCash: totals.cash,
      degiroTotal: totals.netLiq,
      computedTotal: summed ?? totalRetenu,
      // Un écart > 1 € signale un champ mal lu : à vérifier avant de se fier aux chiffres.
      totalGap,
      // …sauf s'il tient dans les soldes en devises que nous ne convertissons pas.
      gapExplique,
      // Lignes qui peuvent expliquer un écart côté titres, nommées.
      suspects,
      // Ventilation par devise : tranche un écart qu'aucune ligne n'explique.
      parDevise,
      // Fonds de trésorerie : compté en titres par l'API, en liquidités par
      // l'interface DEGIRO. Explique l'essentiel des écarts constatés.
      fondsTresorerie,
    },
  };
}
