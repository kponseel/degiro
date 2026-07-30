/**
 * Script injecté dans le contexte de la page DEGIRO (monde MAIN).
 *
 * Son unique rôle : observer les appels réseau que l'application DEGIRO fait
 * d'elle-même, et en extraire `sessionId` / `intAccount`. Rien n'est modifié,
 * rien n'est bloqué — on se contente de lire l'URL avant de laisser passer.
 *
 * Pourquoi ici et pas dans le script de contenu : les mondes JavaScript sont
 * cloisonnés, et c'est la page qui possède le `fetch` que DEGIRO utilise.
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
    // Chemin de l'historique des ordres appelé par l'application DEGIRO — relevé
    // ici pour suivre l'endpoint quand DEGIRO le déplace (502 continus sinon).
    ['txPath', /(\/[a-z][a-z-]*\/secure\/v\d+\/transactions)(?=[?/]|$)/],
    // Idem pour le relevé de compte (dividendes, dépôts, frais).
    ['cashPath', /(\/[a-z][a-z-]*\/secure\/v\d+\/accountoverview)(?=[?/]|$)/i],
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
    if (changed) window.postMessage({ type: TAG, creds: { ...found } }, window.location.origin);
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function patchedFetch(...args) {
      const [input] = args;
      try { look(typeof input === 'string' ? input : input?.url); } catch { /* jamais bloquer la page */ }
      return originalFetch.apply(this, args);
    };
  }

  const originalOpen = window.XMLHttpRequest?.prototype?.open;
  if (typeof originalOpen === 'function') {
    window.XMLHttpRequest.prototype.open = function patchedOpen(...args) {
      try { look(args[1]); } catch { /* idem */ }
      return originalOpen.apply(this, args);
    };
  }

  // Le script de contenu peut réclamer l'état courant (ex. popup rouvert).
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.type !== `${TAG}_ASK`) return;
    window.postMessage({ type: TAG, creds: { ...found } }, window.location.origin);
  });
})();
