import { fmtEur, fmtPct, fmtNum, fmtDate } from './format.js';

function posLine(p, total) {
  const w = total ? (Number(p.value_eur) || 0) / total : 0;
  const tick = p.ticker ? `, ${p.ticker}` : '';
  return `- ${p.name || p.symbol || p.isin} (${p.isin}${tick}) · ${fmtNum(p.qty, 0)} × ${fmtNum(p.price)} ${p.currency || ''} = ${fmtEur(p.value_eur)} (${fmtPct(w)})`;
}

function expoLine(label, arr) {
  if (!arr || !arr.length) return null;
  return `${label} : ${arr.map((x) => `${x.key} ${fmtPct(x.weight)}`).join(' · ')}`;
}

function contextBlock({ snapshot, positions }, exposure) {
  const total = positions.reduce((s, p) => s + (Number(p.value_eur) || 0), 0);
  const lines = [
    `Date : ${fmtDate(snapshot.snapshot_date)}`,
    `Valeur investie : ${fmtEur(total)} · Liquidités : ${fmtEur(snapshot.cash_eur)} · ${positions.length} lignes`,
    '',
    'Positions (nom, ISIN, quantité × cours = valeur, poids) :',
    positions.map((p) => posLine(p, total)).join('\n'),
  ];
  if (exposure) {
    const rows = [
      expoLine('Devise', exposure.currency),
      expoLine('Pays', exposure.country),
      expoLine('Secteur', exposure.sector),
      expoLine("Classe d'actifs", exposure.asset_class),
    ].filter(Boolean);
    if (rows.length) {
      lines.push('', 'Répartitions :', ...rows.map((r) => '- ' + r));
    }
  }
  return lines.join('\n');
}

const DISCLAIMER =
  "Sois honnête et nuancé, distingue les faits des opinions, signale les incertitudes, et précise que ceci n'est pas un conseil en investissement personnalisé. Si tu as accès au web, utilise des données récentes et cite tes sources avec leur date.";

export const PORTFOLIO_PROMPTS = [
  {
    id: 'review',
    title: 'Analyse globale',
    desc: 'Un avis structuré sur tout le portefeuille : diversification, risques, forces/faiblesses, pistes.',
    build: (pf, expo) => `Tu es un analyste financier expérimenté. Voici mon portefeuille boursier (courtier DEGIRO), en EUR.

${contextBlock(pf, expo)}

Analyse-le de façon structurée et critique :
1. Diagnostic global (qualité de la diversification, style d'investissement, cohérence).
2. Concentration et risques principaux (par ligne, secteur, pays, devise).
3. Forces et faiblesses.
4. Pistes d'amélioration concrètes (lignes à renforcer/alléger, rééquilibrage, exposition de change), en expliquant le raisonnement.
5. Les 3 questions que je devrais me poser avant d'agir.

${DISCLAIMER}`,
  },
  {
    id: 'diversification',
    title: 'Diversification & change',
    desc: "Focus sur les déséquilibres (secteur, pays, devise) et l'effet de change EUR/USD.",
    build: (pf, expo) => `Tu es un gérant de portefeuille. Voici mes expositions actuelles (portefeuille en EUR).

${contextBlock(pf, expo)}

Concentre-toi sur :
1. Les déséquilibres d'exposition (secteur, pays, devise) et les risques qu'ils impliquent.
2. Mon exposition au dollar : impact d'une variation EUR/USD de ±10 % sur la valeur, et faut-il couvrir ?
3. Une allocation cible raisonnable pour un investisseur particulier européen, et les mouvements concrets pour m'en rapprocher.

${DISCLAIMER}`,
  },
  {
    id: 'news',
    title: 'Actualités & catalyseurs',
    desc: 'Un digest des actualités récentes et catalyseurs à venir sur tes principales lignes.',
    build: (pf) => {
      const total = pf.positions.reduce((s, p) => s + (Number(p.value_eur) || 0), 0);
      const top = [...pf.positions].sort((a, b) => (b.value_eur || 0) - (a.value_eur || 0)).slice(0, 10);
      return `Tu as accès à la recherche web. Pour chacune des sociétés ci-dessous (mes principales lignes), fais un point synthétique.

${top.map((p) => posLine(p, total)).join('\n')}

Pour chaque société :
1. Actualités marquantes des 3 derniers mois (résultats, guidance, opérations, réglementaire).
2. Catalyseurs connus à venir (prochains résultats, événements) avec leur date.
3. Sentiment récent des analystes.

Cite tes sources et leur date. ${DISCLAIMER}`;
    },
  },
  {
    id: 'risk',
    title: 'Stress test & risques',
    desc: 'Comment ton portefeuille réagirait à différents scénarios de marché.',
    build: (pf, expo) => `Tu es un analyste risques. Voici mon portefeuille.

${contextBlock(pf, expo)}

1. Estime qualitativement son comportement dans 3 scénarios : (a) correction tech -20 %, (b) forte hausse des taux, (c) récession avec baisse du dollar.
2. Quelles sont mes 3 vulnérabilités principales ?
3. Quelles couvertures ou ajustements simples réduiraient le risque sans dénaturer la stratégie ?

${DISCLAIMER}`,
  },
];

export function buildStockPrompt(p, weight) {
  const tick = p.ticker ? ` (${p.ticker})` : '';
  const extra = [p.sector && `secteur ${p.sector}`, p.country && `pays ${p.country}`].filter(Boolean).join(', ');
  return `Tu es analyste actions et tu as accès à la recherche web pour des données récentes.

Je détiens ${fmtNum(p.qty, 0)} actions de ${p.name || p.symbol}${tick} — ISIN ${p.isin}${extra ? ' (' + extra + ')' : ''}, cours ${fmtNum(p.price)} ${p.currency || ''}, valeur ${fmtEur(p.value_eur)}, soit ${fmtPct(weight)} de mon portefeuille.

Fais une analyse complète et équilibrée :
1. Activité et thèse d'investissement : arguments haussiers (bull) vs baissiers (bear).
2. Valorisation actuelle : multiples clés vs historique et concurrents (données récentes).
3. Fourchette de prix : zones d'achat / de renforcement / de prise de profit, et un niveau de stop raisonnable — avec le raisonnement.
4. Catalyseurs et risques à 6–12 mois.
5. Actualités récentes marquantes (sources + dates).
6. Conclusion : conserver / renforcer / alléger, en tenant compte que cette ligne pèse ${fmtPct(weight)} chez moi.

${DISCLAIMER}`;
}
