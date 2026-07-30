import { getPool } from '../db/pool.js';

// ── Jumeaux du relevé de compte ──────────────────────────────────────

/**
 * Le même mouvement de trésorerie peut arriver par DEUX voies : l'import
 * `Account.csv`, qui n'a aucun identifiant et retombe sur un `acc-<empreinte>`
 * reconstruit, et la capture du relevé par l'extension, qui porte l'identifiant
 * DEGIRO du mouvement (`dgx-cash-<id>`). Les deux se dédoublonnent chacun avec
 * eux-mêmes, mais pas entre eux : sans arbitrage, un compte qui a importé son
 * relevé PUIS capturé (ou l'inverse) compterait ses versements deux fois — et la
 * performance réelle (TWR), qui se calcule sur ces versements, serait fausse,
 * les dividendes doublés.
 *
 * Arbitrage : l'identifiant DEGIRO fait foi. Il est stable, opaque aux
 * reformulations de libellé, et ne dépend pas d'une empreinte calculée.
 */
const CASH_AUTORITAIRE = /^dgx-cash-/;
const CASH_RECONSTRUIT = /^acc-/;

/** Un mouvement de trésorerie : sans quantité, avec un montant. */
const estMouvement = (t) => t.qty == null && t.amount != null && Boolean(t.tx_date);

/**
 * Signature d'un mouvement, hors identifiant : ce qui le rend reconnaissable
 * d'une source à l'autre. L'ISIN en est EXCLU volontairement — l'extension ne
 * peut le renseigner que si la résolution des produits a abouti, et une panne
 * passagère de `products/info` ne doit pas faire échouer la reconnaissance. Il
 * est comparé à part, en tolérant qu'un côté l'ignore.
 */
const signature = (type, txDate, amount, currency) =>
  `${type}|${String(txDate).slice(0, 10)}|${Number(amount).toFixed(2)}|${currency ?? ''}`;

/** Deux ISIN se correspondent s'ils sont égaux, ou si l'un des deux est inconnu. */
const isinCompatible = (a, b) => a == null || b == null || a === b;

/**
 * Arbitre entre mouvements entrants et mouvements déjà stockés.
 *
 * @returns {Promise<{ rows: Array, cleaned: number }>} `rows` = ce qu'il reste à
 *          écrire (les doublons reconstruits entrants sont retirés), `cleaned` =
 *          nombre de jumeaux reconstruits supprimés en base.
 */
async function resoudreJumeauxCash(pool, accountId, txs) {
  const mouvements = txs.filter(estMouvement);
  if (!mouvements.length) return { rows: txs, cleaned: 0 };

  const dates = mouvements.map((t) => String(t.tx_date).slice(0, 10)).sort();
  // Une seule lecture, bornée à la période couverte : comparer en mémoire évite
  // les pièges des tuples SQL avec des colonnes nullables (devise, ISIN).
  const [stockes] = await pool.query(
    `SELECT external_id, type, DATE(tx_date) AS jour, amount, currency, isin
       FROM transactions
      WHERE account_id = ? AND qty IS NULL AND amount IS NOT NULL
        AND tx_date >= ? AND tx_date < DATE_ADD(?, INTERVAL 1 DAY)
        AND (external_id LIKE 'acc-%' OR external_id LIKE 'dgx-cash-%')`,
    [accountId, `${dates[0]} 00:00:00`, dates[dates.length - 1]],
  );

  const parSignature = new Map();
  for (const r of stockes) {
    const cle = signature(r.type, r.jour, r.amount, r.currency);
    if (!parSignature.has(cle)) parSignature.set(cle, []);
    parSignature.get(cle).push(r);
  }

  const aSupprimer = new Set();
  const aIgnorer = new Set();
  // Appariement UN POUR UN : un mouvement entrant ne neutralise qu'un seul
  // jumeau. Sans ce compteur, deux frais identiques le même jour côté import
  // (que `disambiguateIds` a bien conservés tous les deux) disparaissaient tous
  // les deux dès qu'UN seul équivalent arrivait — une perte silencieuse.
  const consommes = new Set();
  for (const t of mouvements) {
    const voisins = parSignature.get(signature(t.type, t.tx_date, t.amount, t.currency)) || [];
    const entrantAutoritaire = CASH_AUTORITAIRE.test(t.external_id);
    const jumeau = voisins.find((r) => r.external_id !== t.external_id // le même, pas un jumeau
      && !consommes.has(r.external_id)
      && isinCompatible(t.isin ?? null, r.isin ?? null)
      // L'entrant porte l'identifiant DEGIRO → son jumeau est un reconstruit.
      // L'entrant est reconstruit → son jumeau est un identifiant DEGIRO.
      && (entrantAutoritaire ? CASH_RECONSTRUIT : CASH_AUTORITAIRE).test(r.external_id));
    if (!jumeau) continue;
    consommes.add(jumeau.external_id);
    // L'identifiant DEGIRO fait foi : soit le reconstruit stocké disparaît, soit
    // le reconstruit entrant n'est pas écrit (réimport après une capture).
    if (entrantAutoritaire) aSupprimer.add(jumeau.external_id);
    else aIgnorer.add(t.external_id);
  }

  let cleaned = 0;
  const ids = [...aSupprimer];
  for (let i = 0; i < ids.length; i += 500) {
    const [res] = await pool.query(
      'DELETE FROM transactions WHERE account_id = ? AND external_id IN (?)',
      [accountId, ids.slice(i, i + 500)],
    );
    cleaned += res.affectedRows;
  }

  return { rows: aIgnorer.size ? txs.filter((t) => !aIgnorer.has(t.external_id)) : txs, cleaned };
}

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
 * @returns {Promise<{ received: number, inserted: number, completed: number, cleaned: number }>}
 */
