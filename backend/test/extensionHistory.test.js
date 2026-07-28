import { describe, it, expect } from 'vitest';
import { captureHistory, HISTORY_FLOOR, OVERLAP_DAYS } from '../../extension/src/history.js';

/** Ordre factice, identifiable. */
const ordre = (annee, n = 1) => ({
  id: `${annee}-${n}`,
  orderId: `ord-${annee}-${n}`,
  date: `${annee}-06-15T10:00:00+02:00`,
  productId: '331868',
  quantity: 10,
});

const AUJOURDHUI = new Date('2026-07-28T12:00:00Z');

/**
 * Faux DEGIRO : `parAnnee` associe chaque année à ses ordres, `refuse` décide
 * quels appels échouent. Chaque appel est journalisé pour compter les requêtes.
 */
function fauxDegiro({ parAnnee = {}, refuse = () => false }) {
  const appels = [];
  const anneeDe = (s) => Number(String(s).slice(-4));
  const fetchRange = async (du, au, grouper = true) => {
    appels.push({ du, au, grouper });
    if (refuse(du, au, grouper)) return { ok: false, reason: 'HTTP 502 — Bad Gateway' };
    const de = anneeDe(du);
    const a = anneeDe(au);
    const rows = [];
    for (let an = de; an <= a; an += 1) rows.push(...(parAnnee[an] || []));
    return { ok: true, rows };
  };
  return { appels, fetchRange };
}

const largeur = (du, au) => Number(String(au).slice(-4)) - Number(String(du).slice(-4));

describe("découverte de l'historique — première capture", () => {
  it('une seule requête quand DEGIRO accepte la plage entière', async () => {
    const { appels, fetchRange } = fauxDegiro({ parAnnee: { 2018: [ordre(2018)], 2024: [ordre(2024)] } });
    const out = await captureHistory({ today: AUJOURDHUI, state: null, fetchRange });

    expect(appels).toHaveLength(1);
    // La plage part du plancher 2013, pas de 2000 : DEGIRO n'a pas de clients
    // particuliers avant — dix requêtes pour rien dans l'ancienne version.
    expect(appels[0].du).toBe(`01/01/${HISTORY_FLOOR}`);
    expect(out.rows).toHaveLength(2);
    expect(out.failed).toBe(0);
    expect(out.nextState).toEqual({ completeSince: `${HISTORY_FLOOR}-01-01`, capturedThrough: '2026-07-28' });
  });

  it("retente sans l'agrégation par ordre avant de découper", async () => {
    const { appels, fetchRange } = fauxDegiro({
      parAnnee: { 2020: [ordre(2020)] },
      refuse: (du, au, grouper) => grouper && largeur(du, au) > 5,
    });
    const out = await captureHistory({ today: AUJOURDHUI, state: null, fetchRange });

    expect(appels).toHaveLength(2);
    expect(appels[1].grouper).toBe(false);
    expect(out.failed).toBe(0);
    expect(out.detail).toContain('sans agrégation par ordre');
  });

  it("s'arrête après trois requêtes quand DEGIRO refuse tout, en donnant sa réponse", async () => {
    const { appels, fetchRange } = fauxDegiro({ refuse: () => true });
    const out = await captureHistory({ today: AUJOURDHUI, state: null, fetchRange });

    // Plage entière (avec puis sans agrégation), sonde d'une année (avec puis
    // sans agrégation) — et on ne martèle pas : l'ancienne version enchaînait
    // vingt-quatre refus de plus.
    expect(appels).toHaveLength(4);
    expect(out.failed).toBeGreaterThan(0);
    expect(out.detail).toContain('même sur une seule année');
    expect(out.detail).toContain('HTTP 502');
    expect(out.nextState).toBeNull();
  });

  it("découpe par année, s'arrête après trois années vides, et vérifie le reste en une requête", async () => {
    // Utilisateur qui a commencé en 2018 — le cas de la question.
    const parAnnee = {};
    for (let an = 2018; an <= 2026; an += 1) parAnnee[an] = [ordre(an)];
    const { appels, fetchRange } = fauxDegiro({
      parAnnee,
      refuse: (du, au) => largeur(du, au) > 5, // la plage large est refusée…
    });
    const out = await captureHistory({ today: AUJOURDHUI, state: null, fetchRange });

    expect(out.failed).toBe(0);
    expect(out.rows).toHaveLength(9); // 2018..2026
    // 2 plages larges refusées + sonde 2026 + 2025..2015 (arrêt : 2017, 2016,
    // 2015 vides) + balayage 2013-2014 = 15 requêtes. L'ancienne version en
    // faisait 25, et 1 seule d'entre elles au plancher aurait suffi… si DEGIRO
    // l'acceptait.
    expect(appels.length).toBe(15);
    const annees = appels.slice(3).map((a) => Number(String(a.du).slice(-4)));
    expect(Math.min(...annees)).toBe(HISTORY_FLOOR); // le balayage couvre le plancher
    expect(annees).not.toContain(2014); // …mais pas en requête individuelle
    expect(out.nextState).not.toBeNull();
  });

  it("une pause de plus de trois ans au milieu de l'historique ne perd rien", async () => {
    // Ordres en 2015, puis pause 2016-2019, reprise 2020 : l'arrêt sur années
    // vides se déclenche en 2017 — le balayage doit rattraper 2015.
    const parAnnee = { 2015: [ordre(2015)] };
    for (let an = 2020; an <= 2026; an += 1) parAnnee[an] = [ordre(an)];
    const { fetchRange } = fauxDegiro({
      parAnnee,
      refuse: (du, au) => largeur(du, au) > 8,
    });
    const out = await captureHistory({ today: AUJOURDHUI, state: null, fetchRange });

    expect(out.failed).toBe(0);
    expect(out.rows.map((r) => r.id)).toContain('2015-1');
    expect(out.rows).toHaveLength(8);
    expect(out.nextState).not.toBeNull();
  });

  it("une année refusée n'annule pas les autres, mais empêche de déclarer l'historique complet", async () => {
    const parAnnee = {};
    for (let an = 2018; an <= 2026; an += 1) parAnnee[an] = [ordre(an)];
    const { fetchRange } = fauxDegiro({
      parAnnee,
      refuse: (du, au) => largeur(du, au) > 5 || String(du).includes('2021'),
    });
    const out = await captureHistory({ today: AUJOURDHUI, state: null, fetchRange });

    expect(out.rows.map((r) => r.id)).not.toContain('2021-1');
    expect(out.rows.length).toBe(8);
    expect(out.failed).toBeGreaterThan(0);
    expect(out.detail).toContain('2021');
    // Pas de mémoire : la prochaine capture retentera tout.
    expect(out.nextState).toBeNull();
  });

  it('dédoublonne les recouvrements sans confondre deux exécutions du même ordre', async () => {
    const fill1 = { ...ordre(2024, 1), orderId: 'ord-x' };
    const fill2 = { ...ordre(2024, 2), orderId: 'ord-x' }; // même ordre, autre exécution
    const { fetchRange } = fauxDegiro({
      parAnnee: { 2024: [fill1, fill2, fill1], 2026: [ordre(2026)] },
      refuse: (du, au) => largeur(du, au) > 5, // chemin découpé, où le dédoublonnage opère
    });
    const out = await captureHistory({ today: AUJOURDHUI, state: null, fetchRange });

    // fill1 en double disparaît ; fill2 est CONSERVÉE malgré l'orderId partagé.
    const ordreX = out.rows.filter((r) => r.orderId === 'ord-x');
    expect(ordreX).toHaveLength(2);
  });
});

