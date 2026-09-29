import {
  normalizeSector, normalizeCountry, regionOf, currencyOfCountry, isFund, ETF_CASH,
} from './taxonomy.js';

/**
 * Analyse du portefeuille ouvert. Module PUR (aucune API navigateur), testé
 * depuis le backend : tout ce que les pages Portefeuille et Exposition
 * affichent de calculé passe par ici.
 *
 * Deux bases de poids coexistent, et chaque libellé dit laquelle il utilise :
 *  - « des titres » : la valeur des positions seules (poids d'une ligne) ;
 *  - « du patrimoine » : titres + liquidités (allocation d'ensemble).
 */

export const UNCLASSIFIED = 'Non classé';
/** ETF dont la composition n'est pas importée : leur pays n'est qu'une domiciliation. */
export const FUNDS = 'ETF non éclatés';
export const CASH = 'Liquidités';

/** Clés qui ne sont pas une classification réelle (exclues des scores de diversification). */
const NOT_CLASSIFIED = new Set([UNCLASSIFIED, FUNDS, ETF_CASH]);

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const TYPE_LABEL = {
  STOCK: 'Action', ACTION: 'Action', ETF: 'ETF', ETC: 'ETC', FUND: 'Fonds', FONDS: 'Fonds',
  BOND: 'Obligation', OBLIGATION: 'Obligation', WARRANT: 'Warrant', CFD: 'CFD', OPTION: 'Option',
};

/** Classe d'actifs lisible : référence ISIN, sinon type DEGIRO, sinon déduite du nom. */
export function typeOf(p) {
  const raw = p?.asset_class || p?.product_type;
  if (raw) return TYPE_LABEL[String(raw).toUpperCase()] || String(raw);
  return isFund(p) ? 'ETF' : 'Non typé';
}

/** Rapport gain / coût, `null` quand le coût n'est pas exploitable (jamais inventé). */
const ratio = (gain, value) => {
  if (gain == null || value == null) return null;
  const cost = value - gain;
  return cost > 0 ? gain / cost : null;
};

/** Lignes enrichies : poids, performance, classification normalisée. */
export function enrichLines(positions) {
  const list = (positions || []).filter((p) => num(p.qty) !== 0);
  const invested = list.reduce((s, p) => s + (num(p.value_eur) || 0), 0);
  return list.map((p) => {
    const value = num(p.value_eur) || 0;
    const pl = num(p.pl_eur);
    const day = num(p.pl_day_eur);
    const fund = isFund(p);
    const country = normalizeCountry(p.country);
    return {
      ...p,
      value,
      pl,
      plPct: ratio(pl, value),
      day,
      dayPct: ratio(day, value),
      w: invested > 0 ? value / invested : 0,
      type: typeOf(p),
      fund,
      sectorN: normalizeSector(p.sector),
      countryN: country,
      region: regionOf(country),
    };
  });
}

/** Somme d'un champ, et part de la valeur des lignes où il est connu. */
function covered(lines, field, invested) {
  const known = lines.filter((l) => l[field] != null);
  const sum = known.reduce((s, l) => s + l[field], 0);
  const base = known.reduce((s, l) => s + l.value, 0);
  return { known, sum, coverage: invested > 0 ? base / invested : 0 };
}

/** Indicateurs de concentration, sur les poids « des titres ». */
export function concentration(lines) {
  const w = lines.map((l) => l.w).sort((a, b) => b - a);
  const top = (n) => w.slice(0, n).reduce((s, x) => s + x, 0);
  const hhi = w.reduce((s, x) => s + x * x, 0);
  return {
    n: w.length,
    top1: top(1),
    top5: top(5),
    top10: top(10),
    hhi,
    // « Nombre effectif de lignes » : autant de lignes de poids égal donneraient la
    // même concentration. 27 lignes dont 3 énormes peuvent n'en valoir que 8.
    effective: hhi > 0 ? 1 / hhi : 0,
  };
}

