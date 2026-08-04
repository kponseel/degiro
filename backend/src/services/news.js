import { getPool } from '../db/pool.js';

/**
 * Titres détenus, pour la page « Actus & raccourcis ».
 *
 * Ce service allait chercher lui-même les articles sur Google News. C'est fini,
 * et ce n'est pas un renoncement : sur un hébergement mutualisé, les appels
 * sortants sont filtrés ou limités en débit, et la source refusait les nôtres.
 * L'écran restait figé sur un cache périmé — le code repoussait même l'échéance
 * à chaque échec, si bien que le bouton « Actualiser » n'avait plus d'effet
 * visible, et que rien ne distinguait « aucune actualité pour tes titres » de
 * « la source ne nous répond plus ».
 *
 * Le navigateur de l'utilisateur, lui, n'est bloqué par personne. L'interface
 * construit donc des liens vers les sources, et n'a plus besoin d'ici que la
 * liste des lignes détenues. Plus de cache à invalider, plus de source à
 * surveiller, plus de clé d'API à prévoir — et l'accès à la source complète
 * plutôt qu'aux quelques titres qu'un flux RSS voulait bien céder.
 */
async function heldStocks(accountId) {
  const [rows] = await getPool().query(
    `SELECT p.isin, MAX(p.name) AS name, MAX(p.value_eur) AS value_eur,
            r.ticker, r.asset_class, r.sector
     FROM positions p LEFT JOIN isin_ref r ON r.isin = p.isin
     WHERE p.snapshot_id = (SELECT id FROM snapshots WHERE account_id = ? ORDER BY captured_at DESC LIMIT 1)
       AND (p.qty IS NULL OR p.qty <> 0)
     GROUP BY p.isin, r.ticker, r.asset_class, r.sector
     ORDER BY value_eur DESC`,
    [accountId],
  );
  return rows;
}

/**
 * Titres à afficher sur la page Actus.
 *
 * `items` et `available` subsistent — vide et `true` — parce que d'autres écrans
 * les lisent encore : les retirer d'un coup casserait leur affichage sans rien
 * apporter. Ils disparaîtront quand ces écrans auront basculé sur les liens.
 *
 * @returns {Promise<{ available: boolean, stocks: Array, items: Array }>}
 */
export async function computeNews(accountId) {
  const rows = await heldStocks(accountId);
  return {
    available: true,
    items: [],
    stocks: rows.map((s) => ({
      isin: s.isin,
      name: s.name,
      ticker: s.ticker || null,
      sector: s.sector || null,
    })),
  };
}
