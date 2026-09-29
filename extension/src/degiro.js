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

/** Médiane : la moyenne se laisserait déplacer par la valeur aberrante qu'on cherche. */
export function mediane(xs) {
  const t = [...xs].filter(Number.isFinite).sort((a, b) => a - b);
  if (!t.length) return null;
  const m = t.length >> 1;
  return t.length % 2 ? t[m] : (t[m - 1] + t[m]) / 2;
}

/** En dessous, la médiane d'une devise ne prouve rien : deux lignes se valent. */
export const MIN_COHORTE = 3;

/**
 * Sépare les lignes du portefeuille : titres détenus, positions **soldées** et
 * liquidités.
 *
 * Les lignes soldées (quantité nulle) restent présentes chez DEGIRO. Elles sont
 * isolées (`closed`) pour ne pas polluer les positions détenues ; seules les
 * vérifications de cohérence les consultent encore.
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

// ─── Assemblage du payload ────────────────────────────────────────────────────

/**
 * Construit le corps du POST /api/ingest à partir d'une capture DEGIRO :
 * l'instantané du portefeuille OUVERT — positions détenues et liquidités.
 *
 * Les positions soldées et l'historique des ordres ne sont plus envoyés :
 * l'application n'analyse plus que ce qui est détenu aujourd'hui.
 *
 * `total_value_eur` suit la convention de l'import CSV : titres **plus**
 * liquidités. On préfère le total annoncé par DEGIRO quand il est là, et on
 * retombe sur notre propre somme sinon — l'écart entre les deux est remonté
 * dans le diagnostic pour repérer tout de suite une lecture qui a dérivé.
 */