export async function saveTransactions(recues, accountId = 1) {
  if (!recues.length) return { received: 0, inserted: 0, completed: 0, cleaned: 0 };
  const pool = getPool();
  const received = recues.length;

  // Arbitrage des jumeaux du relevé de compte AVANT toute écriture : un
  // mouvement déjà connu sous son identifiant DEGIRO ne doit pas être ré-inséré
  // sous une empreinte reconstruite, et réciproquement.
  const { rows: txs, cleaned: nettoyesCash } = await resoudreJumeauxCash(pool, accountId, recues);
  if (!txs.length) return { received, inserted: 0, completed: 0, cleaned: nettoyesCash };

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
  // Relève des jumeaux « reconstruits » : les vieux imports lisaient la colonne
  // Order ID vide (l'export réel la décale d'un cran) et retombaient sur un
  // identifiant reconstruit (`tx-…`). Le même ordre réimporté avec son vrai
  // UUID créerait un DOUBLON — quantités comptées deux fois, prix moyen faux.
  // Quand un ordre arrive avec un identifiant DEGIRO, son éventuel jumeau
  // reconstruit (même type, même titre, même jour, même quantité) est retiré.
  const avecUuid = txs.filter(
    (t) => !/^(tx|acc|dgx)-/.test(t.external_id) && t.isin && t.qty != null && t.tx_date,
  );
  let cleaned = nettoyesCash;
  for (let i = 0; i < avecUuid.length; i += 500) {
    const lot = avecUuid.slice(i, i + 500);
    const tuples = lot.map((t) => [t.type, t.isin, String(t.tx_date).slice(0, 10), t.qty]);
    const [res] = await pool.query(
      `DELETE FROM transactions
        WHERE account_id = ? AND external_id LIKE 'tx-%'
          AND (type, isin, DATE(tx_date), qty) IN (?)`,
      [accountId, tuples],
    );
    cleaned += res.affectedRows;
  }

  // Comptage sur les identifiants UNIQUES : un même external_id apparu deux
  // fois dans le lot ne représente qu'un seul mouvement.
  const inserted = new Set(txs.filter((t) => !connus.has(t.external_id)).map((t) => t.external_id)).size;
  // « Complété » : le mouvement existait déjà sans montant en euros, et cet
  // import en apporte un. C'est la réparation d'un historique importé avant que
  // le parseur ne sache lire ces montants.
  const completed = new Set(
    txs.filter((t) => connus.get(t.external_id) === true && t.amount_eur != null).map((t) => t.external_id),
  ).size;
  return { received, inserted, completed, cleaned };
}
