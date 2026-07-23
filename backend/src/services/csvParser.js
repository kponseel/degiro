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
  name: ['produit', 'product', 'naam'],
  isin: ['isin', 'symbole/isin', 'symbol/isin'],
  qty: ['quantité', 'quantity', 'aantal', 'nombre'],
  closing: ['clôture', 'closing', 'slotkoers', 'cours de clôture'],
  price: ['cours', 'price', 'koers'],
  currency: ['devise', 'currency', 'valuta'],
  valueEur: ['valeur en eur', 'value in eur', 'waarde in eur', 'montant en eur'],
  date: ['date'],
  time: ['heure', 'time', 'tijd'],
  description: ['description', 'omschrijving'],
  change: ['variation', 'mouvements', 'mutatie', 'montant'],
  fees: ['frais de transaction', 'frais', 'transaction costs', 'kosten', 'transactiekosten'],
  orderId: ["id de l'ordre", 'id ordre', 'order id', 'order-id', 'orderid'],
};

/** Détecte le type de CSV DEGIRO d'après les en-têtes présents. */
export function detectKind(rows) {
  if (!rows.length) return null;
  const keys = Object.keys(rows[0]).map(norm);
  const has = (aliases) => aliases.some((a) => keys.includes(norm(a)));
  if (has(FIELDS.description) && has(FIELDS.change)) return 'account';
  if (has(FIELDS.orderId) || (has(FIELDS.qty) && has(FIELDS.price))) return 'transactions';
  if (has(FIELDS.isin) && has(FIELDS.qty) && (has(FIELDS.closing) || has(FIELDS.valueEur))) return 'portfolio';
  return null;
}

// ─── Mappers par type ────────────────────────────────────────────────────────

/** Portfolio.csv → positions normalisées (source = csv). */
export function mapPortfolio(rows) {
  return rows
    .map((r) => ({
      isin: (pick(r, FIELDS.isin) || '').trim(),
      name: pick(r, FIELDS.name) || null,
      qty: parseNumberEu(pick(r, FIELDS.qty)),
      price: parseNumberEu(pick(r, FIELDS.closing)),
      currency: (pick(r, FIELDS.currency) || '').trim().slice(0, 3) || null,
      value_eur: parseNumberEu(pick(r, FIELDS.valueEur)),
    }))
    .filter((p) => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(p.isin));
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
      const currency = (pick(r, FIELDS.currency) || '').trim().slice(0, 3) || null;
      const isinRaw = (pick(r, FIELDS.isin) || '').trim();
      const isin = /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isinRaw) ? isinRaw : null;
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
      const isinRaw = (pick(r, FIELDS.isin) || '').trim();
      const isin = /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isinRaw) ? isinRaw : null;
      const orderId = (pick(r, FIELDS.orderId) || '').trim() || null;
      const currency = (pick(r, FIELDS.currency) || '').trim().slice(0, 3) || null;
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