export function buildPayload({
  update, products: infoByLot, captureId, capturedAt,
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

  const totals = parseTotals(update);
  const positionsTotal = round2(positions.reduce((s, p) => s + (p.value_eur || 0), 0));

  // Ce que `reportCashBal` laisse de côté par rapport à nos propres lignes de
  // trésorerie : le fonds de trésorerie, précisément. Le nommer transforme un
  // écart inexpliqué en une ligne de diagnostic qui se lit.
  const fondsTresorerie = cashEur !== undefined && totals.cash !== undefined
    ? round2(cashEur - totals.cash) : null;

  /**
   * Détail par devise de cotation, LIGNE À LIGNE.
   *
   * Chaque position porte deux expressions de la même chose : `value`, déjà
   * convertie en euros par DEGIRO, et `cours × quantité`, exprimé dans la devise
   * du titre. Leur rapport est le taux de change appliqué à cette ligne.
   *
   * Or à un instant donné il n'existe qu'UN taux par devise. Toutes les lignes
   * d'une même devise doivent donc afficher le même rapport. Ce n'est pas une
   * somme à recouper — c'est une invariance à vérifier, et elle vaut ligne par
   * ligne, donc elle DÉSIGNE la fautive au lieu de rendre un écart global.
   *
   * La référence est la MÉDIANE des rapports observés, pas leur moyenne : une
   * ligne aberrante ne peut pas déplacer la médiane et se blanchir elle-même.
   * En euros elle vaut 1 par définition. Sous trois lignes, la médiane ne prouve
   * rien : la devise est déclarée non contrôlée plutôt que réputée saine.
   */
  const suspectsDevise = [];
  const cohortes = new Map();
  for (const row of products) {
    const devise = String(index[row.productId]?.currency || '?').toUpperCase();
    const prix = num(row.price);
    const qte = num(row.size);
    const e = cohortes.get(devise) || { devise, lignes: [] };
    e.lignes.push({
      nom: index[row.productId]?.name || `produit ${row.productId}`,
      valeur: amount(row.value),
      local: prix === undefined || qte === undefined ? undefined : prix * qte,
    });
    cohortes.set(devise, e);
  }

  const parDevise = [...cohortes.values()].map(({ devise, lignes }) => {
    const mesurables = lignes.filter((l) => l.valeur !== undefined && l.local > 0);
    const taux = devise === 'EUR' ? 1 : mediane(mesurables.map((l) => l.valeur / l.local));
    const controlee = devise === 'EUR' ? mesurables.length > 0 : mesurables.length >= MIN_COHORTE;
    let dispersion = 0;
    const ecarts = [];
    if (taux) {
      for (const l of mesurables) {
        const r = l.valeur / l.local;
        const derive = Math.abs(r / taux - 1);
        if (derive > dispersion) dispersion = derive;
        const attendu = l.local * taux;
        // Deux seuils, tous deux nécessaires : un écart relatif significatif
        // (0,5 %) pour ne pas signaler l'arrondi au centime, et un écart absolu
        // d'au moins 1 € pour ne pas nommer une ligne dont la correction ne
        // changerait rien au total.
        if (derive > 0.005 && Math.abs(l.valeur - attendu) >= 1) {
          ecarts.push({ nom: l.nom, valeur: round2(l.valeur), attendu: round2(attendu), ecart: round2(l.valeur - attendu) });
        }
      }
    }
    const localConnu = lignes.every((l) => l.local !== undefined);
    return {
      devise,
      lignes: lignes.length,
      valeur: round2(lignes.reduce((s2, l) => s2 + (l.valeur ?? 0), 0)),
      local: localConnu ? round2(lignes.reduce((s2, l) => s2 + l.local, 0)) : null,
      taux: taux ? Math.round(taux * 1e6) / 1e6 : null,
      dispersion: Math.round(dispersion * 1e6) / 1e6,
      controlee,
      // Triés par impact décroissant : la première ligne est celle à regarder.
      ecarts: ecarts.sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart)).slice(0, 5),
    };
  });
  for (const d of parDevise) {
    for (const e of d.ecarts) {
      suspectsDevise.push(`${e.nom} : ${e.valeur} € au lieu de ${e.attendu} € au taux ${d.devise} des autres lignes (${e.ecart > 0 ? '+' : ''}${e.ecart} €)`);
    }
  }

  /**
   * Liquidités : NOS lignes de trésorerie, telles que l'interface DEGIRO les
   * affiche sous « EUR » (fonds de trésorerie compris).
   *
   * DEGIRO expose deux découpages incompatibles du même patrimoine : son
   * interface range le fonds de trésorerie dans les liquidités, son API
   * (`reportPortfValue` / `reportCashBal`) dans les titres. Nos lignes de
   * trésorerie suivent l'interface, au centime près (vérifié sur un compte réel :
   * 9 995,51 € des deux côtés).
   *
   * On déduisait auparavant les liquidités du total DEGIRO (total − titres). Or
   * ce total convertit les titres en dollars à un taux légèrement différent de
   * celui de leurs lignes : l'écart de change (92 à 468 € selon les jours)
   * atterrissait dans les liquidités, qui n'avaient plus rien à voir avec
   * l'écran de DEGIRO. La déduction ne sert plus que de repli, faute de ligne de
   * trésorerie lisible.
   *
   * Les soldes en devise sont convertis au taux de leurs propres titres quand il
   * y en a (ce que DEGIRO applique à ces lignes) ; sans titre dans la devise, ils
   * restent de côté et le diagnostic les nomme.
   */
  const tauxDe = (devise) => parDevise.find((d) => d.devise === devise)?.taux ?? null;
  const devisesConverties = cashOther
    .filter((c) => tauxDe(c.currency))
    .map((c) => ({ ...c, eur: round2(c.value * tauxDe(c.currency)) }));
  let cash;
  let cashSource;
  if (cashEur !== undefined) {
    cash = round2(cashEur + devisesConverties.reduce((s2, c) => s2 + c.eur, 0));
    cashSource = devisesConverties.length ? 'lignes de trésorerie, devises converties' : 'lignes de trésorerie';
  } else if (totals.netLiq !== undefined) {
    cash = round2(totals.netLiq - positionsTotal);
    cashSource = 'DEGIRO (total − titres)';
  } else if (totals.cash !== undefined) {
    cash = round2(totals.cash);
    cashSource = 'DEGIRO (converti)';
  }

  // Contrôle de cohérence : NOS deux lectures indépendantes (titres lus ligne à
  // ligne + trésorerie en euros lue ligne à ligne) face au total de DEGIRO. Rien
  // de ce qui se DÉDUIT de ce total n'y entre : le comparer à lui-même
  // annoncerait « exact au centime » quoi qu'il arrive.
  //
  // Sans ligne de trésorerie en euros, il n'y a pas de seconde lecture : le
  // contrôle est alors ANNULÉ plutôt que faussé. Le faire tourner quand même
  // aurait crié « écart de 7 600 € » là où il ne manque rien — le genre de
  // fausse alerte qui envoie chercher un bug inexistant.
  const summed = cashEur === undefined ? undefined : round2(positionsTotal + cashEur);
  // Le total affiché par DEGIRO fait foi (c'est celui que l'utilisateur compare) :
  // arrondi au centime, DEGIRO le livrant avec six décimales.
  const totalRetenu = round2(totals.netLiq ?? summed ?? (positionsTotal + (cash ?? 0)));
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
  /**
   * Titres que DEGIRO compte et que nous ne retrouvons sur aucune ligne.
   *
   * `reportPortfValue` inclut le fonds de trésorerie ; une fois celui-ci retiré,
   * il ne reste que des titres, et notre somme ligne à ligne devrait l'égaler.
   * Ce qui manque encore n'est plus explicable par le fonds — et sans ce chiffre
   * nommé, l'écart restait un total nu qu'aucune piste ne rattachait à rien.
   */
  const titresDegiro = totals.positions !== undefined && fondsTresorerie !== null
    ? round2(totals.positions - fondsTresorerie) : null;
  const titresManquants = titresDegiro === null ? null : round2(titresDegiro - positionsTotal);

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
  // Une ligne soldée (quantité nulle) n'est pas envoyée ; si DEGIRO lui garde
  // pourtant une valeur — vente du jour pas encore dénouée, par exemple — c'est
  // de l'argent qu'il compte et que nous ne voyons pas.
  for (const row of closed) {
    const v = amount(row.value);
    if (v && Math.abs(v) >= 1) suspects.push(`${nomDe(row)} : soldée mais valorisée ${round2(v)} € par DEGIRO — hors de notre somme`);
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

  // L'invariance de change arrive EN DERNIER, et c'est délibéré.
  //
  // Une même ligne peut être attrapée par deux règles : « valeur reçue en USD,
  // pas en euros » dit précisément ce qui cloche, là où « 1 140 € au lieu de
  // 1 000 € au taux EUR des autres lignes » ne fait que le constater. La
  // déduplication qui suit garde la PREMIÈRE mention — les règles spécifiques
  // doivent donc passer avant la règle générale, sans quoi le message le plus
  // utile serait celui qu'on écarte.
  const vus = new Set();
  const pistes = [...suspects, ...suspectsDevise].filter((texte) => {
    const nom = String(texte).split(' : ')[0];
    if (vus.has(nom)) return false;
    vus.add(nom);
    return true;
  });

  /**
   * Écart de change entre les lignes et le total DEGIRO.
   *
   * Constaté sur un compte réel à chaque capture : lignes en euros exactes au
   * centime, lignes en dollars toutes au MÊME taux (dispersion nulle), et
   * pourtant un total DEGIRO plus haut de 0,3 à 0,9 % de la poche en dollars.
   * Aucune ligne n'est mal lue : DEGIRO convertit son total à un autre taux que
   * ses lignes. Crier « ✗ écart » à chaque capture enverrait chercher un bug
   * qui n'existe pas.
   *
   * Conditions, toutes nécessaires : aucune piste nominative, toutes les lignes
   * valorisées, chaque devise contrôlée cohérente, et un écart qui tient dans 2 %
   * des titres en devises. Un portefeuille tout en euros n'en bénéficie jamais :
   * son écart ne peut pas venir du change.
   */
  const poche = parDevise.filter((d) => d.devise !== 'EUR' && d.devise !== '?');
  const valeurPoche = round2(poche.reduce((s2, d) => s2 + d.valeur, 0));
  const localConnu = poche.length === 1 && poche[0].local;
  const ecartChange = totalGap !== null && Math.abs(totalGap) > 1 && !gapExplique
    && !pistes.length
    && products.every((r) => amount(r.value) !== undefined)
    && parDevise.every((d) => !d.controlee || d.dispersion <= 0.005)
    && valeurPoche > 0 && Math.abs(totalGap) <= valeurPoche * 0.02
    ? {
      devises: poche.map((d) => d.devise),
      part: Math.round((totalGap / valeurPoche) * 1e4) / 1e4,
      // Une seule devise : le taux que le total DEGIRO implique, face à celui des lignes.
      tauxLignes: poche.length === 1 ? poche[0].taux : null,
      tauxTotal: localConnu ? Math.round(((valeurPoche + totalGap) / poche[0].local) * 1e6) / 1e6 : null,
    }
    : null;

  const payload = {
    schema_version: 1,
    source: 'extension',
    capture_id: String(captureId).slice(0, 36),
    captured_at: capturedAt,
    total_value_eur: totalRetenu,
    positions,
  };
  if (cash !== undefined) payload.cash_eur = cash;

  return {
    payload,
    diagnostics: {
      rows: (update?.portfolio?.value || []).length,
      held: products.length,
      // Positions détenues dont la valeur a pu être lue : distingue « il manque
      // une ligne » de « la valorisation ligne à ligne diverge ».
      valued: products.filter((r) => amount(r.value) !== undefined).length,
      sent: positions.length,
      skipped,
      cashEur,
      // Devises non converties, pour expliquer un éventuel reliquat au lieu de
      // laisser l'utilisateur devant un écart nu.
      cashOther,
      // Décomposition de notre total : sans elle, un écart ne désigne pas son
      // origine — titres mal lus, ou liquidités mal comptées.
      positionsTotal,
      cash,
      cashSource,
      // Soldes en devise inclus dans `cash`, convertis au taux de leurs titres.
      devisesConverties,
      degiroPositions: totals.positions === undefined ? undefined : round2(totals.positions),
      degiroCash: totals.cash === undefined ? undefined : round2(totals.cash),
      degiroTotal: totals.netLiq === undefined ? undefined : round2(totals.netLiq),
      computedTotal: summed ?? totalRetenu,
      // Un écart > 1 € signale un champ mal lu : à vérifier avant de se fier aux chiffres.
      totalGap,
      // …sauf s'il tient dans les soldes en devises que nous ne convertissons pas.
      gapExplique,
      // …ou s'il s'explique par le taux de change du total DEGIRO (voir plus haut).
      ecartChange,
      // Lignes qui peuvent expliquer un écart côté titres, nommées.
      suspects: pistes,
      // Ventilation par devise : tranche un écart qu'aucune ligne n'explique.
      parDevise,
      // Fonds de trésorerie : compté en titres par l'API, en liquidités par
      // l'interface DEGIRO. Explique l'essentiel des écarts constatés.
      fondsTresorerie,
      // Titres selon DEGIRO une fois le fonds retiré, et ce qui nous en manque.
      titresDegiro,
      titresManquants,
    },
  };
}