/** Analyse d'ensemble du portefeuille. */
export function analyzePortfolio(pf) {
  const snapshot = pf?.snapshot || {};
  const lines = enrichLines(pf?.positions);
  const invested = lines.reduce((s, l) => s + l.value, 0);
  const cash = num(snapshot.cash_eur);
  const total = num(snapshot.total_value_eur) ?? invested + (cash || 0);
  const patrimoine = invested + Math.max(0, cash || 0);

  const pl = covered(lines, 'pl', invested);
  const plCost = pl.known.reduce((s, l) => s + (l.value - l.pl), 0);
  const day = covered(lines, 'day', invested);
  const dayBase = day.known.reduce((s, l) => s + (l.value - l.day), 0);

  // Allocation du patrimoine : classes d'actifs + liquidités, base = titres + liquidités.
  const byType = new Map();
  for (const l of lines) byType.set(l.type, (byType.get(l.type) || 0) + l.value);
  if (cash > 0) byType.set(CASH, cash);
  const allocation = [...byType.entries()]
    .map(([key, value]) => ({ key, value, weight: patrimoine > 0 ? value / patrimoine : 0 }))
    .sort((a, b) => b.value - a.value);

  const withPl = lines.filter((l) => l.pl != null);
  const gainers = withPl.filter((l) => l.pl > 0).sort((a, b) => b.pl - a.pl);
  const losers = withPl.filter((l) => l.pl < 0).sort((a, b) => a.pl - b.pl);
  const withDay = lines.filter((l) => l.dayPct != null);
  const dayUp = withDay.filter((l) => l.day > 0).sort((a, b) => b.dayPct - a.dayPct);
  const dayDown = withDay.filter((l) => l.day < 0).sort((a, b) => a.dayPct - b.dayPct);

  const dust = lines.filter((l) => l.w < 0.01);
  const nonEur = lines.filter((l) => l.currency && l.currency !== 'EUR').reduce((s, l) => s + l.value, 0);

  return {
    snapshot,
    lines,
    invested,
    cash,
    total,
    patrimoine,
    cashShare: patrimoine > 0 && cash != null ? Math.max(0, cash) / patrimoine : null,
    pl: pl.known.length ? { total: pl.sum, pct: plCost > 0 ? pl.sum / plCost : null, cost: plCost, coverage: pl.coverage } : null,
    day: day.known.length ? { total: day.sum, pct: dayBase > 0 ? day.sum / dayBase : null, coverage: day.coverage } : null,
    allocation,
    concentration: concentration(lines),
    gainers,
    losers,
    dayUp,
    dayDown,
    dust: { count: dust.length, share: dust.reduce((s, l) => s + l.w, 0), isins: dust.map((l) => l.isin) },
    nonEurShare: invested > 0 ? nonEur / invested : 0,
    funds: lines.filter((l) => l.fund).reduce((s, l) => s + l.w, 0),
  };
}

// ── Répartitions ────────────────────────────────────────────────────

export const DIMENSIONS = {
  sector: 'Secteur',
  region: 'Région',
  country: 'Pays',
  currency: 'Devise économique',
  quote: 'Devise de cotation',
  type: "Classe d'actifs",
};

/** Clé d'une ligne détenue en direct pour une dimension. */
function directKey(l, dim) {
  switch (dim) {
    case 'sector': return l.fund ? FUNDS : (l.sectorN || UNCLASSIFIED);
    case 'country': return l.fund ? FUNDS : (l.countryN || UNCLASSIFIED);
    case 'region': return l.fund ? FUNDS : (l.region || UNCLASSIFIED);
    // Action : devise du pays de la société (un ADR coté en dollars sur une société
    // chinoise reste exposé au yuan) ; à défaut, sa devise de cotation.
    case 'currency': return l.fund ? FUNDS : (currencyOfCountry(l.countryN) || l.currency || UNCLASSIFIED);
    case 'quote': return l.currency || UNCLASSIFIED;
    case 'type': return l.type;
    default: return UNCLASSIFIED;
  }
}

/** Clé d'un constituant d'ETF (vue éclatée). */
function constituentKey(h, dim) {
  if (/·\s*reste$/i.test(h.name || '')) return UNCLASSIFIED;
  const sector = normalizeSector(h.sector);
  const country = normalizeCountry(h.country);
  switch (dim) {
    case 'sector': return sector || UNCLASSIFIED;
    case 'country': return sector === ETF_CASH ? ETF_CASH : (country || UNCLASSIFIED);
    case 'region': return sector === ETF_CASH ? ETF_CASH : (regionOf(country) || UNCLASSIFIED);
    case 'currency': return sector === ETF_CASH ? ETF_CASH : (currencyOfCountry(country) || UNCLASSIFIED);
    case 'type': return 'Action (via ETF)';
    default: return UNCLASSIFIED;
  }
}

