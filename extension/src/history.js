/**
 * Historique des ordres : quelle plage demander à DEGIRO, et comment réagir
 * aux refus.
 *
 * Pourquoi ce module : demander vingt-six ans d'un coup se faisait refuser, et
 * interroger chaque année depuis 2003 arrosait DEGIRO de requêtes pour des
 * années où le compte ne pouvait pas exister. Seul l'utilisateur connaît sa
 * première année — mais la lui demander, c'est un champ de plus à remplir, et à
 * se tromper. On la découvre donc tout seul, une fois, puis on s'en souvient :
 * l'historique passé est immuable, les captures suivantes ne relisent que la
 * période récente. Une requête au lieu de vingt-quatre.
 *
 * Module PUR : `fetchRange` est injecté, ce qui rend toute la stratégie
 * testable hors navigateur (backend/test/extensionHistory.test.js).
 */

// DEGIRO n'a pas de clients particuliers avant 2013 (lancement du courtage
// grand public) : interroger plus tôt ne peut rien rapporter.
export const HISTORY_FLOOR = 2013;

// Trois années consécutives sans le moindre ordre : on est très probablement
// remonté avant l'ouverture du compte, on arrête la remontée année par année…
export const EMPTY_STOP = 3;

// …mais une pause de trois ans au MILIEU d'un historique existe aussi : le
// reliquat est donc vérifié en une unique requête de balayage avant de
// déclarer l'historique complet.

// Recouvrement relu à chaque capture : les corrections tardives d'ordres sont
// rarissimes au-delà de quelques jours, un mois est très confortable.
export const OVERLAP_DAYS = 31;

const pad2 = (n) => String(n).padStart(2, '0');
/** Date au format JJ/MM/AAAA attendu par l'endpoint transactions de DEGIRO. */
export const ddmmyyyy = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
const isoDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Un chemin « mort » : le service derrière a disparu, pas la session. */
const CHEMIN_MORT = (status) => status === 404 || status === 410
  || (typeof status === 'number' && status >= 500);

/**
 * Fabrique le `fetchRange` de `captureHistory` avec bascule d'endpoint.
 *
 * Le 29/07/2026, l'endpoint `reporting/secure/v4/transactions` s'est mis à
 * répondre 502 en continu, même sur une année vide : DEGIRO l'avait déplacé.
 * Ici, quand le chemin courant répond « mort » (5xx, 404, 410), les candidats
 * suivants sont essayés UNE seule fois sur la même plage — le premier qui
 * répond devient le chemin courant (et `onSwitch` permet de le mémoriser).
 * Un seul balayage par capture : sans ça, un compte à vingt années d'historique
 * multiplierait chaque refus par le nombre de candidats.
 *
 * Une erreur de session (401) ou de réseau (status 0) ne déclenche PAS de
 * bascule : changer de chemin n'y changerait rien.
 *
 * @param candidates  Chemins à essayer, dans l'ordre de confiance.
 * @param doFetch     async (path, du, au, grouper) => { ok, rows? } | { ok:false, status?, reason? }
 * @param onSwitch    Appelé avec le nouveau chemin quand une bascule réussit.
 */
export function makeRangeFetcher({ candidates, doFetch, onSwitch = () => {} }) {
  let courant = 0;
  let balaye = false;
  return async (du, au, grouper = true) => {
    const res = await doFetch(candidates[courant], du, au, grouper);
    if (res.ok || balaye || candidates.length < 2 || !CHEMIN_MORT(res.status)) return res;
    balaye = true;
    for (let i = 0; i < candidates.length; i += 1) {
      if (i === courant) continue;
      const alt = await doFetch(candidates[i], du, au, grouper);
      if (alt.ok) {
        courant = i;
        onSwitch(candidates[i]);
        return alt;
      }
    }
    return res;
  };
}

/**
 * Clé de dédoublonnage d'une ligne d'ordre : les plages interrogées peuvent se
 * recouvrir. L'`id` de la transaction passe en premier — deux exécutions
 * partielles d'un même ordre partagent le même `orderId`, et les confondre ici
 * ferait disparaître des quantités.
 */
const rowKey = (row) =>
  `${row?.id ?? ''}|${row?.orderId ?? ''}|${row?.date ?? ''}|${row?.productId ?? ''}|${row?.quantity ?? ''}`;

/**
 * Récupère l'historique des ordres avec le moins de requêtes possible.
 *
 * @param today       Date du jour (injectée : testabilité).
 * @param state       Mémoire de la dernière capture complète, ou null :
 *                    { completeSince: 'YYYY-MM-DD', capturedThrough: 'YYYY-MM-DD' }.
 * @param fetchRange  async (du, au, grouper) => { ok, rows?, reason? }
 * @returns {Promise<{ rows: Array, failed: number, detail: string, nextState: object|null }>}
 *          `nextState` n'est renvoyé que si la couverture est complète — c'est
 *          lui qu'il faut mémoriser pour la prochaine capture.
 */
