/**
 * Capture automatique à l'ouverture de DEGIRO — la règle de décision.
 *
 * Module PUR (testé depuis le backend) : le service worker lui passe l'état et
 * l'heure, il répond s'il faut capturer. Toute la prudence est ici :
 *  - jamais sans l'accord explicite de l'utilisateur (case à cocher) ;
 *  - jamais sans réglages complets (adresse + jeton) : silence, pas d'erreur ;
 *  - au plus une capture réussie par jour civil à Paris (la base n'en garde
 *    qu'une par jour et par source : en refaire ne servirait à rien) ;
 *  - après un échec, une pause avant de réessayer, pour ne pas solliciter DEGIRO
 *    à chaque rechargement d'une page dont la session a expiré.
 */

/** Jour civil à Paris, « AAAA-MM-JJ ». */
export function parisDay(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Pause minimale entre deux tentatives automatiques après un échec. */
export const RETRY_AFTER_MS = 30 * 60 * 1000;

/**
 * @param enabled      case « capturer automatiquement » cochée
 * @param configured   adresse de l'API et jeton enregistrés
 * @param lastCapture  dernière capture RÉUSSIE ({ at: ISO }) — manuelle ou auto
 * @param lastAuto     dernière tentative automatique ({ at: ISO, ok })
 * @param now          Date courante
 * @returns {{ go: boolean, reason: string }}
 */
export function shouldAutoCapture({ enabled, configured, lastCapture, lastAuto, now }) {
  if (!enabled) return { go: false, reason: 'désactivée' };
  if (!configured) return { go: false, reason: 'réglages incomplets' };
  const today = parisDay(now);
  const last = lastCapture?.at ? new Date(lastCapture.at) : null;
  if (last && !Number.isNaN(last.getTime()) && parisDay(last) === today) {
    return { go: false, reason: 'déjà capturé aujourd’hui' };
  }
  const tried = lastAuto?.at ? new Date(lastAuto.at) : null;
  if (tried && lastAuto.ok === false && now - tried < RETRY_AFTER_MS) {
    return { go: false, reason: 'échec récent, nouvel essai plus tard' };
  }
  return { go: true, reason: 'première capture du jour' };
}
