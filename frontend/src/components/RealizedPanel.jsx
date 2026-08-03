import { useMemo, useState } from 'react';
import {
  Card, Stat, Banner, SearchInput, Pager,
} from './ui.jsx';
import { fmtEur, fmtDate, fmtNum, plural } from '../lib/format.js';
import { usePagination } from '../lib/usePagination.js';
import {
  filterByPeriod, periodSummary, byYear, monthsIn, totalReturn, explainUnknown,
} from '../lib/realized.js';

const signEur = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmtEur(v)}`);
const tone = (v) => (v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const MONTHS = ['', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7))]} ${m.slice(0, 4)}`;

/**
 * Filtres du détail des ventes, au-delà de la période.
 *
 * Filtrer par année ne suffit pas sur un historique de plusieurs centaines de
 * cessions : on cherche un titre précis, ou l'on veut isoler ses moins-values
 * avant une déclaration. « Non calculées » sort les ventes dont le prix de
 * revient manque — celles qu'il faut aller corriger, et qu'un tri ne rassemble
 * pas puisqu'elles s'affichent en tirets un peu partout.
 */
export const RESULTATS = [
  { key: 'tous', label: 'Toutes les ventes' },
  { key: 'gains', label: 'Plus-values', test: (e) => e.gain_eur > 0 },
  { key: 'pertes', label: 'Moins-values', test: (e) => e.gain_eur < 0 },
  { key: 'inconnues', label: 'Non calculées', test: (e) => e.gain_eur == null },
];

export function filtrerVentes(events, { texte = '', resultat = 'tous' } = {}) {
  const q = texte.trim().toLowerCase();
  const regle = RESULTATS.find((r) => r.key === resultat)?.test;
  return (events || []).filter((e) => {
    if (regle && !regle(e)) return false;
    if (!q) return true;
    return `${e.name || ''} ${e.isin || ''}`.toLowerCase().includes(q);
  });
}

/**
 * Vue « Gains, pertes & fiscalité » : plus-values réalisées sur positions
 * fermées + dividendes, filtrables par année/mois, en chiffres bruts.
 * `latentPl` (P/L latent des positions ouvertes) alimente le retour total.
 */