export async function captureHistory({ today, state, fetchRange }) {
  const finale = today.getFullYear();
  const fin = ddmmyyyy(today);
  let refus = null;

  const call = async (du, au, grouper = true) => {
    const res = await fetchRange(du, au, grouper);
    if (res?.ok) return res.rows || [];
    refus = res?.reason || 'raison inconnue';
    return null;
  };

  // ── Captures suivantes : seule la période récente est relue ──────────────
  if (state?.completeSince && state?.capturedThrough) {
    const depuis = new Date(Date.parse(state.capturedThrough) - OVERLAP_DAYS * 864e5);
    let lot = await call(ddmmyyyy(depuis), fin);
    if (lot === null) lot = await call(ddmmyyyy(depuis), fin, false);
    if (lot === null) {
      // La mémoire est conservée : l'historique déjà en base n'a pas bougé.
      return {
        rows: [],
        failed: 1,
        nextState: state,
        detail: `relecture du récent (depuis ${ddmmyyyy(depuis)}) refusée — ${refus}. L'historique déjà enregistré (depuis ${state.completeSince}) est conservé.`,
      };
    }
    return {
      rows: lot,
      failed: 0,
      nextState: { ...state, capturedThrough: isoDay(today) },
      detail: `${lot.length} ordre(s) depuis ${ddmmyyyy(depuis)} — l'historique antérieur (depuis ${state.completeSince}) est déjà enregistré`,
    };
  }

  // ── Première capture : découverte ─────────────────────────────────────────
  const plancher = `01/01/${HISTORY_FLOOR}`;
  const complet = { completeSince: `${HISTORY_FLOOR}-01-01`, capturedThrough: isoDay(today) };

  // 1. La plage entière — une seule requête quand DEGIRO l'accepte.
  let entier = await call(plancher, fin);
  let note = '';
  if (entier === null) {
    // 2. Même plage sans l'agrégation par ordre : paramètre facultatif, premier
    //    suspect quand l'endpoint répond en erreur.
    entier = await call(plancher, fin, false);
    if (entier) note = ' (sans agrégation par ordre)';
  }
  if (entier) {
    return { rows: entier, failed: 0, nextState: complet, detail: `${entier.length} ordre(s)${note}` };
  }

  // 3. Sonde : une seule année — avec puis sans agrégation, comme la plage
  //    entière. Si même elle est refusée, c'est l'endpoint qui refuse — pas la
  //    largeur de la plage. Inutile d'enchaîner des requêtes vouées à l'échec.
  let grouper = true;
  let sonde = await call(`01/01/${finale}`, fin);
  if (sonde === null) {
    sonde = await call(`01/01/${finale}`, fin, false);
    if (sonde !== null) grouper = false;
  }
  if (sonde === null) {
    return { rows: [], failed: 1, nextState: null, detail: `refusé par DEGIRO même sur une seule année — ${refus}` };
  }

  // 4. La largeur était bien en cause : remontée année par année, arrêt après
  //    EMPTY_STOP années vides consécutives.
  const rows = [];
  const vus = new Set();
  const garder = (lot) => {
    for (const r of lot) {
      const k = rowKey(r);
      if (!vus.has(k)) { vus.add(k); rows.push(r); }
    }
  };
  garder(sonde);

  const anneeSeule = async (an) => call(`01/01/${an}`, `31/12/${an}`, grouper);

  const echecs = [];
  let videsDeSuite = sonde.length === 0 ? 1 : 0;
  let dernierVerifie = finale;
  for (let an = finale - 1; an >= HISTORY_FLOOR; an -= 1) {
    const lot = await anneeSeule(an);
    dernierVerifie = an;
    if (lot === null) { echecs.push(an); continue; } // refusée ≠ vide : la série de vides n'avance pas
    garder(lot);
    if (lot.length === 0) {
      videsDeSuite += 1;
      if (videsDeSuite >= EMPTY_STOP) break;
    } else {
      videsDeSuite = 0;
    }
  }

  // 5. Balayage du reliquat en UNE requête — le garde-fou qui rend l'arrêt
  //    anticipé sans risque pour la complétude. S'il est refusé (plage encore
  //    trop large ?), repli année par année : un compte longtemps dormant ne
  //    doit pas perdre ses premières années faute de ce second essai.
  let balayage = true;
  if (dernierVerifie > HISTORY_FLOOR) {
    const lot = await call(plancher, `31/12/${dernierVerifie - 1}`, grouper);
    if (lot !== null) garder(lot);
    else {
      balayage = false;
      for (let an = dernierVerifie - 1; an >= HISTORY_FLOOR; an -= 1) {
        const seul = await anneeSeule(an);
        if (seul === null) echecs.push(an);
        else garder(seul);
      }
    }
  }

  const ok = echecs.length === 0;
  const morceaux = [`${rows.length} ordre(s), découpé par année`];
  if (!grouper) morceaux.push('sans agrégation par ordre');
  if (dernierVerifie > HISTORY_FLOOR && balayage) {
    morceaux.push(`années ${HISTORY_FLOOR}–${dernierVerifie - 1} vérifiées en une requête`);
  }
  if (echecs.length) {
    morceaux.push(`${echecs.length} année(s) refusée(s) (${[...echecs].sort().join(', ')}) — ${refus}`);
  }

  return {
    rows,
    failed: echecs.length,
    nextState: ok ? complet : null,
    detail: morceaux.join(' — '),
  };
}