describe('captures suivantes — mémoire', () => {
  const memoire = { completeSince: '2013-01-01', capturedThrough: '2026-07-01' };

  it('ne relit que la période récente, en une requête', async () => {
    const { appels, fetchRange } = fauxDegiro({ parAnnee: { 2026: [ordre(2026)] } });
    const out = await captureHistory({ today: AUJOURDHUI, state: memoire, fetchRange });

    expect(appels).toHaveLength(1);
    // Recouvrement : on repart environ un mois avant la dernière capture
    // (2026-07-01 − 31 jours → fin mai, au fuseau près).
    expect(appels[0].du).toMatch(/^(30|31)\/05\/2026$/);
    expect(OVERLAP_DAYS).toBeGreaterThanOrEqual(7);
    expect(out.failed).toBe(0);
    expect(out.nextState.capturedThrough).toBe('2026-07-28');
    expect(out.nextState.completeSince).toBe('2013-01-01');
    expect(out.detail).toContain('déjà enregistré');
  });

  it('un refus ne détruit pas la mémoire', async () => {
    const { fetchRange } = fauxDegiro({ refuse: () => true });
    const out = await captureHistory({ today: AUJOURDHUI, state: memoire, fetchRange });

    expect(out.failed).toBe(1);
    expect(out.nextState).toEqual(memoire); // conservée telle quelle
    expect(out.detail).toContain('conservé');
  });
});

describe('replis supplémentaires', () => {
  it('la sonde retente sans agrégation, et la remontée suit ce réglage', async () => {
    // Instance qui refuse `groupTransactionsByOrder` partout.
    const parAnnee = { 2024: [ordre(2024)], 2026: [ordre(2026)] };
    const { appels, fetchRange } = fauxDegiro({
      parAnnee,
      refuse: (du, au, grouper) => grouper || largeur(du, au) > 5,
    });
    const out = await captureHistory({ today: AUJOURDHUI, state: null, fetchRange });

    expect(out.failed).toBe(0);
    expect(out.rows.map((r) => r.id)).toEqual(expect.arrayContaining(['2024-1', '2026-1']));
    // Après la sonde, plus aucun appel agrégé : on ne re-teste pas un réglage
    // déjà refusé à chaque année.
    const apresSonde = appels.slice(4);
    expect(apresSonde.every((a) => a.grouper === false)).toBe(true);
  });

  it('un balayage refusé retombe sur les années restantes une à une — rien n’est perdu', async () => {
    // Compte dormant : ordres en 2014 seulement, puis reprise en 2024. Le
    // balayage (plage encore large) est refusé : les années restantes doivent
    // être lues individuellement.
    const parAnnee = { 2014: [ordre(2014)], 2024: [ordre(2024)], 2025: [ordre(2025)], 2026: [ordre(2026)] };
    const { fetchRange } = fauxDegiro({
      parAnnee,
      refuse: (du, au) => largeur(du, au) > 0, // seules les années seules passent
    });
    const out = await captureHistory({ today: AUJOURDHUI, state: null, fetchRange });

    expect(out.failed).toBe(0);
    expect(out.rows.map((r) => r.id)).toContain('2014-1');
    expect(out.rows).toHaveLength(4);
    expect(out.nextState).not.toBeNull();
  });
});
