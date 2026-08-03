import { useCallback, useEffect, useMemo, useState } from 'react';
import { LineChart, Line, Legend, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { getSnapshots, getPerformance, getBenchmark, getAnalytics } from '../lib/api.js';
import { fmtEur, fmtPct, fmtDate, fmtDateShort, fmtNum, plural } from '../lib/format.js';
import {
  Spinner, Card, Stat, Banner, Empty, SubTabs, SubPanel, SearchInput, Pager,
} from '../components/ui.jsx';
import { useSort } from '../lib/useSort.js';
import { usePagination } from '../lib/usePagination.js';
import SortHeader from '../components/SortHeader.jsx';
import RealizedPanel from '../components/RealizedPanel.jsx';
import PerfCharts from '../components/PerfCharts.jsx';
import Dividends from './Dividends.jsx';

const TT = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' };
const axisTick = { fontSize: 12, fill: 'var(--ink-faint)' };
const signPct = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmtPct(v)}`);
const signEur = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmtEur(v)}`);
const tone = (v) => (v == null ? '' : v >= 0 ? 'pos' : 'neg');

/** Barre de contribution : part (signée) d'une ligne dans le P/L total. */
function ContribBar({ value }) {
  if (value == null) return <span className="muted">—</span>;
  const pct = Math.max(-1, Math.min(1, value));
  const width = `${Math.min(100, Math.abs(pct) * 100)}%`;
  return (
    <div className="contrib" title={signPct(value)}>
      <div className="contrib-track">
        <span className={`contrib-fill ${pct >= 0 ? 'pos' : 'neg'}`} style={{ width }} />
      </div>
      <span className="contrib-val">{signPct(value)}</span>
    </div>
  );
}

// ── Détail par titre ─────────────────────────────────────────────────
/**
 * Filtres du tableau par titre : recherche libre et sens de la performance.
 *
 * Sur vingt-sept lignes, « montre-moi seulement ce qui perd » se faisait à l'œil
 * en parcourant une colonne. Le tri ne remplace pas le filtre : il rapproche les
 * perdants, il ne fait pas disparaître les autres.
 */
const SENS = [
  { key: 'tous', label: 'Toutes' },
  { key: 'gagnants', label: 'En gain', test: (r) => r.pl_eur > 0 },
  { key: 'perdants', label: 'En perte', test: (r) => r.pl_eur < 0 },
];

export function filtrerTitres(rows, { texte = '', sens = 'tous' } = {}) {
  const q = texte.trim().toLowerCase();
  const regle = SENS.find((s) => s.key === sens)?.test;
  return (rows || []).filter((r) => {
    if (regle && !regle(r)) return false;
    if (!q) return true;
    return `${r.name || ''} ${r.isin || ''} ${r.sector || ''}`.toLowerCase().includes(q);
  });
}

