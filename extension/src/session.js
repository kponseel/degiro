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

/** URLs de l'API DEGIRO, construites au même endroit pour rester lisibles. */
export const urls = {
  origin: 'https://trader.degiro.nl',
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
  transactions: (intAccount, sessionId, fromDate, toDate) =>
    'https://trader.degiro.nl/reporting/secure/v4/transactions'
    + `?fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}`
    + '&groupTransactionsByOrder=true'
    + `&intAccount=${encodeURIComponent(intAccount)}&sessionId=${encodeURIComponent(sessionId)}`,
};
