import { parse } from 'csv-parse/sync';
import { createHash } from 'node:crypto';

// ─── Décodage & parsing générique ────────────────────────────────────────────

/** Décode un buffer CSV en texte, avec repli latin1 si l'UTF-8 produit des caractères de remplacement. */
export function decodeCsv(buffer) {
  const utf8 = buffer.toString('utf8');
  return utf8.includes('�') ? buffer.toString('latin1') : utf8;
}

/** Devine le délimiteur (`,` `;` ou tab) d'après la première ligne. */
export function sniffDelimiter(text) {
  const firstLine = (text.split(/\r?\n/).find((l) => l.trim() !== '') || '').replace(/"[^"]*"/g, '');
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  for (const c of candidates) {
    const count = firstLine.split(c).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

/**
 * Rend chaque en-tête unique et non vide.
 *
 * Les exports DEGIRO réels contiennent des colonnes **sans titre** : un montant
 * et sa devise occupent deux colonnes voisines, dont une seule est nommée.
 * Laissées telles quelles, ces colonnes homonymes s'écrasent entre elles et
 * tout ce qui suit se décale d'un cran — silencieusement.
 */
export function uniqueHeaders(header) {
  const seen = new Map();
  return header.map((h, i) => {
    const base = String(h ?? '').trim();
    if (base === '') return `__c${i}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}__${n}`;
  });
}

/**
 * Parse un texte CSV en tableau d'objets. Sniffe le délimiteur.
 *
 * On lit en tableaux plutôt qu'en objets pour maîtriser nous-mêmes le nommage
 * des colonnes : c'est la seule façon de ne perdre aucune valeur quand les
 * en-têtes se répètent ou manquent. L'ordre d'insertion des clés reflète
 * l'ordre des colonnes, ce dont dépend la lecture des paires montant/devise.
 */
export function parseCsv(text) {
  const delimiter = sniffDelimiter(text);
  const records = parse(text, {
    delimiter,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
  });
  if (!records.length) return { delimiter, rows: [] };

  const keys = uniqueHeaders(records[0]);
  const rows = records.slice(1).map((rec) => {
    const row = {};
    keys.forEach((k, i) => { row[k] = rec[i] ?? ''; });
    // Colonnes surnuméraires (relax_column_count) : conservées, jamais perdues.
    for (let i = keys.length; i < rec.length; i += 1) row[`__c${i}`] = rec[i];
    return row;
  });
  return { delimiter, rows };
}

// ─── Conversions format européen ─────────────────────────────────────────────

/** Parse un nombre au format européen ("1.234,56", "12,50", "-2,00") → Number|null. */
export function parseNumberEu(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim().replace(/\s/g, '').replace(/"/g, '');
  s = s.replace(/[^0-9.,-]/g, '');
  if (s === '' || s === '-') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    s = s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

/** Parse une date JJ-MM-AAAA (+ heure HH:MM optionnelle) → 'YYYY-MM-DD HH:MM:SS' | null. */
export function parseDateEu(raw, time) {
  if (!raw) return null;
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(String(raw).trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const t = time && /^\d{1,2}:\d{2}/.test(String(time).trim()) ? String(time).trim() : '00:00';
  const [hh = '00', mm = '00'] = t.split(':');
  return `${y}-${mo}-${d} ${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:00`;
}

// ─── Mapping d'en-têtes (FR / EN / NL) ───────────────────────────────────────

const norm = (h) => String(h).toLowerCase().trim().replace(/\s+/g, ' ');

/** Renvoie la valeur de la première colonne dont l'en-tête correspond à un alias. */
function pick(row, aliases) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const a = norm(alias);
    const key = keys.find((k) => norm(k) === a);
    if (key !== undefined) return row[key];
  }
  return undefined;
}

const FIELDS = {
  name: ['produit', 'product', 'produkt', 'naam'],
  isin: ['isin', 'code isin', 'symbole/isin', 'symbol/isin', 'ticker/isin'],
  qty: ['quantité', 'quantity', 'amount', 'aantal', 'nombre', 'anzahl', 'menge', 'stuks'],
  closing: ['clôture', 'closing', 'slotkoers', 'cours de clôture', 'schlusskurs'],
  price: ['cours', 'price', 'koers', 'kurs'],
  currency: ['devise', 'currency', 'valuta', 'währung', 'local value', 'valeur locale', 'lokale waarde'],
  valueEur: ['valeur en eur', 'value in eur', 'waarde in eur', 'montant en eur', 'wert in eur'],
  // Valeur EUR d'un ordre dans Transactions.csv : colonne « Valeur » / « Value »
  // (à ne pas confondre avec « Valeur locale » / « Local value », en devise du titre).
  tradeValue: ['valeur', 'value', 'waarde', 'wert'],
  total: ['total', 'totaal', 'gesamt'],
  date: ['date', 'datum'],
  time: ['heure', 'time', 'tijd', 'uhrzeit'],
  description: ['description', 'omschrijving', 'beschreibung'],
  // « Mutation » (FR) et « Change » (EN) portent la devise dans les exports
  // réels ; le montant est dans la colonne voisine — d'où `pickAmount`.
  change: ['mutation', 'variation', 'mouvements', 'mutatie', 'montant', 'change', 'betrag'],
  balance: ['solde', 'balance', 'saldo', 'kontostand'],
  fees: [
    'frais de transaction', 'frais de transaction et/ou de tiers', 'frais',
    'transaction costs', 'transaction and/or third party costs',
    'transaction and/or third party fees',
    'kosten', 'transactiekosten', 'gebühren',
  ],
  // Frais de conversion de devise, facturés en plus des frais de transaction.
  autofx: ['autofx fee', 'frais autofx', 'autofx'],
  orderId: ["id de l'ordre", 'id ordre', 'order id', 'order-id', 'orderid', 'auftrags-id'],
};

const CURRENCY_RE = /^[A-Z]{3}$/;

/** Indice (position) de la première colonne dont l'en-tête correspond à un alias. */
function indexOf(row, aliases) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const a = norm(alias);
    const i = keys.findIndex((k) => norm(k) === a);
    if (i !== -1) return i;
  }
  return -1;
}

/**
 * Lit le montant d'une colonne DEGIRO.
 *
 * Montant et devise vont par paires de colonnes voisines, et l'ordre des deux
 * **change d'un fichier à l'autre** : dans le relevé de compte, « Mutation »
 * porte la devise et le montant suit ; dans les transactions, « Cours » porte
 * le montant et la devise suit. On lit donc la cellule visée, et sa voisine si
 * elle ne contient pas de nombre.
 */
export function pickAmount(row, aliases) {
  const keys = Object.keys(row);
  const i = indexOf(row, aliases);
  if (i === -1) return null;
  const here = parseNumberEu(row[keys[i]]);
  if (here !== null) return here;
  return i + 1 < keys.length ? parseNumberEu(row[keys[i + 1]]) : null;
}

/**
 * Montant en euros d'une colonne : soit la devise est dans une colonne voisine
 * (« Valeur », « », « EUR »), soit l'en-tête la porte lui-même (« Value EUR »,
 * « Total EUR » — la forme des exports anglais récents). Rater la seconde forme
 * laissait TOUS les montants à nul, et donc toutes les plus-values à « — ».
 */
export function pickEurAmount(row, aliases) {
  if (pickAmountCurrency(row, aliases) === 'EUR') return pickAmount(row, aliases);
  const suffixes = aliases.flatMap((a) => [`${a} eur`, `${a} en eur`, `${a} in eur`]);
  const direct = pick(row, suffixes);
  if (direct !== undefined && direct !== '') return parseNumberEu(direct);
  return null;
}

/** Devise attachée à une colonne montant : la cellule elle-même ou sa voisine. */
export function pickAmountCurrency(row, aliases) {
  const keys = Object.keys(row);
  const i = indexOf(row, aliases);
  if (i === -1) return null;
  for (const j of [i, i + 1, i - 1]) {
    if (j < 0 || j >= keys.length) continue;
    const s = String(row[keys[j]] ?? '').trim().toUpperCase();
    if (CURRENCY_RE.test(s)) return s;
  }
  return null;
}

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** Cherche dans une ligne la valeur qui ressemble à un ISIN (robuste à l'en-tête). */
function findIsin(row) {
  const byHeader = String(pick(row, FIELDS.isin) || '').trim().toUpperCase();
  if (ISIN_RE.test(byHeader)) return byHeader;
  for (const v of Object.values(row)) {
    const s = String(v).trim().toUpperCase();
    if (ISIN_RE.test(s)) return s;
  }
  return null;
}

/**
 * Devises négociables chez DEGIRO. Sert uniquement au balayage en dernier
 * recours : sans cette liste, un code de place de marché (« NDQ », « NYS »,
 * « EAM ») a la même forme qu'une devise et se fait passer pour telle.
 */
const KNOWN_CURRENCIES = new Set([
  'EUR', 'USD', 'GBP', 'GBX', 'CHF', 'CAD', 'AUD', 'JPY', 'HKD', 'SGD',
  'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'TRY', 'ZAR', 'NZD', 'MXN', 'ILS',
]);

/** Devise : code ISO à 3 lettres, détecté sur les valeurs (l'en-tête varie selon la langue). */
function detectCurrency(row) {
  const byHeader = String(pick(row, FIELDS.currency) || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(byHeader)) return byHeader;
  // Une colonne « Devise » explicite fait foi ; un balayage à l'aveugle, non.
  for (const v of Object.values(row)) {
    const s = String(v).trim().toUpperCase();
    if (KNOWN_CURRENCIES.has(s)) return s;
  }
  return null;
}

/** Valeur en EUR : colonne dont l'en-tête contient « eur », sinon alias explicite. */
function findValueEur(row) {
  const byAlias = pick(row, FIELDS.valueEur);
  if (byAlias !== undefined && byAlias !== '') return parseNumberEu(byAlias);
  for (const [k, v] of Object.entries(row)) {
    if (/eur/i.test(k)) {
      const n = parseNumberEu(v);
      if (n !== null) return n;
    }
  }
  return null;
}

/**
 * Détecte le type de CSV DEGIRO (en-têtes + valeurs, tolérant à la langue).
 *
 * La colonne « Description » est le signal décisif : seul le relevé de compte
 * en possède une. Elle est testée en premier, car le relevé porte aussi un
 * « ID de l'ordre » et se faisait sinon passer pour un fichier de transactions.
 */
export function detectKind(rows) {
  if (!rows.length) return null;
  const keys = Object.keys(rows[0]).map(norm);
  const has = (aliases) => aliases.some((a) => keys.includes(norm(a)));
  const hasEurHeader = keys.some((k) => /eur/i.test(k));
  const anyIsin = rows.some((r) => findIsin(r) !== null);

  if (has(FIELDS.description) && (has(FIELDS.change) || has(FIELDS.balance))) return 'account';
  if (has(FIELDS.orderId) || (has(FIELDS.qty) && has(FIELDS.price))) return 'transactions';
  // Portefeuille : cours de clôture (ou colonne EUR) + des ISIN.
  if (anyIsin && (has(FIELDS.closing) || hasEurHeader)) return 'portfolio';
  if (anyIsin) return 'portfolio';
  return null;
}

// ─── Mappers par type ────────────────────────────────────────────────────────

/** Portfolio.csv → positions normalisées (source = csv). Multilingue. */
export function mapPortfolio(rows) {
  return rows
    .map((r) => ({
      isin: findIsin(r),
      name: pick(r, FIELDS.name) || null,
      qty: parseNumberEu(pick(r, FIELDS.qty)),
      price: parseNumberEu(pick(r, FIELDS.closing)),
      currency: detectCurrency(r),
      value_eur: findValueEur(r),
    }))
    .filter((p) => ISIN_RE.test(p.isin || ''));
}

/** Extrait la ligne de liquidités (CASH & CASH FUND…) → montant EUR, sinon null. */
export function extractCashEur(rows) {
  for (const r of rows) {
    if (findIsin(r)) continue; // vraie position
    const name = String(pick(r, FIELDS.name) || Object.values(r)[0] || '');
    if (/cash|liquidit|fund|geld/i.test(name)) {
      const val = findValueEur(r);
      if (val !== null) return val;
    }
  }
  return null;
}

/**
 * Classement des mouvements du relevé, d'après leur libellé.
 *
 * L'ordre compte : du plus spécifique au plus générique. « Impôt sur dividende »
 * contient « dividende », et le mot « versement » (générique) ne doit pas
 * s'emparer d'un libellé de dividende — d'où impôt, puis dividende, puis les
 * flux de trésorerie.
 *
 * Les libellés sont ceux que DEGIRO émet réellement : un dépôt s'appelle
 * « Versement de fonds » en français, pas « Dépôt ». Mal classé, il devient
 * invisible pour le TWR, qui existe précisément pour neutraliser les versements.
 */
const DESC_RULES = [
  // Taxes de transaction (TTF française, stamp duty britannique) : ce sont des
  // coûts d'ordre, pas des retenues sur dividende. Testées en premier, sinon
  // « Taxe sur les Transactions Financières » tomberait dans le seau `tax` et
  // serait retranchée des dividendes.
  [/taxe sur les transactions|financial transaction tax|\bttf\b|stamp duty|droit de timbre/i, 'transaction_tax'],
  [/impôt|impot|belasting|withholding|précompte|precompte|retenue|\btax\b|taxe/i, 'tax'],
  [/dividende|dividend/i, 'dividend'],
  [/versement de fonds|dépôt|depot\b|storting|deposit|ideal|sofort/i, 'deposit'],
  [/retrait|withdrawal|terugstorting|payout/i, 'withdrawal'],
  // Avant `fx` : « Changement ISIN » contient « change » et se faisait passer
  // pour une opération de change.
  [/changement isin|isin change|isin-wijziging/i, 'isin_change'],
  [/fractionnement|regroupement|\bsplit\b/i, 'split'],
  // Seul l'intérêt *dû* est un frais : « Flatex Interest Income » est un revenu
  // et reste en « autre », faute d'un type qui lui corresponde.
  [/frais|courtage|commission|kosten|\bfee\b|costs|intérêts? débiteur|debit interest/i, 'fee'],
  [/change|fx|conversion|valuta/i, 'fx'],
];

/**
 * Type d'un mouvement d'après son libellé. Exporté : c'est la SEULE table de
 * classification du dépôt, et elle sert aux deux sources — l'import Account.csv
 * et la capture du relevé par l'extension. L'extension n'embarque donc aucune
 * copie de ces expressions (elle envoie un type provisoire que le serveur
 * recalcule ici), ce qui rend toute divergence impossible.
 */
export function classifyDescription(desc) {
  const d = String(desc || '');
  for (const [re, type] of DESC_RULES) if (re.test(d)) return type;
  return 'other';
}

/**
 * Départage les identifiants reconstruits identiques.
 *
 * Deux mouvements peuvent être légitimement identiques à la même minute — deux
 * frais, les deux jambes d'une opération de change — et recevaient le même
 * identifiant : le second était silencieusement perdu (143 mouvements sur un
 * relevé réel de 6 794). Le premier garde l'identifiant historique, pour que
 * les réimports continuent de dédoublonner avec l'existant ; les suivants sont
 * suffixés — l'ordre du fichier est stable d'un export à l'autre, et des
 * mouvements au contenu identique sont de toute façon interchangeables.
 */
function disambiguateIds(txs) {
  const vus = new Map();
  for (const t of txs) {
    const n = (vus.get(t.external_id) || 0) + 1;
    vus.set(t.external_id, n);
    if (n > 1) t.external_id = `${t.external_id}#${n}`.slice(0, 64);
  }
  return txs;
}

/** Account.csv (relevé de compte) → mouvements normalisés (table transactions). */
export function mapAccount(rows) {
  return disambiguateIds(rows
    .map((r) => {
      const txDate = parseDateEu(pick(r, FIELDS.date), pick(r, FIELDS.time));
      const description = pick(r, FIELDS.description) || '';
      const amount = pickAmount(r, FIELDS.change);
      // La devise du mouvement, pas celle du solde : on la prend collée au montant.
      const currency = pickAmountCurrency(r, FIELDS.change) || detectCurrency(r);
      const isin = findIsin(r);
      const type = classifyDescription(description);
      return {
        tx_date: txDate,
        type,
        isin,
        description,
        amount,
        currency,
        amount_eur: currency === 'EUR' ? amount : null,
        external_id: syntheticId('acc', txDate, description, amount),
      };
    })
    .filter((t) => t.tx_date && t.amount !== null));
}

/**
 * Fusionne les exécutions partielles d'un même ordre.
 *
 * Le Transactions.csv de DEGIRO contient UNE LIGNE PAR EXÉCUTION : un ordre
 * servi en trois fois y occupe trois lignes qui partagent le même « ID de
 * l'ordre ». Or cet identifiant sert de clé de dédoublonnage en base
 * (`external_id`) : importées telles quelles, seules les quantités de la
 * première exécution étaient conservées — les deux autres disparaissaient en
 * silence, et le prix moyen pondéré était faux d'autant.
 *
 * Limite connue : un ordre dont les exécutions chevauchent la borne de DEUX
 * exports (un fichier par année, ordre à cheval sur le 31 décembre) ne peut pas
 * être resommé côté serveur — chaque fichier n'en voit qu'une part, et la plus
 * grosse gagne. Le cas est rarissime, et une capture d'extension sur la plage
 * entière le répare : DEGIRO y agrège l'ordre complet.
 */
function aggregateOrders(txs) {
  const round = (n, d) => { const f = 10 ** d; return Math.round(n * f) / f; };
  const parOrdre = new Map();
  const out = [];
  for (const t of txs) {
    const prev = parOrdre.get(t.external_id);
    if (!prev) { parOrdre.set(t.external_id, t); out.push(t); continue; }
    prev.qty = round(prev.qty + t.qty, 6);
    // Frais : somme de ce qui est connu (un frais absent vaut zéro).
    if (t.amount != null) prev.amount = round((prev.amount ?? 0) + t.amount, 2);
    // Montant EUR : une exécution sans montant rend le total inconnaissable —
    // null plutôt qu'une somme partielle présentée comme complète.
    prev.amount_eur = prev.amount_eur == null || t.amount_eur == null
      ? null
      : round(prev.amount_eur + t.amount_eur, 2);
    if (t.tx_date < prev.tx_date) prev.tx_date = t.tx_date;
  }
  return out;
}

/**
 * Identifiant d'ordre : la cellule nommée, ou sa voisine. L'export réel a une
 * colonne « Order ID » VIDE suivie d'une colonne sans titre qui porte l'UUID —
 * le rater faisait retomber chaque ligne sur un identifiant reconstruit, qui ne
 * se dédoublonne pas avec les captures de l'extension.
 */
function findOrderId(row) {
  const keys = Object.keys(row);
  const i = indexOf(row, FIELDS.orderId);
  if (i === -1) return null;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const j of [i, i + 1, i - 1]) {
    if (j < 0 || j >= keys.length) continue;
    const v = String(row[keys[j]] ?? '').trim();
    if (UUID_RE.test(v)) return v;
  }
  return String(row[keys[i]] ?? '').trim() || null;
}

/** Somme de frais dont chacun peut manquer ; null si aucun n'est connu. */
function sumFees(fees, autofx) {
  if (fees == null && autofx == null) return null;
  return Math.round(((fees ?? 0) + (autofx ?? 0)) * 100) / 100;
}

/** Transactions.csv → ordres normalisés (buy/sell), une ligne PAR ORDRE. */
export function mapTransactions(rows) {
  return aggregateOrders(rows
    .map((r) => {
      const txDate = parseDateEu(pick(r, FIELDS.date), pick(r, FIELDS.time));
      const qty = parseNumberEu(pick(r, FIELDS.qty));
      const isin = findIsin(r);
      const orderId = findOrderId(r);
      // Devise du cours : à défaut, un balayage libre ramasserait le code de la
      // place de marché (« NDQ ») et le prendrait pour une devise.
      const currency = pickAmountCurrency(r, FIELDS.price)
        || pickAmountCurrency(r, FIELDS.currency)
        || detectCurrency(r);
      // Valeur EUR brute de l'ordre : indispensable au calcul des plus-values.
      // La colonne « Valeur » n'est retenue que si elle est bien en EUR (sinon
      // c'est la valeur en devise du titre) ; à défaut on prend le « Total » EUR.
      let grossEur = pickEurAmount(r, FIELDS.tradeValue);
      if (grossEur == null) {
        const total = pickEurAmount(r, FIELDS.total);
        // « Total » est net de frais : repli seulement, le brut reste préférable.
        grossEur = total == null ? null : Math.abs(total) || null;
      }
      // Signe : achat = sortie de cash (négatif), vente = entrée (positif).
      const amountEur = grossEur == null || qty == null ? null
        : (qty < 0 ? Math.abs(grossEur) : -Math.abs(grossEur));
      return {
        tx_date: txDate,
        type: qty !== null && qty < 0 ? 'sell' : 'buy',
        isin,
        description: pick(r, FIELDS.name) || null,
        qty,
        amount: sumFees(pickEurAmount(r, FIELDS.fees) ?? pickAmount(r, FIELDS.fees), pickAmount(r, FIELDS.autofx)),
        currency,
        amount_eur: amountEur,
        external_id: orderId || syntheticId('tx', txDate, isin, qty),
      };
    })
    .filter((t) => t.tx_date && t.isin && t.qty !== null));
}

// ─── Identifiants ────────────────────────────────────────────────────────────

function syntheticId(prefix, ...parts) {
  const h = createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 24);
  return `${prefix}-${h}`;
}

/** Identifiant de capture déterministe pour un contenu CSV (idempotence d'import). */
export function csvCaptureId(text) {
  return `csv-${createHash('sha256').update(text).digest('hex').slice(0, 28)}`;
}