/** Vrai quand la réponse du look-through éclate au moins un ETF. */
export const hasLookthrough = (lt) => Boolean(lt && lt.coveredCount > 0 && lt.trueHoldings?.length);

/**
 * Morceaux du portefeuille à classer : une ligne par position en vue directe ;
 * en vue éclatée, la part DIRECTE de chaque titre (classée comme sa ligne) et sa
 * part VIA ETF (classée d'après la composition importée).
 *
 * S'appuie sur `trueHoldings` de /api/lookthrough : un titre détenu en direct et
 * via un ETF n'y forme qu'une entrée, avec les deux montants.
 */
function parts(lines, lookthrough) {
  if (!hasLookthrough(lookthrough)) {
    return lines.map((l) => ({ name: l.name || l.isin, isin: l.isin, value: l.value, via: false, key: (d) => directKey(l, d) }));
  }
  const lineByIsin = new Map(lines.map((l) => [l.isin, l]));
  const out = [];
  for (const e of lookthrough.trueHoldings) {
    const direct = num(e.direct) || 0;
    const via = num(e.viaEtf) || 0;
    if (direct > 0.005) {
      const l = e.isin ? lineByIsin.get(e.isin) : null;
      out.push({ name: e.name, isin: e.isin, value: direct, via: false, key: (d) => (l ? directKey(l, d) : constituentKey(e, d)) });
    }
    if (via > 0.005) out.push({ name: e.name, isin: e.isin, value: via, via: true, key: (d) => constituentKey(e, d) });
  }
  return out;
}

/**
 * Répartition des titres selon une dimension.
 *
 * `lookthrough` (réponse de /api/lookthrough) active la vue ÉCLATÉE : chaque ETF
 * dont la composition est importée est remplacé par ses constituants, au prorata
 * de leur poids. La devise de cotation n'a pas de sens éclatée : elle reste directe.
 *
 * @returns {Array<{ key, value, weight, items: Array<{ name, isin, value, direct, viaEtf }> }>}
 */
export function breakdown(lines, dim, lookthrough = null) {
  const buckets = new Map();
  for (const part of parts(lines, dim === 'quote' ? null : lookthrough)) {
    const key = part.key(dim);
    if (!buckets.has(key)) buckets.set(key, { key, value: 0, items: [] });
    const b = buckets.get(key);
    b.value += part.value;
    b.items.push(part);
  }
  const total = lines.reduce((s, l) => s + l.value, 0);
  return [...buckets.values()]
    .map((b) => ({
      key: b.key,
      value: b.value,
      weight: total > 0 ? b.value / total : 0,
      // Un titre détenu en direct ET via un ETF ne forme qu'une entrée.
      items: mergeItems(b.items).sort((x, y) => y.value - x.value),
    }))
    // Ce qui n'est pas une classification (non classé, ETF non éclatés…) passe
    // en dernier : intercalé entre deux régions, il se lisait comme une région.
    .sort((a, b) => (NOT_CLASSIFIED.has(a.key) - NOT_CLASSIFIED.has(b.key)) || b.value - a.value);
}

function mergeItems(items) {
  const m = new Map();
  for (const it of items) {
    const k = it.isin || `name:${String(it.name).toLowerCase()}`;
    const e = m.get(k) || { name: it.name, isin: it.isin, value: 0, direct: 0, viaEtf: 0 };
    e.value += it.value;
    if (it.via) e.viaEtf += it.value; else e.direct += it.value;
    m.set(k, e);
  }
  return [...m.values()];
}


/**
 * Diversification d'une répartition : nombre effectif de catégories (1/HHI),
 * calculé sur la seule part classée, et part de cette assiette.
 */
export function diversification(rows) {
  const known = rows.filter((r) => !NOT_CLASSIFIED.has(r.key));
  const base = known.reduce((s, r) => s + r.weight, 0);
  if (base <= 0) return { effective: 0, count: 0, coverage: 0, top: null };
  const hhi = known.reduce((s, r) => s + (r.weight / base) ** 2, 0);
  return {
    effective: 1 / hhi,
    count: known.length,
    coverage: base,
    top: known[0] ? { key: known[0].key, weight: known[0].weight } : null,
  };
}

