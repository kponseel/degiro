/**
 * Repérage des identifiants de session DEGIRO.
 *
 * L'API DEGIRO n'est pas publique et n'a pas de « clé » : chaque appel a besoin
 * du `sessionId` de la session web en cours et de l'`intAccount` du compte. Ces
 * deux valeurs ne sont accessibles nulle part de façon documentée — en
 * revanche, l'application DEGIRO les met **elle-même** dans les URLs qu'elle
 * appelle en boucle. On les y lit au passage plutôt que de les deviner.
 *
 * Module pur : `sniff` ne fait qu'analyser des URLs, ce qui le rend testable.
 */

/**
 * Ces motifs sont volontairement dupliqués dans `inject.js` : un script de
 * contenu ne peut pas importer de module ES. Un test vérifie que les deux
 * copies ne divergent pas (`backend/test/extensionMapping.test.js`).
 */
export const PATTERNS = [
  { key: 'sessionId', re: /[?&]sessionId=([A-Za-z0-9._-]{8,})/ },
  { key: 'sessionId', re: /;jsessionid=([A-Za-z0-9._-]{8,})/i },
  { key: 'intAccount', re: /\/v5\/update\/(\d{3,})/ },
  { key: 'intAccount', re: /[?&]intAccount=(\d{3,})/ },
  // Relevé de compte (dividendes, dépôts, frais) — même raison que txPath :
  // suivre l'adresse que l'application DEGIRO appelle plutôt que la deviner.
  { key: 'cashPath', re: /(\/[a-z][a-z-]*\/secure\/v\d+\/accountoverview)(?=[?/]|$)/i },
  // Chemin de l'historique des ordres tel que l'application DEGIRO l'appelle
  // elle-même. Le 29/07/2026, notre chemin `reporting/secure/v4` s'est mis à
  // répondre 502 en continu : l'endpoint avait bougé. Plutôt que de deviner la
  // nouvelle adresse, on lit celle que DEGIRO utilise — même méthode que pour
  // le sessionId.
  { key: 'txPath', re: /(\/[a-z][a-z-]*\/secure\/v\d+\/transactions)(?=[?/]|$)/ },
];

/**
 * Extrait ce qui est reconnaissable dans une URL. Renvoie un objet éventuellement
 * vide — jamais `null` — pour pouvoir fusionner sans précaution.
 */
export function sniff(url) {
  const found = {};
  const text = String(url || '');
  for (const { key, re } of PATTERNS) {
    if (found[key]) continue;
    const m = text.match(re);
    if (m) found[key] = m[1];
  }
  return found;
}

/** Vrai quand on a de quoi appeler l'API DEGIRO. */
export const isComplete = (creds) => Boolean(creds?.sessionId && creds?.intAccount);

/**
 * Lit `intAccount` dans la réponse de `/pa/secure/client` — voie de secours
 * quand l'application n'a encore rien appelé depuis l'ouverture de l'onglet.
 */
export function intAccountFromClient(client) {
  const data = client?.data ?? client;
  const value = data?.intAccount;
  return Number.isInteger(value) || /^\d{3,}$/.test(String(value ?? '')) ? String(value) : null;
}

/**
 * Lit le `sessionId` de la configuration DEGIRO.
 *
 * Voie de secours quand l'application n'a encore lancé aucun appel : le
 * repérage d'URL n'a alors rien vu, et l'utilisateur se voyait répondre « reste
 * quelques secondes sur l'onglet ». Cet appel-là répond à la seule force du
 * cookie de session. (Constaté dans l'extension Zeus, qui n'utilise QUE cette
 * voie ; on la garde en secours, le repérage donnant en plus `intAccount` et
 * les chemins vivants.)
 */
export function sessionIdFromConfig(config) {
  const data = config?.data ?? config;
  const value = data?.sessionId;
  return typeof value === 'string' && value.length >= 8 ? value : null;
}

