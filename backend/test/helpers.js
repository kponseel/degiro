import { getPool } from '../src/db/pool.js';

export const TEST_TOKEN = 'test_token_0123456789';
export const AUTH = { Authorization: `Bearer ${TEST_TOKEN}` };

const TABLES = ['positions', 'snapshots', 'transactions', 'isin_ref', 'etf_holdings', 'market_prices', 'sessions', 'magic_links', 'extension_tokens', 'ai_insights', 'ai_prompts', 'users'];

/** Vide toutes les tables métier (à appeler en beforeEach des tests DB). */
export async function resetDb() {
  const pool = getPool();
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of TABLES) {
    await pool.query(`TRUNCATE TABLE ${table}`);
  }
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
}

/** Construit un payload d'ingestion valide, surchargeable. */
export function snapshotPayload(overrides = {}) {
  return {
    source: 'extension',
    capture_id: 'cap-0001',
    captured_at: '2026-07-20T10:00:00Z',
    total_value_eur: 12000,
    cash_eur: 500,
    positions: [
      {
        isin: 'US67066G1040',
        symbol: 'NVDA',
        name: 'NVIDIA Corp',
        product_type: 'STOCK',
        qty: 10,
        price: 120.5,
        currency: 'USD',
        value_eur: 1050,
        pl_eur: 200,
      },
      {
        isin: 'IE00B4L5Y983',
        symbol: 'IWDA',
        name: 'iShares Core MSCI World',
        product_type: 'ETF',
        qty: 100,
        price: 95,
        currency: 'EUR',
        value_eur: 9500,
        pl_eur: 800,
      },
    ],
    ...overrides,
  };
}
