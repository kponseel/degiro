/**
 * Script de contenu (monde ISOLATED) sur trader.degiro.nl.
 *
 * Volontairement minuscule et sans dépendance : les scripts de contenu ne
 * supportent pas les modules ES, donc toute la logique vit dans le service
 * worker. Ici on ne fait que trois choses :
 *
 *  1. mémoriser les identifiants repérés par `inject.js` ;
 *  2. prévenir le service worker quand la session est prête (capture auto) ;
 *  3. exécuter des requêtes vers DEGIRO **depuis la page elle-même**, ce qui
 *     leur donne les cookies de la session déjà ouverte. C'est tout l'intérêt :
 *     l'extension ne connaît ni ne stocke le moindre identifiant DEGIRO.
 *
 * Le jeton de l'API Analyzer ne transite jamais par ici.
 */
(() => {
  const TAG = 'DGX_CREDS';
  const ORIGIN = 'https://trader.degiro.nl';
  // Le service de graphiques de DEGIRO (historique des cours) : appelé d'ici
  // seulement en secours, si le service worker n'a pas pu le joindre lui-même.
  const CHART_ORIGIN = 'https://charting.vwdservices.com/';
  let creds = {};

  // Signal « DEGIRO prêt » pour la capture automatique : une fois par page, dès
  // que les deux identifiants sont connus, avec un délai pour laisser DEGIRO
  // finir son propre chargement. Le service worker décide seul s'il capture.
  let ready = false;
  const READY_DELAY_MS = 8000;

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.type !== TAG) return;
    creds = { ...creds, ...(event.data.creds || {}) };
    if (!ready && creds.sessionId && creds.intAccount) {
      ready = true;
      setTimeout(() => {
        // Extension rechargée depuis l'ouverture de l'onglet : le contexte est
        // orphelin et l'envoi lève une erreur — rien à faire, rien à signaler.
        try { chrome.runtime.sendMessage({ type: 'DEGIRO_READY' }).catch(() => {}); } catch { /* orphelin */ }
      }, READY_DELAY_MS);
    }
  });

  // Demande l'état courant au cas où l'injection a eu lieu avant l'écoute.
  window.postMessage({ type: `${TAG}_ASK` }, window.location.origin);

  async function fetchDegiro({ url, method = 'GET', body }) {
    const degiro = String(url).startsWith(`${ORIGIN}/`);
    if (!degiro && !String(url).startsWith(CHART_ORIGIN)) throw new Error('URL hors DEGIRO refusée');
    const res = await fetch(url, {
      method,
      // Les cookies de session DEGIRO ne partent que vers DEGIRO.
      credentials: degiro ? 'include' : 'omit',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* réponse non-JSON : on remonte le brut */ }
    return { ok: res.ok, status: res.status, json, text: json ? undefined : text.slice(0, 300) };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg?.type === 'GET_CREDS') {
      window.postMessage({ type: `${TAG}_ASK` }, window.location.origin);
      // Laisse le temps à la réponse de `inject.js` de revenir.
      setTimeout(() => respond({ creds }), 60);
      return true;
    }
    if (msg?.type === 'FETCH') {
      fetchDegiro(msg)
        .then(respond)
        .catch((e) => respond({ ok: false, status: 0, error: String(e.message || e) }));
      return true;
    }
    return false;
  });
})();
