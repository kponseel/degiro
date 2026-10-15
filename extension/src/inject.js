/**
 * Script injecté dans le contexte de la page DEGIRO (monde MAIN).
 *
 * Son unique rôle : repérer, dans les adresses des appels réseau que
 * l'application DEGIRO fait d'elle-même, le `sessionId` et l'`intAccount`.
 * Rien n'est modifié, rien n'est bloqué, rien n'est intercepté.
 *
 * Les adresses sont lues dans la liste des requêtes que le navigateur tient
 * pour chaque page (Resource Timing), et non plus en s'interposant devant
 * `window.fetch` / `XMLHttpRequest`. S'interposer plaçait ce script dans la
 * pile d'appel de TOUTES les requêtes de la page : quand DEGIRO voyait ses
 * propres traceurs publicitaires bloqués par sa politique de sécurité (CSP),
 * Chrome attribuait ces erreurs à l'extension, et la page « Erreurs » de
 * chrome://extensions s'en remplissait à chaque visite.
 *
 * Si cette lecture ne donne rien, la capture se débrouille sans : le service
 * worker obtient un `sessionId` par /login/secure/config et l'`intAccount` par
 * /pa/secure/client, à la seule force du cookie de session.
 *
 * La communication remonte par `postMessage`, jamais dans l'autre sens : la
 * page ne peut donc rien demander à l'extension, et le jeton d'API ne
 * s'approche jamais du contexte de la page.
 */
(() => {
  const TAG = 'DGX_CREDS';
  const found = {};

  const PATTERNS = [
    ['sessionId', /[?&]sessionId=([A-Za-z0-9._-]{8,})/],
    ['sessionId', /;jsessionid=([A-Za-z0-9._-]{8,})/i],
    ['intAccount', /\/v5\/update\/(\d{3,})/],
    ['intAccount', /[?&]intAccount=(\d{3,})/],
  ];

  /**
   * La dernière valeur vue gagne : si l'utilisateur se reconnecte dans le même
   * onglet, DEGIRO émet un nouveau `sessionId` et garder l'ancien condamnerait
   * toutes les captures suivantes à un 401.
   */
  function look(url) {
    let changed = false;
    const text = String(url || '');
    for (const [key, re] of PATTERNS) {
      const m = text.match(re);
      if (m && found[key] !== m[1]) { found[key] = m[1]; changed = true; }
    }
    return changed;
  }

  const publish = () => window.postMessage({ type: TAG, creds: { ...found } }, window.location.origin);

  /** Seules les requêtes vers DEGIRO nous intéressent : les autres ne sont même pas lues. */
  const isDegiro = (name) => String(name || '').startsWith('https://trader.degiro.nl/');

  function scan(entries) {
    let changed = false;
    for (const e of entries) {
      if (isDegiro(e.name) && look(e.name)) changed = true;
    }
    if (changed) publish();
  }

  try {
    // `buffered` : rattrape aussi les requêtes faites avant que ce script ne
    // tourne. Un observateur reçoit chaque nouvelle requête même quand le
    // tampon de la page est plein — DEGIRO en fait des centaines par heure.
    new PerformanceObserver((list) => scan(list.getEntries()))
      .observe({ type: 'resource', buffered: true });
  } catch {
    // Navigateur sans PerformanceObserver : lecture ponctuelle du tampon, à la
    // demande (voir ci-dessous). Les secours du service worker font le reste.
  }

  // Le script de contenu peut réclamer l'état courant (ex. popup rouvert). On
  // relit au passage le tampon, au cas où l'observateur aurait manqué quelque chose.
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.type !== `${TAG}_ASK`) return;
    try { scan(performance.getEntriesByType('resource')); } catch { /* sans effet */ }
    publish();
  });
})();
