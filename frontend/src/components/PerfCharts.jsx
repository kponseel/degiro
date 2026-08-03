import { useMemo, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, Cell, ComposedChart, Line,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import { fmtEur, fmtDate, fmtDateShort } from '../lib/format.js';
import { Card, Banner } from './ui.jsx';

const TT = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' };
const axisTick = { fontSize: 12, fill: 'var(--ink-faint)' };
const compact = (v) => new Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(v);
const signEur = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmtEur(v)}`);

/**
 * Étiquette d'axe temporel. Le jour et le mois suffisent sur quelques mois ;
 * au-delà d'un an, l'année devient indispensable — « 06/01 » désigne sinon deux
 * points différents sur le même axe, et la courbe devient impossible à dater.
 */
const etiquetteDate = (iso, avecAnnee) => (avecAnnee
  ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(2, 4)}`
  : fmtDateShort(iso));

/**
 * Ne garde que les nombres réellement mesurés.
 *
 * `Number(null)` vaut 0, tout comme `Number('')` : un simple `map(Number)`
 * transformait donc un trou de données en un vrai zéro, qui étirait l'axe
 * jusqu'à l'origine ou déclenchait une césure rouge sur une série pourtant
 * toujours bénéficiaire. L'absence de valeur doit rester une absence.
 */
const mesures = (valeurs) => (valeurs || [])
  .filter((v) => v !== null && v !== undefined && v !== '')
  .map(Number)
  .filter(Number.isFinite);

/**
 * Bornes d'axe resserrées sur les données, avec une marge de 6 %.
 *
 * `undefined` — l'échelle automatique de recharts — quand la série est vide ou
 * plate : la marge deviendrait nulle et les deux bornes se confondraient.
 */
export function echelle(valeurs, marge = 0.06) {
  const nombres = mesures(valeurs);
  if (nombres.length < 2) return undefined;
  const haut = Math.max(...nombres);
  const bas = Math.min(...nombres);
  if (haut === bas) return undefined;
  const pad = (haut - bas) * marge;
  return [Math.floor(bas - pad), Math.ceil(haut + pad)];
}

/**
 * Position du zéro dans une série, en fraction de la hauteur du graphique.
 *
 * Sert à couper un dégradé exactement sur l'axe : au-dessus le vert du gain, en
 * dessous le rouge de la perte. Sans cette césure, une aire de bénéfice reste
 * verte alors qu'elle plonge sous zéro — le graphique dit alors le contraire du
 * chiffre qu'il illustre. `null` quand la série ne change pas de signe : une
 * seule couleur suffit, et le dégradé coupé n'aurait aucun sens.
 */
export function fractionZero(valeurs) {
  const nombres = mesures(valeurs);
  if (!nombres.length) return null;
  const haut = Math.max(...nombres);
  const bas = Math.min(...nombres);
  if (haut <= 0 || bas >= 0) return null;
  return haut / (haut - bas);
}

/**
 * Périodes proposées, en mois. `null` = tout l'historique.
 *
 * Sans ce filtre, huit ans d'historique écrasent le dernier trimestre contre le
 * bord droit du graphique : les mouvements récents — les seuls sur lesquels on
 * puisse encore agir — deviennent illisibles.
 */
const PERIODES = [
  { key: '1m', label: '1 mois', mois: 1 },
  { key: '3m', label: '3 mois', mois: 3 },
  { key: '6m', label: '6 mois', mois: 6 },
  { key: 'ytd', label: 'Depuis janvier', mois: null, ytd: true },
  { key: '1a', label: '1 an', mois: 12 },
  { key: 'all', label: 'Tout', mois: null },
];

/** Date pivot (ISO) d'une période, ou null si aucune borne. */
function debutDe(periode, derniereDate) {
  if (!derniereDate) return null;
  const fin = new Date(`${derniereDate}T00:00:00Z`);
  if (periode.ytd) return `${fin.getUTCFullYear()}-01-01`;
  if (!periode.mois) return null;
  const d = new Date(fin);
  d.setUTCMonth(d.getUTCMonth() - periode.mois);
  return d.toISOString().slice(0, 10);
}