/**
 * Tableau croisé secteur × région (poids des titres). Lignes : les `maxRows`
 * premiers secteurs, le reste replié en « Autres secteurs ».
 */
export function crossTab(lines, lookthrough = null, maxRows = 8) {
  const total = lines.reduce((s, l) => s + l.value, 0);
  const sectors = breakdown(lines, 'sector', lookthrough);
  const keep = new Set(sectors.slice(0, maxRows).map((x) => x.key));
  const rows = [...keep, ...(sectors.length > maxRows ? ['Autres secteurs'] : [])];
  const cols = breakdown(lines, 'region', lookthrough).map((r) => r.key);
  const grid = new Map();
  for (const part of parts(lines, lookthrough)) {
    const sKey = part.key('sector');
    const k = `${keep.has(sKey) ? sKey : 'Autres secteurs'}\u0000${part.key('region')}`;
    grid.set(k, (grid.get(k) || 0) + part.value);
  }
  const share = (v) => (total > 0 ? v / total : 0);
  return {
    rows,
    cols,
    cell: (s, r) => share(grid.get(`${s}\u0000${r}`) || 0),
    max: Math.max(0, ...[...grid.values()].map(share)),
  };
}

// ── Points d'attention ──────────────────────────────────────────────

const pct = (x) => `${(x * 100).toFixed(1).replace('.', ',')} %`;
const eur = (x) => `${Math.round(x).toLocaleString('fr-FR')} €`;

/**
 * Constats chiffrés, du plus important au moins important. Ce sont des faits
 * sur le portefeuille, pas des conseils : chacun dit ce qu'il mesure et, quand
 * c'est possible, désigne les lignes concernées (`isins`) pour les filtrer.
 *
 * @returns {Array<{ id, level: 'warn'|'info', title, detail, isins?, route? }>}
 */