function AttributionTable({ rows, hasDividends }) {
  const [texte, setTexte] = useState('');
  const [sens, setSens] = useState('tous');
  const filtrees = useMemo(() => filtrerTitres(rows, { texte, sens }), [rows, texte, sens]);
  const { sorted, sort, toggle } = useSort(filtrees, { key: 'pl_eur', dir: 'desc' }, {
    name: (r) => r.name || r.isin,
  });
  // Le tri entre dans la clé : rester en page 2 après avoir réordonné la liste
  // affiche les lignes 26-50 d'un classement que l'on vient de changer.
  const pg = usePagination(sorted, { taille: 25, cle: `${texte}|${sens}|${sort.key}|${sort.dir}` });

  return (
    <>
      <div className="filter-bar">
        <SearchInput value={texte} onChange={setTexte} placeholder="Rechercher un titre, un secteur…" />
        <div className="segmented" role="group" aria-label="Sens de la performance">
          {SENS.map((s) => (
            <button key={s.key} type="button" className={`seg ${sens === s.key ? 'on' : ''}`}
              aria-pressed={sens === s.key} onClick={() => setSens(s.key)}>{s.label}</button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="muted" style={{ margin: '18px 0' }}>Aucun titre ne correspond à ce filtre.</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data compact">
              <thead>
                <tr>
                  <SortHeader label="Titre" colKey="name" sort={sort} onToggle={toggle} align="left" />
                  <SortHeader label="Poids" colKey="weight" sort={sort} onToggle={toggle} cls="col-opt" />
                  <SortHeader label="Valeur" colKey="value_eur" sort={sort} onToggle={toggle} />
                  <SortHeader label="+/- €" colKey="pl_eur" sort={sort} onToggle={toggle} />
                  <SortHeader label="+/- %" colKey="pl_pct" sort={sort} onToggle={toggle} cls="col-opt" />
                  <SortHeader label="Contribution" colKey="contribution" sort={sort} onToggle={toggle} cls="col-opt" />
                  {hasDividends && <SortHeader label="Dividendes" colKey="dividends_eur" sort={sort} onToggle={toggle} cls="col-opt" />}
                </tr>
              </thead>
              <tbody>
                {pg.lignes.map((r) => (
                  <tr key={r.isin}>
                    <td>
                      <span className="sym">{r.name}</span>
                      {r.sector && <span className="muted sm"> · {r.sector}</span>}
                    </td>
                    <td className="col-opt">{fmtPct(r.weight)}</td>
                    <td className="sym">{fmtEur(r.value_eur)}</td>
                    <td className={tone(r.pl_eur)}>{signEur(r.pl_eur)}</td>
                    <td className={`col-opt ${tone(r.pl_pct)}`}>{signPct(r.pl_pct)}</td>
                    <td className="col-opt"><ContribBar value={r.contribution} /></td>
                    {hasDividends && <td className={`col-opt ${r.dividends_eur ? 'pos' : 'muted'}`}>{r.dividends_eur ? fmtEur(r.dividends_eur) : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={pg.page} pages={pg.pages} total={pg.total} debut={pg.debut} taille={pg.taille}
            onPage={pg.setPage} onTaille={pg.setTaille} libelle="titre"
          />
        </>
      )}
    </>
  );
}

export default function History({ onGoImport, route }) {
  const [rows, setRows] = useState(null);
  const [perf, setPerf] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [benchKey, setBenchKey] = useState('world');
  const [bench, setBench] = useState(null);
  const [error, setError] = useState(null);
  const ongletInitial = route === 'dividends' ? 'dividendes' : 'evolution';
  const [onglet, setOnglet] = useState(ongletInitial);

  /**
   * Onglets DÉJÀ VISITÉS. Une fois monté, un panneau ne redescend plus : il est
   * simplement masqué.
   *
   * Rendre conditionnellement (`onglet === 'titres' && …`) démontait le panneau
   * quitté, et son état partait avec lui. Régler un filtre sur « Réalisé »,
   * jeter un œil à une courbe, revenir : tout était revenu à zéro — filtres,
   * tri, recherche, page. C'était la première cause de « les filtres ne
   * marchent pas ».
   *
   * Monter au premier affichage seulement, et pas d'emblée : `ResponsiveContainer`
   * mesure son parent au montage, et un parent masqué a une largeur nulle — les
   * graphiques naîtraient vides sur un lien direct vers un autre onglet.
   */
  const [vus, setVus] = useState(() => new Set([ongletInitial]));
  const changerOnglet = useCallback((id) => {
    setOnglet(id);
    setVus((prec) => (prec.has(id) ? prec : new Set(prec).add(id)));
  }, []);

  useEffect(() => {
    getSnapshots().then((d) => setRows(d.snapshots)).catch((e) => setError(e.message));
    getPerformance().then(setPerf).catch(() => setPerf({ insufficient: true }));
    getAnalytics().then(setAnalytics).catch(() => setAnalytics(null));
  }, []);

  // La LISTE des indices est mémorisée à part de la réponse courante.
  //
  // Elle vient du serveur avec les cours, et le chargement remettait tout à
  // `null` : au clic sur « S&P 500 », les quatre boutons disparaissaient pour
  // laisser un unique bouton grisé « MSCI World » — le bouton qu'on venait de
  // presser s'effaçait sous le doigt. Combiné à une source de cours injoignable,
  // qui laisse la courbe inchangée, le sélecteur passait pour mort.
  const [indices, setIndices] = useState(null);
  const [chargeBench, setChargeBench] = useState(true);

  useEffect(() => {
    let vivant = true;
    setChargeBench(true);
    getBenchmark(benchKey)
      .then((b) => {
        if (!vivant) return;
        setBench(b);
        if (b?.benchmarks?.length) setIndices(b.benchmarks);
      })
      .catch(() => { if (vivant) setBench({ available: false, reason: 'error' }); })
      .finally(() => { if (vivant) setChargeBench(false); });
    // Une réponse lente arrivant après un second clic écrasait la plus récente :
    // l'écran affichait alors l'indice précédent, bouton actif à l'appui.
    return () => { vivant = false; };
  }, [benchKey]);

  if (error) return <Banner kind="err">Erreur : {error}</Banner>;
  if (!rows) return <Spinner />;

  if (rows.length === 0) {
    return (
      <Card>
        <Empty title="Aucune donnée de performance">
          Importe ton portefeuille pour analyser ta performance.
          <div style={{ marginTop: 14 }}>
            <button className="btn" onClick={onGoImport}>Importer mon portefeuille</button>
          </div>
        </Empty>
      </Card>
    );
  }

  const data = rows.map((r) => ({ date: fmtDateShort(r.snapshot_date), value: Number(r.total_value_eur) || 0 }));
  const last = data[data.length - 1].value;
  const first = data[0].value;
  const change = last - first;
  const twr = perf && !perf.insufficient ? perf.twr : null;
  const risk = analytics?.risk || null;
  const conc = analytics?.concentration || null;
  const attr = analytics?.attribution || null;

  const benchAvailable = bench && bench.available;
  const benchName = bench?.name || 'Benchmark';
  const alpha = benchAvailable ? bench.alpha : null;
  const compareSeries = benchAvailable
    ? bench.series.map((s) => ({ date: fmtDateShort(s.date), twr: s.twr * 100, benchmark: s.benchmark != null ? s.benchmark * 100 : null }))
    : (perf && perf.series ? perf.series.map((s) => ({ date: fmtDateShort(s.date), twr: s.twr * 100, benchmark: null })) : []);

  const totalPl = attr?.totals?.pl_eur ?? null;
  const totalPlPct = attr?.totals?.pl_pct ?? null;
  const realized = analytics?.realized || null;
  const capital = perf?.capital || null;

  // Les compteurs annoncent le volume avant le clic : savoir qu'il y a 143
  // ventes derrière l'onglet évite d'y entrer pour le découvrir.
  const onglets = [
    { id: 'evolution', label: 'Évolution' },
    { id: 'titres', label: 'Par titre', count: attr?.rows?.length || null },
    { id: 'realise', label: 'Réalisé & fiscal', count: realized?.totals?.sales || null },
    { id: 'dividendes', label: 'Dividendes' },
  ];

  return (
    <>
      <div className="page-head">
        <h1>Performance</h1>
        <p>Ta performance réelle, sa décomposition par titre, et les mesures de risque de ton portefeuille.</p>
      </div>

      {/* KPIs principaux.
          Le capital investi et le bénéfice passent devant : ce sont les deux
          chiffres qui répondent à « est-ce que je gagne de l'argent ? ». La
          valeur seule ne le dit pas — elle monte aussi quand on verse. */}
      <div className="grid stat-row">
        <Stat label="Valeur actuelle" value={fmtEur(last)} sub={`au ${data[data.length - 1].date}`} />
        {capital && capital.invested != null && capital.coverage !== 'none' ? (
          <>
            <Stat label="Capital investi" value={fmtEur(capital.invested)} sub={`${plural(capital.flows, 'versement')} depuis le ${fmtDate(capital.firstFlow)}`} />
            <Stat
              label="Bénéfice"
              value={signEur(capital.pnl)}
              sub={capital.pnlPct != null ? `${signPct(capital.pnlPct)} du capital` : 'valeur − capital investi'}
              tone={tone(capital.pnl)}
            />
          </>
        ) : (
          <Stat label="+/- value latente" value={signEur(totalPl)} sub={totalPlPct != null ? signPct(totalPlPct) : 'apports inclus'} tone={tone(totalPl)} />
        )}
        <Stat
          label="Performance (TWR)"
          value={twr != null ? signPct(twr) : '—'}
          sub={twr != null ? `du ${fmtDate(perf.from)} au ${fmtDate(perf.to)}` : '≥ 2 jours requis'}
          tone={tone(twr)}
        />
        {benchAvailable && alpha != null ? (
          <Stat label={`vs ${benchName}`} value={signPct(alpha)} sub={`indice : ${signPct(bench.benchmarkReturn)}`} tone={tone(alpha)} />
        ) : (
          <Stat label="Variation de valeur" value={signEur(change)} sub="apports inclus" tone={tone(change)} />
        )}
      </div>

      {/* Sections en onglets.
          Empilées, elles faisaient plusieurs milliers de pixels : atteindre les
          dividendes imposait de traverser tout l'historique des ventes, et les
          graphiques se retrouvaient enterrés sous les tableaux. Le bandeau de
          chiffres ci-dessus reste hors des onglets, comme point fixe. */}
      <SubTabs value={onglet} onChange={changerOnglet} items={onglets} label="Sections de la performance" />

      {vus.has('evolution') && (
      <SubPanel id="evolution" cache={onglet !== 'evolution'}>
      <div>
        <PerfCharts snapshots={rows} perf={perf} />
      </div>

      {/* Mesures de risque */}
      {risk ? (
        <div style={{ marginTop: 16 }}>
          <Card title="Risque & volatilité">
            <div className="grid stat-row">
              <Stat label="Volatilité (ann.)" value={fmtPct(risk.volatility)} sub="amplitude des variations" />
              <Stat label="Pire baisse (drawdown)" value={fmtPct(risk.maxDrawdown)} sub="du sommet au creux" tone="neg" />
              <Stat label="Sharpe" value={risk.sharpe != null ? fmtNum(risk.sharpe, 2) : '—'} sub="rendement / risque" tone={risk.sharpe > 0 ? 'pos' : ''} />
              <Stat label="Meilleur / pire jour" value={`${signPct(risk.bestPeriod)} / ${signPct(risk.worstPeriod)}`} sub={`${risk.periods} périodes`} />
            </div>
            {risk.currentDrawdown < -0.001 && (
              <div style={{ marginTop: 12 }}>
                <Banner kind="info">
                  Actuellement à <strong>{fmtPct(risk.currentDrawdown)}</strong> sous ton plus haut historique.
                </Banner>
              </div>
            )}
          </Card>
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <Banner kind="info">
            Les mesures de risque (volatilité, drawdown, Sharpe) apparaîtront avec au moins quelques jours d'historique.
            L'historique se construit à chaque capture.
          </Banner>
        </div>
      )}

      <div style={{ margin: '16px 0' }}>
        <Banner kind="info">
          Le <strong>TWR</strong> mesure ta performance réelle en neutralisant tes dépôts/retraits.
          Pour qu'il soit exact, importe ton <strong>Account.csv</strong>.{' '}
          {perf && perf.flows ? `${plural(perf.flows, 'flux externe', 'flux externes')} pris en compte.` : 'Aucun flux externe détecté — le TWR égale la variation de valeur.'}
        </Banner>
      </div>

      {compareSeries.length >= 2 && (
        <Card title="Performance cumulée — portefeuille vs indice">
          {/* La liste vient de `indices`, conservée d'une réponse à l'autre :
              elle ne doit pas dépendre de la requête en cours. `aria-pressed`
              dit lequel est actif — la seule couleur ne le disait à personne
              d'autre qu'un œil valide. */}
          <div className="chip-row" style={{ marginBottom: 14 }} role="group" aria-label="Indice de référence">
            {(indices || [{ key: 'world', name: 'MSCI World' }]).map((b) => (
              <button
                key={b.key}
                type="button"
                className={`btn ${benchKey === b.key ? '' : 'ghost'}`}
                style={{ padding: '5px 12px', fontSize: 13 }}
                aria-pressed={benchKey === b.key}
                onClick={() => setBenchKey(b.key)}
              >
                {b.name}
                {chargeBench && benchKey === b.key && <span className="sr-only"> — chargement en cours</span>}
              </button>
            ))}
            {chargeBench && <span className="muted" style={{ fontSize: 12.5, alignSelf: 'center' }}>chargement…</span>}
          </div>

          {bench && !bench.available && (
            <div style={{ marginBottom: 14 }}>
              <Banner kind="info">
                {bench.reason === 'insufficient_history'
                  ? 'Le comparatif s\u2019affichera dès deux jours d\u2019historique.'
                  : 'Cours de l\u2019indice momentanément indisponibles (source publique injoignable). La courbe du portefeuille reste affichée.'}
              </Banner>
            </div>
          )}

          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={compareSeries} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={24} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `${v.toFixed(0)} %`} />
                <Tooltip formatter={(v, n) => [v == null ? '—' : `${Number(v).toFixed(2)} %`, n]} contentStyle={TT} labelStyle={{ color: 'var(--ink-soft)' }} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Line type="monotone" dataKey="twr" name="Portefeuille (TWR)" stroke="var(--c1)" strokeWidth={2.4} dot={false} isAnimationActive={false} />
                {benchAvailable && (
                  <Line type="monotone" dataKey="benchmark" name={benchName} stroke="var(--c2)" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="sub muted" style={{ marginTop: 12, fontSize: 12.5 }}>
            Comparaison équitable : le TWR neutralise tes apports, l'indice est un « buy &amp; hold » sur la même période.
            Cours : Stooq (clôtures, à titre indicatif).
          </div>
        </Card>
      )}
      </SubPanel>
      )}

      {vus.has('titres') && (
      <SubPanel id="titres" cache={onglet !== 'titres'}>
      {/* Concentration */}
      {conc && conc.lines > 0 && (
        <div>
          <Card title="Concentration & diversification">
            <div className="grid stat-row">
              <Stat label="Plus grosse ligne" value={fmtPct(conc.top1)} sub="poids du n°1" tone={conc.top1 > 0.25 ? 'neg' : ''} />
              <Stat label="Top 5" value={fmtPct(conc.top5)} sub={`sur ${conc.lines} lignes`} tone={conc.top5 > 0.6 ? 'neg' : ''} />
              <Stat label="Lignes effectives" value={fmtNum(conc.effectiveHoldings, 1)} sub="diversification réelle" />
              <Stat label="Lignes détenues" value={fmtNum(conc.lines, 0)} />
            </div>
            {conc.effectiveHoldings < conc.lines / 2 && (
              <div style={{ marginTop: 12 }}>
                <Banner kind="info">
                  Tu détiens {conc.lines} lignes mais l'équivalent de seulement <strong>{fmtNum(conc.effectiveHoldings, 1)}</strong> en
                  diversification réelle : quelques positions pèsent lourd.
                </Banner>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Détail par titre */}
      {attr && attr.rows.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Card title="Performance par titre">
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              La <strong>contribution</strong> est la part de chaque ligne dans ta +/- value totale.
              Clique les en-têtes pour trier.
            </p>
            <AttributionTable rows={attr.rows} hasDividends={(attr.totals.dividends_eur || 0) !== 0} />
          </Card>
        </div>
      )}
      </SubPanel>
      )}

      {vus.has('realise') && (
      <SubPanel id="realise" cache={onglet !== 'realise'}>
        {realized
          ? <RealizedPanel realized={realized} latentPl={totalPl} />
          : (
            <Banner kind="info">
              Importe ton <strong>Transactions.csv</strong> et ton <strong>Account.csv</strong> pour
              voir tes plus-values réalisées et ta vue fiscale.
            </Banner>
          )}
      </SubPanel>
      )}

      {vus.has('dividendes') && (
      <SubPanel id="dividendes" cache={onglet !== 'dividendes'}>
        <Dividends onGoImport={onGoImport} />
      </SubPanel>
      )}
    </>
  );
}
