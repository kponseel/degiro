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
  // Les colonnes suivantes ne servent qu'à RECONNAÎTRE un relevé de compte ou un
  // historique d'ordres, pour expliquer leur refus (seul Portfolio.csv est importé).
  description: ['description', 'omschrijving', 'beschreibung'],
  change: ['mutation', 'variation', 'mouvements', 'mutatie', 'montant', 'change', 'betrag'],
  balance: ['solde', 'balance', 'saldo', 'kontostand'],
  orderId: ["id de l'ordre", 'id ordre', 'order id', 'order-id', 'orderid', 'auftrags-id'],
};

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

/**
 * Liquidités → montant EUR total, sinon null.
 *
 * DEGIRO écrit une ligne par devise (« CASH & CASH FUND & FTX CASH (EUR) »,
 * « … (USD) »), chacune avec sa « Valeur en EUR ». On les additionne : s'arrêter
 * à la première perdait les soldes en devises (dividendes américains, typiquement).
 */
export function extractCashEur(rows) {
  let total = null;
  for (const r of rows) {
    if (findIsin(r)) continue; // vraie position
    const name = String(pick(r, FIELDS.name) || Object.values(r)[0] || '');
    if (/cash|liquidit|fund|geld/i.test(name)) {
      const val = findValueEur(r);
      if (val !== null) total = Math.round(((total ?? 0) + val) * 100) / 100;
    }
  }
  return total;
}

/** Identifiant de capture déterministe pour un contenu CSV (idempotence d'import). */
export function csvCaptureId(text) {
  return `csv-${createHash('sha256').update(text).digest('hex').slice(0, 28)}`;
}