export function attentionPoints(a, { lookthrough = null, sectors = null } = {}) {
  const out = [];
  const { lines, concentration: c } = a;
  if (!lines.length) return out;

  const big = lines.filter((l) => l.w >= 0.1).sort((x, y) => y.w - x.w);
  if (big.length) {
    out.push({
      id: 'big',
      level: big[0].w >= 0.15 ? 'warn' : 'info',
      title: big.length === 1
        ? `${big[0].name || big[0].isin} pèse ${pct(big[0].w)} de tes titres`
        : `${big.length} lignes pèsent chacune 10 % ou plus de tes titres`,
      detail: `Une baisse de 20 % sur ${big.length === 1 ? 'cette ligne' : 'ces lignes'} coûterait ${eur(big.reduce((s, l) => s + l.value, 0) * 0.2)}.`,
      isins: big.map((l) => l.isin),
    });
  }
  if (c.n >= 8 && c.top5 >= 0.5) {
    out.push({
      id: 'top5',
      level: 'info',
      title: `Tes 5 premières lignes font ${pct(c.top5)} de tes titres`,
      detail: `${c.n} lignes, mais une concentration équivalente à ${c.effective.toFixed(1).replace('.', ',')} lignes de même poids.`,
      isins: [...lines].sort((x, y) => y.w - x.w).slice(0, 5).map((l) => l.isin),
    });
  }
  const topSector = sectors?.find((s) => !NOT_CLASSIFIED.has(s.key));
  if (topSector && topSector.weight >= 0.35) {
    out.push({
      id: 'sector',
      level: topSector.weight >= 0.5 ? 'warn' : 'info',
      title: `${pct(topSector.weight)} de tes titres dans un seul secteur : ${topSector.key}`,
      detail: lookthrough ? 'Mesuré avec tes ETF éclatés.' : 'Mesuré sur tes lignes en direct (ETF non éclatés à part).',
      route: 'exposure',
    });
  }
  if (a.nonEurShare >= 0.5) {
    out.push({
      id: 'fx',
      level: 'info',
      title: `${pct(a.nonEurShare)} de tes titres cotent hors euro`,
      detail: `Une variation de 10 % des devises contre l'euro ferait bouger ton portefeuille d'environ ${eur(a.invested * a.nonEurShare * 0.1)}, à cours inchangés.`,
      route: 'exposure',
    });
  }
  const deepLoss = lines.filter((l) => l.plPct != null && l.plPct <= -0.3);
  if (deepLoss.length) {
    out.push({
      id: 'loss',
      level: 'warn',
      title: `${deepLoss.length} ligne${deepLoss.length > 1 ? 's perdent' : ' perd'} plus de 30 %`,
      detail: `${eur(-deepLoss.reduce((s, l) => s + l.pl, 0))} de moins-value latente au total sur ${deepLoss.length > 1 ? 'ces lignes' : 'cette ligne'}.`,
      isins: deepLoss.map((l) => l.isin),
    });
  }
  const doubled = lines.filter((l) => l.plPct != null && l.plPct >= 1);
  if (doubled.length) {
    out.push({
      id: 'doubled',
      level: 'info',
      title: `${doubled.length} ligne${doubled.length > 1 ? 's ont' : ' a'} plus que doublé`,
      detail: `Leur poids a mécaniquement grossi : ${pct(doubled.reduce((s, l) => s + l.w, 0))} de tes titres aujourd'hui.`,
      isins: doubled.map((l) => l.isin),
    });
  }
  if (a.dust.count >= 3) {
    out.push({
      id: 'dust',
      level: 'info',
      title: `${a.dust.count} lignes pèsent moins de 1 % chacune`,
      detail: `${pct(a.dust.share)} de tes titres au total : elles comptent peu dans le résultat, mais autant qu'une autre dans le suivi.`,
      isins: a.dust.isins,
    });
  }
  if (a.cashShare != null && a.cashShare >= 0.25) {
    out.push({
      id: 'cash',
      level: 'info',
      title: `${pct(a.cashShare)} de ton patrimoine est en liquidités`,
      detail: `${eur(a.cash)} non investis.`,
    });
  }
  const overlaps = lookthrough?.overlaps || [];
  if (overlaps.length) {
    out.push({
      id: 'overlap',
      level: 'warn',
      title: `${overlaps.length} titre${overlaps.length > 1 ? 's détenus' : ' détenu'} en direct et via un ETF`,
      detail: `${overlaps.slice(0, 3).map((o) => o.name).join(', ')}${overlaps.length > 3 ? '…' : ''} : ton exposition réelle dépasse le poids de la ligne.`,
      isins: overlaps.map((o) => o.isin).filter(Boolean),
      route: 'exposure',
    });
  }
  const unclassified = lines.filter((l) => !l.fund && !l.sectorN).reduce((s, l) => s + l.w, 0);
  if (unclassified >= 0.2) {
    out.push({
      id: 'quality',
      level: 'info',
      title: `${pct(unclassified)} de tes titres n'ont pas de secteur`,
      detail: 'Lance l’enrichissement ou complète-les dans Import / Extension → Références ISIN.',
      route: 'import',
    });
  }
  if (!a.pl) {
    out.push({
      id: 'nopl',
      level: 'info',
      title: 'Plus-values et variation du jour indisponibles',
      detail: 'Portfolio.csv ne les contient pas : une capture avec l’extension les ajoute.',
      route: 'import',
    });
  }
  return out;
}

/** Export CSV des lignes (séparateur « ; », décimales à virgule : Excel FR l'ouvre tel quel). */
export function linesToCsv(lines) {
  const cell = (v) => {
    if (v == null) return '';
    if (typeof v === 'number') return String(Math.round(v * 1e4) / 1e4).replace('.', ',');
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Titre', 'ISIN', 'Ticker', 'Type', 'Secteur', 'Pays', 'Région', 'Devise', 'Quantité', 'Cours',
    'PRU', 'Valeur €', 'Poids %', '+/- value €', '+/- value %', 'Jour €', 'Jour %'];
  const rows = lines.map((l) => [
    l.name, l.isin, l.ticker || l.symbol, l.type, l.sectorN, l.countryN, l.region, l.currency, num(l.qty),
    num(l.price), num(l.break_even_price), l.value, l.w * 100, l.pl, l.plPct == null ? null : l.plPct * 100,
    l.day, l.dayPct == null ? null : l.dayPct * 100,
  ].map(cell).join(';'));
  return [head.join(';'), ...rows].join('\r\n');
}