/** URLs de l'API DEGIRO, construites au même endroit pour rester lisibles. */
export const urls = {
  origin: 'https://trader.degiro.nl',
  config: () => 'https://trader.degiro.nl/login/secure/config',
  client: (sessionId) => `https://trader.degiro.nl/pa/secure/client?sessionId=${encodeURIComponent(sessionId)}`,
  update: (intAccount, sessionId) =>
    `https://trader.degiro.nl/trading/secure/v5/update/${encodeURIComponent(intAccount)};jsessionid=${encodeURIComponent(sessionId)}`
    + '?portfolio=0&totalPortfolio=0',
  productsInfo: (intAccount, sessionId) =>
    'https://trader.degiro.nl/product_search/secure/v5/products/info'
    + `?intAccount=${encodeURIComponent(intAccount)}&sessionId=${encodeURIComponent(sessionId)}`,
  // Historique des ordres (achats/ventes), agrégé par ordre — la seule source des
  // positions fermées et des plus-values réalisées. `fromDate`/`toDate` au format
  // JJ/MM/AAAA attendu par DEGIRO ; on remonte très loin pour tout capturer.
  // `path` est remplaçable : quand DEGIRO déplace l'endpoint, on suit le chemin
  // relevé dans les appels de l'application elle-même (motif `txPath`).
  transactions: (intAccount, sessionId, fromDate, toDate, groupByOrder = true, path = TX_PATH_DEFAUT) =>
    `https://trader.degiro.nl${path}`
    + `?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`
    // `groupTransactionsByOrder` agrège les exécutions partielles en un ordre.
    // Paramètre facultatif : certaines instances le refusent, d'où le repli.
    + (groupByOrder ? '&groupTransactionsByOrder=true' : '')
    + `&intAccount=${encodeURIComponent(intAccount)}&sessionId=${encodeURIComponent(sessionId)}`,
  // Mouvements de trésorerie sur une plage. DEGIRO plafonne la largeur de plage
  // (~6 mois) : le découpage vit dans `cash.js`.
  accountOverview: (intAccount, sessionId, fromDate, toDate, path = CASH_PATH_DEFAUT) =>
    `https://trader.degiro.nl${path}`
    + `?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`
    + `&intAccount=${encodeURIComponent(intAccount)}&sessionId=${encodeURIComponent(sessionId)}`,
};

/**
 * Chemin par défaut de l'endpoint des transactions.
 *
 * DEGIRO a MIGRÉ sa famille reporting : l'ancien `reporting/secure/v4` répond
 * 502 en continu (constaté les 28-29/07/2026, même sur une année vide), et la
 * bibliothèque communautaire maintenue (degiro-connector 3.0.36) appelle
 * désormais `portfolio-reports/secure/v4/transactions` — mêmes paramètres
 * (fromDate/toDate JJ/MM/AAAA, groupTransactionsByOrder, intAccount,
 * sessionId), même réponse `{ data: [...] }`.
 */
export const TX_PATH_DEFAUT = '/portfolio-reports/secure/v4/transactions';

/** Chemins connus, du plus récent au plus ancien — essayés quand le courant est mort (5xx/404). */
export const TX_PATHS_CONNUS = [
  TX_PATH_DEFAUT,
  // Ancien chemin d'avant la migration : gardé au cas où une entité DEGIRO le
  // servirait encore.
  '/reporting/secure/v4/transactions',
];

/**
 * Relevé de compte : dépôts, retraits, dividendes, taxes et frais — la source
 * de la performance réelle (TWR) et des dividendes, qui exigeaient jusqu'ici
 * l'export manuel d'un Account.csv.
 */
export const CASH_PATH_DEFAUT = '/portfolio-reports/secure/v6/accountoverview';

export const CASH_PATHS_CONNUS = [
  CASH_PATH_DEFAUT,
  '/reporting/secure/v6/accountoverview',
];
