import { getPool } from '../db/pool.js';

/**
 * Enregistre des mouvements (relevé de compte ou ordres) pour un utilisateur.
 *
 * Idempotent via `external_id`, mais **réparateur** : un mouvement déjà connu
 * est mis à jour par la nouvelle version quand elle apporte une valeur, et une
 * valeur entrante absente (null) n'efface jamais une valeur stockée.
 *
 * Pourquoi la version entrante peut avoir priorité : l'`external_id` d'un
 * ordre est son identifiant DEGIRO, et les deux sources (Transactions.csv,
 * extension) FUSIONNENT désormais les exécutions partielles avant l'envoi. Une
 * ligne stockée peut donc être un fragment hérité — la première exécution
 * seule, importée avant cette fusion — que seule une réécriture peut réparer.
 * L'ancienne règle « jamais écraser une valeur connue » figeait précisément ces
 * fragments faux.
 *
 * Mais la version entrante peut AUSSI être le fragment : un vieux CSV exporté
 * pendant que l'ordre s'exécutait encore, ou la fenêtre de relecture de
 * l'extension qui n'attrape que les dernières exécutions d'un ordre à cheval
 * sur sa borne. Le départage tient en une règle : les exécutions d'un ordre ne
 * font que S'ACCUMULER, donc la version à la plus grande quantité (en valeur
 * absolue) est la plus complète — l'entrante ne gagne que si sa quantité est au
 * moins égale à la quantité stockée. Les colonnes d'un même ordre voyagent
 * ensemble : on prend tout d'une version, jamais un panachage.
 *
 * Historique : c'était un `INSERT IGNORE`, qui rendait toute réparation
 * impossible — notamment celle des `amount_eur = NULL` importés avant que le
 * parseur ne sache lire les montants en euros, valeur que rien d'autre ne peut
 * reconstruire.
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
       amount      = IF(transactions.qty IS NULL OR VALUES(qty) IS NULL OR ABS(VALUES(qty)) >= ABS(transactions.qty),
                        COALESCE(VALUES(amount), transactions.amount), transactions.amount),
       amount_eur  = IF(transactions.qty IS NULL OR VALUES(qty) IS NULL OR ABS(VALUES(qty)) >= ABS(transactions.qty),
                        COALESCE(VALUES(amount_eur), transactions.amount_eur), transactions.amount_eur),
       currency    = IF(transactions.qty IS NULL OR VALUES(qty) IS NULL OR ABS(VALUES(qty)) >= ABS(transactions.qty),
                        COALESCE(VALUES(currency), transactions.currency), transactions.currency),
       isin        = COALESCE(transactions.isin,       VALUES(isin)),
       description = COALESCE(transactions.description, VALUES(description)),
       -- qty en DERNIER : les affectations d'un ON DUPLICATE se font de gauche à
       -- droite et voient les valeurs déjà mises à jour — la comparaison des
       -- quantités doit porter sur la quantité STOCKÉE, pas sur la nouvelle.
       qty         = IF(transactions.qty IS NULL OR VALUES(qty) IS NULL OR ABS(VALUES(qty)) >= ABS(transactions.qty),
                        COALESCE(VALUES(qty), transactions.qty), transactions.qty)`,
    [rows],
  );
  // Comptage sur les identifiants UNIQUES : un même external_id apparu deux
  // fois dans le lot ne représente qu'un seul mouvement.
  const inserted = new Set(txs.filter((t) => !connus.has(t.external_id)).map((t) => t.external_id)).size;
  // « Complété » : le mouvement existait déjà sans montant en euros, et cet
  // import en apporte un. C'est la réparation d'un historique importé avant que
  // le parseur ne sache lire ces montants.
  const completed = new Set(
    txs.filter((t) => connus.get(t.external_id) === true && t.amount_eur != null).map((t) => t.external_id),
  ).size;
  return { received: txs.length, inserted, completed };
}