/**
 * Une période qui ne retient qu'un seul point ne trace aucune courbe.
 *
 * Plutôt que d'afficher un cadre vide — et de laisser croire à une panne — on
 * garde la période demandée mais on le DIT, ce qui explique aussi pourquoi
 * l'historique est court : il se construit capture après capture.
 */
function Vide({ children }) {
  return <div className="muted" style={{ padding: '28px 0', textAlign: 'center' }}>{children}</div>;
}

function SelecteurPeriode({ valeur, onChange, disponibles }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
      {disponibles.map((p) => (
        <button
          key={p.key}
          type="button"
          className={`btn ${valeur === p.key ? '' : 'ghost'}`}
          style={{ padding: '5px 12px', fontSize: 13 }}
          aria-pressed={valeur === p.key}
          onClick={() => onChange(p.key)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Graphiques d'évolution : ce que vaut le portefeuille, ce qu'il a coûté, et ce
 * qu'il a rapporté.
 *
 * @param snapshots [{ snapshot_date, total_value_eur, cash_eur }]
 * @param perf      réponse de /api/performance (capital, monthly, drawdown)
 */
export default function PerfCharts({ snapshots, perf }) {
  const [periode, setPeriode] = useState('all');

  const capital = perf?.capital || null;
  const derniereDate = capital?.series?.length
    ? capital.series[capital.series.length - 1].date
    : (snapshots?.length ? String(snapshots[snapshots.length - 1].snapshot_date).slice(0, 10) : null);

  // Une période trop courte pour l'historique disponible n'a rien à montrer :
  // on ne propose que celles qui contiennent au moins deux points.
  const disponibles = useMemo(() => {
    const dates = (capital?.series || []).map((s) => s.date);
    if (dates.length < 2) return [PERIODES[PERIODES.length - 1]];
    return PERIODES.filter((x) => {
      const d = debutDe(x, dates[dates.length - 1]);
      return dates.filter((iso) => !d || iso >= d).length >= 2;
    });
  }, [capital]);

  // Une période retenue mais plus proposée — l'historique a changé sous les
  // pieds de l'utilisateur — filtrerait les courbes sans qu'aucun bouton ne
  // paraisse actif : le graphique semblerait vide sans raison visible.
  const p = disponibles.find((x) => x.key === periode) || PERIODES[PERIODES.length - 1];
  const debut = debutDe(p, derniereDate);
  const dansPeriode = (iso) => !debut || String(iso).slice(0, 10) >= debut;
  // Au-delà d'un an affiché, les étiquettes portent l'année : sans elle, deux
  // points distants de douze mois s'écrivent à l'identique sur l'axe.
  const avecAnnee = !debut
    || (derniereDate && (new Date(derniereDate) - new Date(debut)) / 86400000 > 400);
  const dateLabel = (iso) => etiquetteDate(iso, avecAnnee);

  // ── Valeur vs capital investi ──────────────────────────────────────
  const serieCapital = useMemo(() => (capital?.series || [])
    .filter((s) => dansPeriode(s.date))
    .map((s) => ({ ...s, label: dateLabel(s.date) })), [capital, debut]);

  // ── Titres vs liquidités ───────────────────────────────────────────
  // `cash_eur` peut manquer sur les vieux imports : ces points sont écartés
  // plutôt que comptés à zéro, ce qui dessinerait une chute de trésorerie fictive.
  const serieComposition = useMemo(() => (snapshots || [])
    .filter((r) => r.cash_eur != null && dansPeriode(r.snapshot_date))
    .map((r) => {
      const total = Number(r.total_value_eur) || 0;
      const cash = Number(r.cash_eur) || 0;
      return {
        label: dateLabel(r.snapshot_date),
        titres: Math.max(0, Math.round((total - cash) * 100) / 100),
        liquidites: Math.round(cash * 100) / 100,
      };
    }), [snapshots, debut]);

  const serieDrawdown = useMemo(() => (perf?.drawdown || [])
    .filter((s) => dansPeriode(s.date))
    .map((s) => ({ label: dateLabel(s.date), dd: s.dd * 100 })), [perf, debut]);

  const serieMensuelle = useMemo(() => (perf?.monthly || [])
    .filter((m) => !debut || `${m.month}-31` >= debut)
    .map((m) => {
      const [an, mois] = m.month.split('-');
      return { label: `${mois}/${an.slice(2)}`, ret: m.ret * 100 };
    }), [perf, debut]);

  if (!capital || !capital.series?.length) return null;

  const dernier = capital.series[capital.series.length - 1];
  const partiel = capital.coverage === 'partial';
  const sansFlux = capital.coverage === 'none';
  const zeroPnl = fractionZero(serieCapital.map((s) => s.pnl));
  const pnlNegatif = serieCapital.length > 0 && serieCapital.every((s) => s.pnl < 0);
  // Échelle resserrée sur les données pour le couple valeur/capital.
  //
  // Partir de zéro écrasait les deux courbes — et surtout l'écart entre elles,
  // le seul point du graphique — dans le cinquième supérieur du cadre. Tronquer
  // un axe exagère d'ordinaire les variations ; ici le lecteur COMPARE deux
  // courbes portées par la même échelle, il n'évalue pas des hauteurs, et les
  // graduations restent chiffrées. Le graphe du bénéfice, lui, garde son zéro :
  // c'est là que le signe se lit.
  const bornes = echelle(serieCapital.flatMap((s) => [s.value, s.invested]));

  return (
    <>
      <Card title="Valeur et capital investi">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          La courbe de valeur seule ne dit pas si tu gagnes : elle monte aussi quand tu verses.
          L'aire entre les deux courbes est ton <strong>bénéfice</strong>.
        </p>
        <SelecteurPeriode valeur={periode} onChange={setPeriode} disponibles={disponibles} />

        {sansFlux ? (
          <Banner kind="info">
            Aucun versement trouvé dans ton relevé de compte : impossible de distinguer tes apports
            de tes gains. Importe ton relevé — ou lance une capture avec l'extension — pour voir ton bénéfice réel.
          </Banner>
        ) : (
          <>
            {partiel && (
              <div style={{ marginBottom: 14 }}>
                <Banner kind="warn">
                  Ton plus ancien versement connu date du <strong>{fmtDate(capital.firstFlow)}</strong>, alors que
                  ton historique d'ordres commence avant. Il manque des versements : le capital investi est
                  sous-estimé, et le bénéfice d'autant surestimé.
                </Banner>
              </div>
            )}
            {serieCapital.length >= 2 ? (
              <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer>
                  <ComposedChart data={serieCapital} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="grad-valeur" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.30} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={24} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={70} tickFormatter={compact} domain={bornes} />
                    <Tooltip
                      formatter={(v, n) => [fmtEur(v), n]}
                      contentStyle={TT}
                      labelStyle={{ color: 'var(--ink-soft)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Area
                      type="monotone" dataKey="value" name="Valeur du portefeuille"
                      stroke="var(--accent)" strokeWidth={2.2} fill="url(#grad-valeur)" isAnimationActive={false}
                    />
                    <Line
                      type="monotone" dataKey="invested" name="Capital investi"
                      stroke="var(--c2)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Vide>Deux captures suffisent à tracer cette courbe — elle se construit à chaque import.</Vide>
            )}

            <div className="card-title" style={{ margin: '18px 2px 8px' }}>Bénéfice</div>
            {serieCapital.length >= 2 ? (
              <div style={{ width: '100%', height: 190 }}>
                <ResponsiveContainer>
                  <AreaChart data={serieCapital} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      {/* Dégradés coupés SUR le zéro : au-dessus le vert du gain,
                          en dessous le rouge de la perte. Une aire d'une seule
                          couleur qui plonge sous l'axe dirait le contraire du
                          chiffre qu'elle illustre. */}
                      <linearGradient id="grad-pnl" x1="0" y1="0" x2="0" y2="1">
                        <stop offset={0} stopColor="var(--pos)" stopOpacity={0.32} />
                        <stop offset={zeroPnl ?? 1} stopColor="var(--pos)" stopOpacity={0.03} />
                        {zeroPnl != null && <stop offset={zeroPnl} stopColor="var(--neg)" stopOpacity={0.03} />}
                        {zeroPnl != null && <stop offset={1} stopColor="var(--neg)" stopOpacity={0.32} />}
                      </linearGradient>
                      <linearGradient id="trait-pnl" x1="0" y1="0" x2="0" y2="1">
                        <stop offset={0} stopColor={pnlNegatif ? 'var(--neg)' : 'var(--pos)'} />
                        <stop offset={zeroPnl ?? 1} stopColor={pnlNegatif ? 'var(--neg)' : 'var(--pos)'} />
                        {zeroPnl != null && <stop offset={zeroPnl} stopColor="var(--neg)" />}
                        {zeroPnl != null && <stop offset={1} stopColor="var(--neg)" />}
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                    <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={24} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={70} tickFormatter={compact} />
                    <Tooltip formatter={(v) => [signEur(v), 'Bénéfice']} contentStyle={TT} labelStyle={{ color: 'var(--ink-soft)' }} />
                    {/* Le zéro est le seuil qui compte : au-dessus on gagne, en dessous on perd. */}
                    <ReferenceLine y={0} stroke="var(--line)" />
                    <Area type="monotone" dataKey="pnl" stroke="url(#trait-pnl)" strokeWidth={2} fill="url(#grad-pnl)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Vide>Le bénéfice actuel est de {signEur(dernier.pnl)}. Sa courbe apparaîtra dès la deuxième capture.</Vide>
            )}
          </>
        )}
      </Card>

      {serieMensuelle.length >= 2 && (
        <div style={{ marginTop: 16 }}>
          <Card title="Rendement mois par mois">
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Performance réelle de chaque mois, apports neutralisés. Un mois sans capture n'apparaît pas.
            </p>
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={serieMensuelle} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={12} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `${v.toFixed(0)} %`} />
                  <Tooltip formatter={(v) => [`${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)} %`, 'Rendement']} contentStyle={TT} labelStyle={{ color: 'var(--ink-soft)' }} />
                  <ReferenceLine y={0} stroke="var(--line)" />
                  <Bar dataKey="ret" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                    {serieMensuelle.map((m) => (
                      <Cell key={m.label} fill={m.ret >= 0 ? 'var(--pos)' : 'var(--neg)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {serieDrawdown.length >= 3 && (
        <div style={{ marginTop: 16 }}>
          <Card title="Sous l'eau">
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Écart à ton plus haut historique, jour après jour. Un chiffre unique de « pire baisse » ne dit
              ni quand elle est arrivée, ni combien de temps il a fallu pour l'effacer.
            </p>
            <div style={{ width: '100%', height: 200 }}>
              <ResponsiveContainer>
                <AreaChart data={serieDrawdown} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad-dd" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--neg)" stopOpacity={0.05} />
                      <stop offset="100%" stopColor="var(--neg)" stopOpacity={0.30} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={24} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => `${v.toFixed(0)} %`} />
                  <Tooltip formatter={(v) => [`${Number(v).toFixed(2)} %`, 'Sous le sommet']} contentStyle={TT} labelStyle={{ color: 'var(--ink-soft)' }} />
                  <Area type="monotone" dataKey="dd" stroke="var(--neg)" strokeWidth={1.8} fill="url(#grad-dd)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}

      {serieComposition.length >= 2 && (
        <div style={{ marginTop: 16 }}>
          <Card title="Titres et liquidités">
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Ce que tu détiens en titres, et ce qui dort en cash — fonds de trésorerie compris.
            </p>
            <div style={{ width: '100%', height: 230 }}>
              <ResponsiveContainer>
                <AreaChart data={serieComposition} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke="var(--line-soft)" vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={24} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={70} tickFormatter={compact} />
                  <Tooltip formatter={(v, n) => [fmtEur(v), n]} contentStyle={TT} labelStyle={{ color: 'var(--ink-soft)' }} />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Area type="monotone" dataKey="titres" name="Titres" stackId="1" stroke="var(--c1)" fill="var(--c1)" fillOpacity={0.42} isAnimationActive={false} />
                  <Area type="monotone" dataKey="liquidites" name="Liquidités" stackId="1" stroke="var(--c3)" fill="var(--c3)" fillOpacity={0.42} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

export { PERIODES, debutDe };
