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

/** Parse un texte CSV en tableau d'objets (clés = en-têtes). Sniffe le délimiteur. */
export function parseCsv(text) {
  const delimiter = sniffDelimiter(text);
  const rows = parse(text, {
    columns: true,
    delimiter,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    bom: true,
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
  isin: ['isin', 'symbole/isin', 'symbol/isin', 'ticker/isin'],
  qty: ['quantité', 'quantity', 'amount', 'aantal', 'nombre', 'anzahl', 'menge', 'stuks'],
  closing: ['clôture', 'closing', 'slotkoers', 'cours de clôture', 'schlusskurs'],
  price: ['cours', 'price', 'koers', 'kurs'],
  currency: ['devise', 'currency', 'valuta', 'währung', 'local value', 'valeur locale', 'lokale waarde'],
  valueEur: ['valeur en eur', 'value in eur', 'waarde in eur', 'montant en eur', 'wert in eur'],
  date: ['date', 'datum'],
  time: ['heure', 'time', 'tijd', 'uhrzeit'],
  description: ['description', 'omschrijving', 'beschreibung'],
  change: ['variation', 'mouvements', 'mutatie', 'montant', 'change', 'betrag'],
  fees: ['frais de transaction', 'frais', 'transaction costs', 'kosten', 'transactiekosten', 'gebühren'],
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

/** Devise : code ISO à 3 lettres, détecté sur les valeurs (l'en-tête varie selon la langue). */
function detectCurrency(row) {
  const byHeader = String(pick(row, FIELDS.currency) || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(byHeader)) return byHeader;
  for (const v of Object.values(row)) {
    const s = String(v).trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(s)) return s;
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

/** Détecte le type de CSV DEGIRO (en-têtes + valeurs, tolérant à la langue). */
export function detectKind(rows) {
  if (!rows.length) return null;
  const keys = Object.keys(rows[0]).map(norm);
  const has = (aliases) => aliases.some((a) => keys.includes(norm(a)));
  const hasEurHeader = keys.some((k) => /eur/i.test(k));
  const anyIsin = rows.some((r) => findIsin(r) !== null);

  if (has(FIELDS.description) && has(FIELDS.change)) return 'account';
  // Portefeuille : cours de clôture (ou colonne EUR) + des ISIN, sans ID d'ordre.
  if (anyIsin && (has(FIELDS.closing) || hasEurHeader) && !has(FIELDS.orderId)) return 'portfolio';
  if (has(FIELDS.orderId) || (has(FIELDS.qty) && has(FIELDS.price))) return 'transactions';
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

const DESC_RULES = [
  [/dépôt|storting|deposit/i, 'deposit'],
  [/retrait|withdrawal|terugstorting/i, 'withdrawal'],
  // Impôt/retenue AVANT dividende : « Impôt sur dividende » contient « dividende ».
  [/impôt|impot|belasting|withholding|précompte|precompte|tax/i, 'tax'],
  [/dividende|dividend/i, 'dividend'],
  [/frais|courtage|commission|kosten|fee/i, 'fee'],
  [/change|fx|conversion/i, 'fx'],
];

function classifyDescription(desc) {
  const d = String(desc || '');
  for (const [re, type] of DESC_RULES) if (re.test(d)) return type;
  return 'other';
}

/** Account.csv (relevé de compte) → mouvements normalisés (table transactions). */
export function mapAccount(rows) {
  return rows
    .map((r) => {
      const txDate = parseDateEu(pick(r, FIELDS.date), pick(r, FIELDS.time));
      const description = pick(r, FIELDS.description) || '';
      const amount = parseNumberEu(pick(r, FIELDS.change));
      const currency = detectCurrency(r);
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
    .filter((t) => t.tx_date && t.amount !== null);
}

/** Transactions.csv → ordres normalisés (buy/sell). */
export function mapTransactions(rows) {
  return rows
    .map((r) => {
      const txDate = parseDateEu(pick(r, FIELDS.date), pick(r, FIELDS.time));
      const qty = parseNumberEu(pick(r, FIELDS.qty));
      const isin = findIsin(r);
      const orderId = (pick(r, FIELDS.orderId) || '').trim() || null;
      const currency = detectCurrency(r);
      return {
        tx_date: txDate,
        type: qty !== null && qty < 0 ? 'sell' : 'buy',
        isin,
        description: pick(r, FIELDS.name) || null,
        qty,
        amount: parseNumberEu(pick(r, FIELDS.fees)),
        currency,
        amount_eur: null,
        external_id: orderId || syntheticId('tx', txDate, isin, qty),
      };
    })
    .filter((t) => t.tx_date && t.isin && t.qty !== null);
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