export default function RealizedPanel({ realized, latentPl = null }) {
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(null);
  const [texte, setTexte] = useState('');
  const [resultat, setResultat] = useState('tous');

  const events = realized?.events || [];
  const dividends = realized?.dividends || [];

  const yearRows = useMemo(() => byYear(events, dividends), [events, dividends]);
  const months = useMemo(() => (year ? monthsIn([...events, ...dividends], year) : []), [events, dividends, year]);

  const period = useMemo(() => ({ year, month }), [year, month]);
  const evFiltered = useMemo(() => filterByPeriod(events, period), [events, period]);
  const divFiltered = useMemo(() => filterByPeriod(dividends, period), [dividends, period]);
  const summary = useMemo(() => periodSummary(evFiltered, divFiltered), [evFiltered, divFiltered]);

  const allNet = realized?.totals?.net ?? 0;
  const allDivs = realized?.dividendsTotal ?? 0;
  const ret = useMemo(() => totalReturn({ latentPl, realizedNet: allNet, dividends: allDivs }), [latentPl, allNet, allDivs]);

  const salesRows = useMemo(
    () => filtrerVentes(evFiltered, { texte, resultat })
      .sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [evFiltered, texte, resultat],
  );
  const pg = usePagination(salesRows, { taille: 25, cle: `${year}|${month}|${texte}|${resultat}` });

  const nothing = events.length === 0 && dividends.length === 0;

  function pickYear(y) {
    setYear(y);
    setMonth(null);
  }

  const periodLabel = month ? monthLabel(month) : year ? `année ${year}` : 'depuis le début';

  return (
    <>
      {/* ── Retour total (latent + réalisé + dividendes) ── */}
      <Card title="Bilan complet — ce que le portefeuille t'a rapporté">
        <div className="grid stat-row">
          <Stat
            label="+/- value latente"
            value={ret.latent == null ? '—' : signEur(ret.latent)}
            sub="positions encore ouvertes"
            tone={tone(ret.latent)}
          />
          <Stat
            label="+/- value réalisée"
            value={signEur(ret.realized)}
            sub="positions fermées (vendues)"
            tone={tone(ret.realized)}
          />
          {/* Les dividendes en devise (USD…) n'ont pas de contre-valeur euro dans
              le relevé : ils ne peuvent pas entrer dans ce total. Le dire évite
              de faire passer un chiffre partiel pour un encaissé complet. */}
          <Stat
            label="Dividendes encaissés"
            value={fmtEur(ret.dividends)}
            sub={realized?.dividendsForeign > 0
              ? `en euros seuls — ${plural(realized.dividendsForeign, 'versement')} en devise, détail en bas de page`
              : 'détail en bas de page'}
            tone={ret.dividends ? 'pos' : ''}
          />
          <Stat
            label={ret.partial ? 'Total (hors latent)' : 'Gain total'}
            value={signEur(ret.total)}
            sub={ret.partial ? 'importe tes positions pour le latent' : 'latent + réalisé + dividendes'}
            tone={tone(ret.total)}
          />
        </div>
        {nothing && (
          <div style={{ marginTop: 12 }}>
            <Banner kind="info">
              Aucune vente ni dividende détecté pour l'instant. Importe ton <strong>Transactions.csv</strong> et
              ton <strong>Account.csv</strong> (Relevé de compte) pour voir tes plus-values réalisées et tes dividendes.
            </Banner>
          </div>
        )}
      </Card>

      {!nothing && (
        <div style={{ marginTop: 16 }}>
          <Card title="Gains, pertes & fiscalité (positions fermées)">
            {/* Filtres année / mois */}
            <div className="real-filters">
              <div className="chip-row">
                <button className={`chip filter ${year == null ? 'on' : ''}`} onClick={() => pickYear(null)}>Toutes les années</button>
                {(realized?.years || []).slice().reverse().map((y) => (
                  <button key={y} className={`chip filter ${year === y ? 'on' : ''}`} onClick={() => pickYear(y)}>{y}</button>
                ))}
              </div>
              {year && months.length > 1 && (
                <div className="chip-row" style={{ marginTop: 8 }}>
                  <button className={`chip filter sm ${month == null ? 'on' : ''}`} onClick={() => setMonth(null)}>Toute l'année</button>
                  {months.map((m) => (
                    <button key={m} className={`chip filter sm ${month === m ? 'on' : ''}`} onClick={() => setMonth(m)}>{monthLabel(m)}</button>
                  ))}
                </div>
              )}
            </div>

            {/* KPIs de la période sélectionnée.
                Les dividendes ne figurent plus ici : cette vue traite des
                plus-values de cession, et leur détail vit dans l'onglet
                Dividendes. Le quatrième cadran sert désormais à dire combien de
                ventes ont pu être calculées — l'information qui manquait quand
                le tableau n'affichait que des tirets. */}
            <div className="grid stat-row" style={{ marginTop: 14 }}>
              <Stat label="Plus-values" value={signEur(summary.gains)} sub={`${periodLabel}`} tone={summary.gains ? 'pos' : ''} />
              <Stat label="Moins-values" value={signEur(summary.losses)} sub="pertes réalisées" tone={summary.losses ? 'neg' : ''} />
              <Stat label="Net réalisé" value={signEur(summary.net)} sub={plural(summary.sales, 'vente')} tone={tone(summary.net)} />
              <Stat
                label="Ventes calculées"
                value={`${summary.computed} / ${summary.sales}`}
                sub={summary.unknown ? `${summary.unknown} sans prix de revient` : 'prix de revient connu'}
                tone={summary.unknown ? 'warn' : 'pos'}
              />
            </div>

            {/* Récap par année (chiffres bruts) */}
            {yearRows.length > 1 && (
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table className="data compact">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Année</th>
                      <th>Ventes</th>
                      <th className="col-opt">Calculées</th>
                      <th className="col-opt">Plus-values</th>
                      <th className="col-opt">Moins-values</th>
                      <th>Net réalisé</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearRows.map((r) => (
                      <tr
                        key={r.year}
                        className={year === r.year ? 'row-on' : 'row-click'}
                        onClick={() => pickYear(year === r.year ? null : r.year)}
                      >
                        <td style={{ textAlign: 'left', fontWeight: 650 }}>{r.year}</td>
                        <td>{r.sales}</td>
                        {/* Sans cette colonne, une année entière à « — » ne
                            distinguait pas un calcul impossible d'un gain nul. */}
                        <td className={`col-opt ${r.unknown ? 'warn' : 'muted'}`}>
                          {r.computed} / {r.sales}
                        </td>
                        <td className={`col-opt ${r.gains ? 'pos' : 'muted'}`}>{r.gains ? signEur(r.gains) : '—'}</td>
                        <td className={`col-opt ${r.losses ? 'neg' : 'muted'}`}>{r.losses ? signEur(r.losses) : '—'}</td>
                        <td className={tone(r.net)} style={{ fontWeight: 650 }}>
                          {r.computed === 0 ? <span className="muted">—</span> : signEur(r.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Détail des ventes.
                Paginé : rendu d'un bloc, l'historique complet des cessions
                faisait plusieurs milliers de pixels et enterrait tout ce qui le
                suivait sous des écrans de défilement. */}
            <div className="filter-bar" style={{ marginTop: 18 }}>
              <SearchInput value={texte} onChange={setTexte} placeholder="Rechercher un titre vendu…" />
              <div className="segmented" role="group" aria-label="Résultat de la vente">
                {RESULTATS.map((r) => (
                  <button key={r.key} type="button" className={`seg ${resultat === r.key ? 'on' : ''}`}
                    aria-pressed={resultat === r.key} onClick={() => setResultat(r.key)}>{r.label}</button>
                ))}
              </div>
            </div>

            {salesRows.length > 0 ? (
              <>
                <div className="table-wrap">
                  <table className="data compact">
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Date</th>
                        <th style={{ textAlign: 'left' }}>Titre</th>
                        <th className="col-opt">Qté</th>
                        <th className="col-opt">Produit</th>
                        <th className="col-opt">Coût de revient</th>
                        <th>+/- value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pg.lignes.map((e, i) => (
                        <tr key={`${e.isin}-${e.date}-${pg.debut + i}`}>
                          <td style={{ textAlign: 'left' }}>{fmtDate(e.date)}</td>
                          <td className="col-titre" style={{ textAlign: 'left' }}>
                            <span className="sym">{e.name}</span>
                            {e.costUnknown && <span className="muted sm" title="Coût d'achat inconnu (achat antérieur à ton historique importé)"> · coût ?</span>}
                          </td>
                          <td className="col-opt">{fmtNum(e.qty, e.qty % 1 ? 4 : 0)}</td>
                          <td className="sym col-opt">{e.proceeds_eur == null ? '—' : fmtEur(e.proceeds_eur)}</td>
                          <td className="sym col-opt">{e.cost_eur == null ? <span className="muted">?</span> : fmtEur(e.cost_eur)}</td>
                          <td className={tone(e.gain_eur)}>{e.gain_eur == null ? <span className="muted">—</span> : signEur(e.gain_eur)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager
                  page={pg.page} pages={pg.pages} total={pg.total} debut={pg.debut} taille={pg.taille}
                  onPage={pg.setPage} onTaille={pg.setTaille} libelle="vente"
                />
              </>
            ) : (
              <p className="muted" style={{ marginTop: 16 }}>
                {texte || resultat !== 'tous'
                  ? 'Aucune vente ne correspond à ces filtres.'
                  : 'Aucune vente sur cette période.'}
              </p>
            )}

            {/* Explication motif par motif. L'ancien message imputait toujours la
                cause à un historique trop court — faux dès que le fichier importé
                ne portait pas de montants en euros, et sans remède utile. */}
            {summary.unknown > 0 && (
              <div style={{ marginTop: 12 }}>
                <Banner kind="warn">
                  <strong>{plural(summary.unknown, 'vente')} sans plus-value calculable</strong>
                  {` sur ${plural(summary.sales, 'vente')} — ${periodLabel}.`}
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                    {(explainUnknown(summary.unknownBy) || []).map((d) => (
                      <li key={d.motif} style={{ marginBottom: 4 }}>
                        {d.texte}
                        {d.remede && <span className="muted"> — {d.remede}</span>}
                      </li>
                    ))}
                  </ul>
                </Banner>
              </div>
            )}

            {/* État des données sources : quand le tableau n'affiche que des
                tirets, cette ligne dit si le problème vient des données — et
                le journal serveur porte les mêmes comptes. */}
            {realized?.sources && (
              <p className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>
                Données sources&nbsp;: {plural(realized.sources.orders, 'ordre')} en base
                ({realized.sources.buys} achats, {realized.sources.sells} ventes),
                période {fmtDate(realized.sources.oldest)} → {fmtDate(realized.sources.newest)}.
                {realized.sources.noEur > 0 && (
                  <span className="warn"> {plural(realized.sources.noEur, 'ordre')} sans montant en euros — réimporte ton Transactions.csv pour les compléter.</span>
                )}
                {realized.sources.suspectDuplicates > 0 && (
                  <span className="warn"> {plural(realized.sources.suspectDuplicates, 'doublon présumé', 'doublons présumés')} (même titre, même jour, même quantité sous deux identifiants).</span>
                )}
                {realized.sources.noEur === 0 && realized.sources.suspectDuplicates === 0 && (
                  <span> Aucun montant manquant, aucun doublon détecté.</span>
                )}
              </p>
            )}

            <div className="fiscal-note">
              <strong>Vue fiscale — chiffres bruts.</strong> Plus-values calculées au prix moyen pondéré (la méthode du
              fisc français), frais inclus, sans appliquer aucun taux d'imposition. Donné à titre indicatif : ton
              justificatif officiel reste l'<em>IFU</em> de DEGIRO.
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
