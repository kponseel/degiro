import { parse } from 'csv-parse/sync';
import { getPool } from '../db/pool.js';
import { sniffDelimiter, parseNumberEu, decodeCsv } from './csvParser.js';

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;
const norm = (h) => String(h).toLowerCase().trim();

function pick(row, regex) {
  for (const [k, v] of Object.entries(row)) if (regex.test(norm(k))) return v;
  return undefined;
}
function findIsin(row) {
  for (const v of Object.values(row)) {
    const s = String(v).trim().toUpperCase();
    if (ISIN_RE.test(s)) return s;
  }
  return null;
}

const RE_NAME = /name|nom|holding|security|libell|issuer|bezeichnung|instrument/;
const RE_WEIGHT = /weight|poids|pond|gewicht|%/;
const RE_SECTOR = /sector|secteur|branche|industry/;
const RE_COUNTRY = /country|pays|location|land|domicile/;

/**
 * Parse un CSV de composition d'ETF (formats émetteurs hétérogènes). Détecte la
 * ligne d'en-tête même après un préambule (cas iShares), puis mappe nom / ISIN /
 * poids / secteur / pays de façon tolérante.
 */
export function parseHoldingsCsv(buffer) {
  const text = Buffer.isBuffer(buffer) ? decodeCsv(buffer) : String(buffer);
  const delimiter = sniffDelimiter(text);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');

  // Localise l'en-tête réel (nom + poids présents).
  let headerIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 30); i += 1) {
    const cells = lines[i].split(delimiter).map(norm);
    if (cells.some((c) => RE_WEIGHT.test(c)) && cells.some((c) => RE_NAME.test(c))) {
      headerIdx = i;
      break;
    }
  }

  let rows;
  try {
    rows = parse(lines.slice(headerIdx).join('\n'), {
      columns: true, delimiter, skip_empty_lines: true, relax_column_count: true, trim: true, bom: true, relax_quotes: true,
    });
  } catch {
    return { delimiter, holdings: [] };
  }

  const holdings = rows
    .map((r) => {
      const isinRaw = String(pick(r, /^isin$|isin/) || '').trim().toUpperCase();
      return {
        name: String(pick(r, RE_NAME) || '').trim(),
        isin: ISIN_RE.test(isinRaw) ? isinRaw : findIsin(r),
        weight: parseNumberEu(pick(r, RE_WEIGHT)),
        sector: String(pick(r, RE_SECTOR) || '').trim() || null,
        country: String(pick(r, RE_COUNTRY) || '').trim() || null,
      };
    })
    .filter((h) => h.name && h.weight != null && h.weight > 0);

  return { delimiter, holdings };
}

/** Remplace la composition stockée d'un ETF. */
export async function saveHoldings(etfIsin, holdings) {
  if (!holdings.length) return { saved: 0 };
  const pool = getPool();
  const asOf = new Date().toISOString().slice(0, 10);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM etf_holdings WHERE etf_isin = ?', [etfIsin]);
    const rows = holdings.map((h) => [
      etfIsin, h.name.slice(0, 255), h.isin || null, h.weight, h.sector, h.country, asOf,
    ]);
    await conn.query(
      `INSERT IGNORE INTO etf_holdings
        (etf_isin, constituent_name, constituent_isin, weight_pct, sector, country, as_of)
       VALUES ?`,
      [rows],
    );
    await conn.commit();
    return { saved: rows.length, as_of: asOf };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/** ETF détenus (dernier snapshot) avec leur couverture (composition importée ou non). */
export async function heldEtfsWithCoverage(accountId = 1) {
  const pool = getPool();
  const [held] = await pool.query(
    `SELECT p.isin, MAX(p.name) AS name
     FROM positions p LEFT JOIN isin_ref r ON r.isin = p.isin
     WHERE p.snapshot_id = (SELECT id FROM snapshots WHERE account_id = ? ORDER BY captured_at DESC LIMIT 1)
       AND (r.asset_class = 'ETF' OR p.product_type = 'ETF'
            OR p.name LIKE '%ETF%' OR p.name LIKE '%UCITS%' OR p.name LIKE '%ETC%')
     GROUP BY p.isin
     ORDER BY name`,
    [accountId],
  );
  const [cov] = await pool.query(
    'SELECT etf_isin, COUNT(*) AS n, MAX(as_of) AS as_of FROM etf_holdings GROUP BY etf_isin',
  );
  const covMap = new Map(cov.map((c) => [c.etf_isin, c]));
  return held.map((h) => ({
    isin: h.isin,
    name: h.name,
    covered: covMap.has(h.isin),
    count: covMap.get(h.isin)?.n || 0,
    as_of: covMap.get(h.isin)?.as_of ? String(covMap.get(h.isin).as_of).slice(0, 10) : null,
  }));
}
