import { getPool } from '../db/pool.js';

/**
 * Garde-fou des écritures sur les tables de RÉFÉRENCE partagées.
 *
 * `isin_ref` (secteur, pays, classe d'actifs) et `etf_holdings` (compositions)
 * sont volontairement communes à tous les comptes : ces données ne disent rien
 * de personne, et les mutualiser évite que chacun réenrichisse les mêmes titres.
 *
 * Le revers, c'est que toute écriture y est visible par tout le monde. Sans
 * contrôle, n'importe quel inscrit pouvait réécrire le secteur ou la composition
 * de n'importe quel ISIN — y compris ceux qu'il ne détient pas — et fausser les
 * pages Exposition et Transparence de tous les autres comptes.
 *
 * D'où cette règle : on ne corrige que la référence d'un titre que l'on détient
 * réellement. Cela couvre l'usage légitime (corriger les lignes de SON
 * portefeuille) et retire la capacité de nuire à des titres qui ne nous
 * concernent pas.
 */

/**
 * L'utilisateur détient-il ce titre dans son dernier instantané ?
 * Les lignes soldées (quantité nulle) comptent : corriger le secteur d'une
 * position revendue reste légitime, elle figure encore dans l'historique.
 *
 * @param {number} accountId
 * @param {string} isin
 * @returns {Promise<boolean>}
 */
export async function userHoldsIsin(accountId, isin) {
  const [rows] = await getPool().query(
    `SELECT 1
       FROM positions p
       JOIN snapshots s ON s.id = p.snapshot_id
      WHERE s.account_id = ? AND p.isin = ?
      LIMIT 1`,
    [accountId, isin],
  );
  return rows.length > 0;
}
