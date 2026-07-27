import { getPool } from '../db/pool.js';

/**
 * Enregistre des mouvements (relevé de compte ou ordres) pour un utilisateur.
 *
 * Idempotent via `external_id`, mais **complétant** : un mouvement déjà connu
 * voit ses champs vides comblés par la nouvelle version, sans qu'une valeur
 * déjà renseignée soit jamais écrasée.
 *
 * C'était un `INSERT IGNORE`, et cela rendait toute réparation impossible. Les
 * ordres importés avant que le parseur ne sache lire les montants en euros ont
 * `amount_eur = NULL` ; comme leur `external_id` (l'identifiant d'ordre DEGIRO)
 * ne change pas, réimporter le même Transactions.csv — ou recapturer par
 * l'extension, qui réutilise volontairement ce même identifiant — était
 * silencieusement ignoré. L'historique restait donc définitivement incalculable,
 * et aucune migration SQL ne pouvait le reconstruire : le montant en euros n'est
 * pas déductible des colonnes conservées.
 *
 * @returns {Promise<{ received: number, inserted: number, completed: number }>}
 */
export async function saveTransactions(txs, accountId = 1) {
  if (!txs.length) return { received: 0, inserted: 0, completed: 0 };
  const pool = getPool();

  // On relève l'état AVANT d'écrire. `affectedRows` ne permet pas de distinguer
  // les trois cas qui nous intéressent — inséré, complété, déjà à jour : avec
  // ON DUPLICATE KEY UPDATE, une ligne inchangée n'y compte pas du tout. Un
  // comptage explicite est exact quel que soit le pilote, et c'est un chiffre
  // montré à l'utilisateur.
  const ids = txs.map((t) => t.external_id);
  const [avant] = await pool.query(
    `SELECT external_id, (amount_eur IS NULL) AS trou
       FROM transactions WHERE account_id = ? AND external_id IN (?)`,
    [accountId, ids],
  );
  const connus = new Map(avant.map((r) => [r.external_id, Boolean(Number(r.trou))]));

  const rows = txs.map((t) => [
    accountId,
    t.tx_date,
    t.type,
    t.isin ?? null,
    t.description ?? null,
    t.qty ?? null,
    t.amount ?? null,
    t.currency ?? null,
    t.amount_eur ?? null,
    t.external_id,
  ]);
  await pool.query(
    `INSERT INTO transactions
       (account_id, tx_date, type, isin, description, qty, amount, currency, amount_eur, external_id)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       amount_eur  = COALESCE(transactions.amount_eur, VALUES(amount_eur)),
       amount      = COALESCE(transactions.amount,     VALUES(amount)),
       currency    = COALESCE(transactions.currency,   VALUES(currency)),
       qty         = COALESCE(transactions.qty,        VALUES(qty)),
       isin        = COALESCE(transactions.isin,       VALUES(isin)),
       description = COALESCE(transactions.description, VALUES(description))`,
    [rows],
  );
  const inserted = txs.filter((t) => !connus.has(t.external_id)).length;
  // « Complété » : le mouvement existait déjà sans montant en euros, et cet
  // import en apporte un. C'est la réparation d'un historique importé avant que
  // le parseur ne sache lire ces montants.
  const completed = txs.filter((t) => connus.get(t.external_id) === true && t.amount_eur != null).length;
  return { received: txs.length, inserted, completed };
}
