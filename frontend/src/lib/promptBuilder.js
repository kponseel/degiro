import { fmtEur, fmtNum, fmtDate } from './format.js';

/**
 * Générateur de prompts à copier-coller, module PUR (aucune API navigateur) :
 * il assemble le texte, et c'est la partie testable hors navigateur.
 *
 * Aller seulement : le texte part dans l'assistant de l'utilisateur, la réponse
 * ne revient pas dans l'application. Pas de format imposé à la réponse, donc —
 * juste une structure claire en français, lisible par un humain.
 *
 * Deux portées :
 *  - `portfolio` : le portefeuille entier (éventuellement filtré par valeur) ;
 *  - `stocks`    : une sélection de titres, un ou plusieurs.
 * Les poids sont toujours calculés sur le portefeuille ENTIER : filtrer ou
 * sélectionner des lignes ne doit pas gonfler le poids des autres.
 */

// `Number(null)` et `Number('')` valent 0 : une valeur ABSENTE deviendrait une
// valeur nulle (« +0,0 % » de plus-value inventé).
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const pct1 = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1).replace('.', ',')} %` : '—');
const signedPct = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${pct1(v)}` : '—');
const signedEur = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fmtEur(v)}`);

/** Un nom lisible, sans le séparateur de colonnes du tableau. */
const label = (p) => String(p.name || p.symbol || p.isin || '?').replace(/\|/g, ' ').trim().slice(0, 48);

/** Total investi (hors liquidités) : la base des poids. */
export const totalValue = (positions) =>
  (positions || []).reduce((s, p) => s + (num(p.value_eur) || 0), 0);

/**
 * +/- value latente en % du prix de revient. `pl_eur` est la plus-value en
 * euros : le coût vaut donc valeur − plus-value. Rien n'est inventé quand l'une
 * des deux manque, ou quand le coût serait nul ou négatif (frais, apport gratuit).
 */
export function plPct(p) {
  const v = num(p.value_eur);
  const pl = num(p.pl_eur);
  if (v == null || pl == null) return null;
  const cost = v - pl;
  return cost > 0 ? pl / cost : null;
}

/** Coût moyen en euros d'un titre détenu, déduit de la plus-value latente. */
function avgCost(p) {
  const v = num(p.value_eur);
  const pl = num(p.pl_eur);
  const q = num(p.qty);
  if (v == null || pl == null || !q) return null;
  const cost = v - pl;
  return cost > 0 ? cost / q : null;
}

/** Tri par valeur décroissante, sans muter l'entrée. */
const byValue = (positions) => [...(positions || [])].sort((a, b) => (num(b.value_eur) || 0) - (num(a.value_eur) || 0));

/**
 * Colonnes du tableau des positions. `cell` renvoie '' quand la donnée manque :
 * une colonne vide sur TOUTES les lignes est retirée (un import Portfolio.csv
 * n'a ni prix de revient ni plus-value, un titre non enrichi ni secteur) —
 * douze colonnes de tirets ne diraient rien à l'assistant et coûteraient cher.
 */
const COLUMNS = [
  { head: 'Titre', cell: (p) => label(p), keep: true },
  { head: 'ISIN', cell: (p) => p.isin || '', keep: true },
  { head: 'Ticker', cell: (p) => p.ticker || p.symbol || '' },
  { head: 'Secteur', cell: (p) => p.sector || '' },
  { head: 'Pays', cell: (p) => p.country || '' },
  { head: 'Qté', cell: (p) => (num(p.qty) == null ? '' : fmtNum(p.qty, Number.isInteger(num(p.qty)) ? 0 : 4)) },
  { head: 'Cours', cell: (p) => (num(p.price) == null ? '' : fmtNum(p.price)) },
  { head: 'Devise', cell: (p) => p.currency || '' },
  { head: 'Coût moyen €', cell: (p) => (avgCost(p) == null ? '' : fmtNum(avgCost(p))) },
  { head: 'Valeur €', cell: (p) => (num(p.value_eur) == null ? '' : fmtEur(p.value_eur)), keep: true },
  { head: 'Poids', cell: (p, total) => (total > 0 ? pct1((num(p.value_eur) || 0) / total) : ''), keep: true },
  { head: '+/- value €', cell: (p) => (num(p.pl_eur) == null ? '' : signedEur(num(p.pl_eur))) },
  { head: '+/- value %', cell: (p) => (plPct(p) == null ? '' : signedPct(plPct(p))) },
  { head: 'Déjà réalisé €', cell: (p) => (num(p.pl_realized_eur) ? signedEur(num(p.pl_realized_eur)) : '') },
];

/**
 * Tableau des positions, une ligne par titre, colonnes séparées par « | ».
 * Plus compact que des phrases, et lu sans ambiguïté par les assistants.
 * @returns {{ table: string, heads: string[] }}
 */
export function positionsTable(positions, total) {
  const cols = COLUMNS.filter((c) => c.keep || positions.some((p) => c.cell(p, total) !== ''));
  const rows = positions.map((p) => cols.map((c) => c.cell(p, total) || '—').join('|'));
  return { table: [cols.map((c) => c.head).join('|'), ...rows].join('\n'), heads: cols.map((c) => c.head) };
}

/** Répartitions déjà agrégées (secteur, pays, devise), 6 premières entrées. */
export function exposureLines(exposure) {
  if (!exposure) return [];
  const row = (name, arr) => (arr?.length
    ? `${name} : ${arr.slice(0, 6).map((x) => `${x.key} ${pct1(x.weight)}`).join(' · ')}`
    : null);
  return [
    row('Secteurs', exposure.sector),
    row('Pays', exposure.country),
    row('Devises', exposure.currency),
  ].filter(Boolean);
}

// ── Options ──────────────────────────────────────────────────────────

export const HORIZONS = [
  { value: 'court', label: 'Court terme', text: 'à court terme (moins d’un an)' },
  { value: 'moyen', label: 'Moyen terme', text: 'à moyen terme (1 à 3 ans)' },
  { value: 'long', label: 'Long terme', text: 'à long terme (5 ans et plus)' },
];

export const PROFILES = [
  { value: 'prudent', label: 'Prudent', text: 'Mon profil est prudent : je privilégie la préservation du capital.' },
  { value: 'equilibre', label: 'Équilibré', text: 'Mon profil est équilibré : j’accepte des fluctuations pour un rendement raisonnable.' },
  { value: 'offensif', label: 'Offensif', text: 'Mon profil est offensif : j’accepte une forte volatilité pour viser plus de performance.' },
];

export const LENGTHS = [
  { value: 'courte', label: 'Réponse courte', text: 'Sois concis : l’essentiel en quelques lignes par point, sans remplissage.' },
  { value: 'detaillee', label: 'Réponse détaillée', text: 'Développe tes arguments et chiffre-les quand c’est possible.' },
];

export const CASH = [
  { value: 'aucun', label: 'Pas d’argent frais', text: 'Je n’ajoute pas d’argent : tout achat doit être financé par une vente.' },
  { value: 'appoint', label: 'Un petit appoint', text: 'Je peux ajouter un petit appoint, mais l’essentiel doit être financé par des ventes.' },
  { value: 'frais', label: 'Argent frais possible', text: 'Je peux ajouter de l’argent frais si c’est justifié.' },
];

/** Seuils de filtre du portefeuille entier : un tri grossier, pas une requête. */
export const MIN_VALUES = [0, 500, 1000, 2500, 5000];

export const DEFAULT_OPTIONS = Object.freeze({
  horizon: 'moyen',
  profile: 'equilibre',
  length: 'courte',
  cash: 'aucun',
  minValue: 0,
  web: true,
  note: '',
});

const pick = (list, value) => list.find((o) => o.value === value) || null;

// ── Objectifs ────────────────────────────────────────────────────────
// `scopes` : portées où l'objectif a un sens. `min` : nombre minimal de titres
// sélectionnés (comparer n'a de sens qu'à deux). `ask(ctx)` : la liste des
// questions, adaptée au nombre de titres (« ce titre » / « chacun de ces titres »).

const each = (n) => (n > 1 ? 'Pour chacun de ces titres' : 'Pour ce titre');

export const OBJECTIVES = [
  {
    id: 'analyse',
    label: 'Analyse complète',
    desc: 'Thèse, valorisation, risques, verdict.',
    scopes: ['stocks'],
    role: 'analyste actions',
    ask: ({ n }) => [
      `${each(n)} : l’activité en deux phrases et ce qui fait gagner de l’argent à l’entreprise.`,
      'Les arguments haussiers et baissiers principaux.',
      'La valorisation actuelle (multiples clés) comparée à son historique et à ses concurrents.',
      'Les catalyseurs et les risques à surveiller, avec leurs échéances connues.',
      'Un verdict : conserver, renforcer ou alléger — compte tenu de mon prix de revient et du poids de la ligne.',
    ],
  },
  {
    id: 'valorisation',
    label: 'Valorisation & zones de prix',
    desc: 'Cher ou pas cher ? Zones d’achat et de prise de profit.',
    scopes: ['stocks'],
    role: 'analyste financier spécialisé en valorisation',
    ask: ({ n }) => [
      `${each(n)} : les multiples actuels (PER, VE/EBITDA, rendement du free cash flow…) et leur position par rapport à l’historique et au secteur.`,
      'Une fourchette de valeur « juste », avec les hypothèses qui la fondent.',
      'Des zones de prix : renforcement, conservation, prise de profit partielle — avec le raisonnement.',
      'Ce qui invaliderait cette estimation.',
    ],
  },
  {
    id: 'sortie',
    label: 'Quand vendre ?',
    desc: 'Prise de profit, stop, signaux de sortie.',
    scopes: ['stocks', 'portfolio'],
    role: 'analyste actions',
    ask: ({ scope }) => [
      scope === 'portfolio'
        ? 'Parmi mes lignes, lesquelles justifient une prise de profit ou une sortie, et lesquelles conserver ?'
        : 'Faut-il conserver, alléger ou vendre, au vu de ma plus-value latente et de la situation actuelle ?',
      'Des niveaux de prix de sortie (partielle puis totale) et un seuil de protection raisonnable, avec le raisonnement.',
      'Les signaux qui justifieraient de vendre : valorisation tendue, thèse cassée, objectif atteint.',
      'L’ordre dans lequel vendre si je dois libérer des liquidités, en tenant compte des plus-values latentes et de la fiscalité.',
    ],
  },
  {
    id: 'renforcer',
    label: 'Renforcer ?',
    desc: 'Faut-il en acheter plus, et à quel prix ?',
    scopes: ['stocks'],
    role: 'analyste actions',
    ask: ({ n }) => [
      `${each(n)} : les raisons de renforcer maintenant, et celles d’attendre.`,
      'Un prix d’achat raisonnable et une façon d’entrer (en une fois ou en plusieurs fois).',
      'Le poids maximal que je devrais viser dans mon portefeuille, compte tenu du risque.',
      n > 1 ? 'Un ordre de priorité entre ces titres si je ne peux en renforcer qu’un.' : null,
    ],
  },
  {
    id: 'comparer',
    label: 'Comparer',
    desc: 'Les titres sélectionnés face à face.',
    scopes: ['stocks'],
    min: 2,
    role: 'analyste actions',
    ask: () => [
      'Un tableau comparatif : croissance, marges, endettement, valorisation, dividende, risque principal.',
      'Les points forts et faibles de chacun, face aux autres.',
      'Les doublons éventuels : ces titres m’exposent-ils au même risque ?',
      'Un classement argumenté : lequel garder en priorité, lequel alléger en premier.',
    ],
  },
  {
    id: 'actus',
    label: 'Actus & catalyseurs',
    desc: 'Ce qui s’est passé récemment et ce qui arrive.',
    scopes: ['stocks', 'portfolio'],
    role: 'analyste actions qui suit l’actualité',
    web: true,
    ask: ({ n, scope }) => [
      `${scope === 'portfolio' ? 'Pour mes principales lignes' : each(n)} : les nouvelles importantes des trois derniers mois (résultats, guidance, opérations, régulation), datées et sourcées.`,
      'Leur impact probable sur la thèse d’investissement.',
      'Les prochaines échéances : publications de résultats, assemblées, dividendes, décisions attendues.',
      'Ce qui mériterait une action de ma part, et ce qui n’est que du bruit.',
    ],
  },
  {
    id: 'dividendes',
    label: 'Dividendes',
    desc: 'Rendement, solidité, croissance des versements.',
    scopes: ['stocks', 'portfolio'],
    role: 'analyste spécialisé dans les valeurs de rendement',
    ask: ({ scope }) => [
      scope === 'portfolio'
        ? 'Le rendement sur dividende de chaque ligne qui en verse, et une estimation du revenu annuel du portefeuille.'
        : 'Le rendement sur dividende actuel et le revenu annuel que ma position devrait me verser.',
      'La solidité des versements : taux de distribution, couverture par le free cash flow, historique.',
      'La croissance attendue du dividende, et les risques de baisse.',
      scope === 'portfolio' ? 'Les lignes à renforcer pour améliorer le revenu sans dégrader la diversification.' : null,
    ],
  },
  {
    id: 'bilan',
    label: 'Bilan global',
    desc: 'Forces, faiblesses et cohérence du portefeuille.',
    scopes: ['portfolio'],
    role: 'gérant de portefeuille',
    ask: () => [
      'Une vue d’ensemble : style, cohérence, points forts et points faibles.',
      'Les lignes qui tirent le portefeuille, et celles qui pèsent dessus.',
      'Les concentrations et les angles morts.',
      'Les trois actions les plus utiles à mener, par ordre de priorité.',
    ],
  },
  {
    id: 'risques',
    label: 'Risques',
    desc: 'Concentrations, vulnérabilités, scénarios de choc.',
    scopes: ['portfolio', 'stocks'],
    role: 'analyste risques',
    ask: ({ scope, n }) => [
      scope === 'portfolio'
        ? 'Les concentrations et vulnérabilités principales : par ligne, secteur, pays et devise.'
        : `${each(n)} : les risques principaux (activité, bilan, valorisation, devise, régulation).`,
      'Le comportement probable dans trois scénarios : correction des valeurs technologiques de 20 %, forte hausse des taux, récession avec un dollar faible.',
      'Les ajustements simples qui réduiraient le risque sans dénaturer la stratégie.',
    ],
  },
  {
    id: 'diversification',
    label: 'Diversification & devises',
    desc: 'Déséquilibres secteur / pays / devise, exposition au dollar.',
    scopes: ['portfolio'],
    role: 'gérant de portefeuille',
    ask: () => [
      'Les déséquilibres d’exposition (secteur, pays, devise) et les risques associés.',
      'Mon exposition au dollar : l’effet d’une variation EUR/USD de ±10 %, et s’il faut s’en protéger.',
      'Une allocation cible raisonnable pour un particulier européen, et les mouvements concrets pour s’en rapprocher.',
    ],
  },
  {
    id: 'reequilibrage',
    label: 'Rééquilibrer',
    desc: 'Un plan chiffré : quoi alléger, où réinvestir.',
    scopes: ['portfolio'],
    role: 'conseiller en allocation d’actifs',
    usesCash: true,
    ask: () => [
      'Les positions à alléger ou à solder en priorité (valorisation, risque, redondance), et pourquoi.',
      'Où réinvestir : renforcer l’existant ou ouvrir une ou deux lignes, en justifiant chaque choix.',
      'Un plan chiffré en euros, avec l’ordre d’exécution.',
      'Les pièges à éviter : fiscalité des plus-values, frais, sur-concentration.',
    ],
  },
];

export const objectiveById = (id) => OBJECTIVES.find((o) => o.id === id) || null;

/** Objectifs proposés pour une portée et un nombre de titres donnés. */
export const objectivesFor = (scope, count = 0) =>
  OBJECTIVES.filter((o) => o.scopes.includes(scope) && (scope !== 'stocks' || count >= (o.min || 1)));

/**
 * Assemble le prompt.
 *
 * @param pf        réponse de /api/portfolio ({ snapshot, positions })
 * @param exposure  réponse de /api/exposure (facultative)
 * @param scope     'portfolio' | 'stocks'
 * @param isins     titres sélectionnés (portée 'stocks')
 * @param objective id d'objectif
 * @param options   voir DEFAULT_OPTIONS
 * @returns {{ text: string, count: number } | { error: string }}
 */
export function buildPrompt({ pf, exposure = null, scope, isins = [], objective, options = {} }) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const all = byValue(pf?.positions);
  if (!all.length) return { error: 'Aucune position dans le portefeuille.' };

  const obj = objectiveById(objective);
  if (!obj || !obj.scopes.includes(scope)) return { error: 'Choisis un objectif.' };

  const total = totalValue(all);
  const wanted = new Set(isins);
  let shown;
  if (scope === 'stocks') {
    shown = all.filter((p) => wanted.has(p.isin));
    if (!shown.length) return { error: 'Sélectionne au moins un titre.' };
    if (shown.length < (obj.min || 1)) return { error: `Sélectionne au moins ${obj.min} titres pour cet objectif.` };
  } else {
    const min = Number(opts.minValue) || 0;
    shown = min > 0 ? all.filter((p) => (num(p.value_eur) || 0) >= min) : all;
    if (!shown.length) return { error: 'Aucune ligne au-dessus de ce seuil.' };
  }

  const n = shown.length;
  const snap = pf.snapshot || {};
  const cash = num(snap.cash_eur);
  const date = snap.snapshot_date ? fmtDate(snap.snapshot_date) : null;
  const horizon = pick(HORIZONS, opts.horizon);
  const profile = pick(PROFILES, opts.profile);
  const length = pick(LENGTHS, opts.length);
  const web = opts.web || obj.web;

  const subject = scope === 'portfolio'
    ? 'mon portefeuille'
    : (n > 1 ? `${n} titres de mon portefeuille` : `un titre de mon portefeuille (${label(shown[0])})`);

  const out = [];
  out.push(`Tu es ${obj.role}. Je suis un investisseur particulier européen (courtier DEGIRO, compte en euros) et je veux ton analyse sur ${subject}.`);
  out.push('');
  out.push(`## Contexte${date ? ` (données au ${date})` : ''}`);
  out.push(`Portefeuille : ${fmtEur(total)} investis en ${all.length} ligne${all.length > 1 ? 's' : ''}${cash != null ? `, ${fmtEur(cash)} de liquidités` : ''}.`);
  if (scope === 'portfolio' && n < all.length) {
    const rest = all.filter((p) => !shown.includes(p));
    out.push(`Seules les ${n} lignes de plus de ${fmtEur(opts.minValue)} sont listées ; ${rest.length} petites lignes (${fmtEur(totalValue(rest))} au total) sont omises volontairement.`);
  }
  if (scope === 'stocks') {
    const part = totalValue(shown);
    out.push(`${n > 1 ? 'Ces titres pèsent' : 'Ce titre pèse'} ${fmtEur(part)}, soit ${pct1(total > 0 ? part / total : NaN)} de la partie investie.`);
  }
  out.push('');
  const { table, heads } = positionsTable(shown, total);
  out.push(table);
  out.push([
    heads.includes('Coût moyen €') ? 'Coût moyen = prix d’achat moyen en euros d’un titre encore détenu.' : null,
    heads.includes('+/- value €') ? '+/- value = plus-value latente des titres détenus.' : null,
    heads.includes('Déjà réalisé €') ? 'Déjà réalisé = gain déjà encaissé par des ventes partielles, hors plus-value latente.' : null,
    'Poids = part de la valeur investie totale.',
  ].filter(Boolean).join(' '));

  if (scope === 'portfolio') {
    const expo = exposureLines(exposure);
    if (expo.length) {
      out.push('');
      out.push('Répartition du portefeuille :');
      out.push(...expo);
    }
  }

  out.push('');
  out.push('## Ce que je te demande');
  const questions = obj.ask({ n, scope }).filter(Boolean);
  questions.forEach((q, i) => out.push(`${i + 1}. ${q}`));

  out.push('');
  out.push('## Cadre');
  if (horizon) out.push(`- Horizon : raisonne ${horizon.text}.`);
  if (profile) out.push(`- ${profile.text}`);
  if (obj.usesCash) {
    const c = pick(CASH, opts.cash);
    if (c) out.push(`- ${c.text}`);
  }
  const note = String(opts.note || '').trim();
  if (note) out.push(`- Précision de ma part : ${note.replace(/\s+/g, ' ').slice(0, 600)}`);
  if (web) out.push('- Utilise la recherche web pour des données récentes (cours, résultats, actualités) et cite tes sources avec leur date.');
  out.push('- Les chiffres ci-dessus sont ceux de mon courtier : s’ils te semblent incohérents avec les cours actuels, signale-le au lieu de les corriger en silence.');
  out.push('- Distingue les faits de tes opinions, signale tes incertitudes, et termine par une synthèse en trois points.');
  if (length) out.push(`- ${length.text}`);
  out.push('- Réponds en français.');
  out.push('');
  out.push('Ceci n’est pas une demande de conseil en investissement personnalisé : je prendrai mes décisions moi-même.');

  return { text: out.join('\n'), count: n };
}

/**
 * ISINs demandés dans le hash (#/ai?isin=A ou #/ai?isin=A,B) — raccourci depuis
 * le détail d'une position. Seuls ceux réellement détenus sont retenus : un lien
 * ancien ne doit pas sélectionner un titre revendu.
 */
export function isinsFromHash(hash, positions) {
  const q = String(hash || '').split('?')[1];
  if (!q) return [];
  const raw = new URLSearchParams(q).get('isin');
  if (!raw) return [];
  const held = new Set((positions || []).map((p) => p.isin));
  return [...new Set(raw.split(',').map((s) => s.trim().toUpperCase()))].filter((i) => held.has(i));
}
