import { useMemo, useState } from 'react';
import { Card, Stat, Banner } from './ui.jsx';
import { fmtEur, fmtDate, fmtNum, plural } from '../lib/format.js';
import {
  filterByPeriod, periodSummary, byYear, monthsIn, totalReturn,
} from '../lib/realized.js';

const signEur = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${fmtEur(v)}`);
const tone = (v) => (v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');
const MONTHS = ['', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const monthLabel = (m) => `${MONTHS[Number(m.slice(5, 7))]} ${m.slice(0, 4)}`;

/**
 * Vue « Gains, pertes & fiscalité » : plus-values réalisées sur positions
 * fermées + dividendes, filtrables par année/mois, en chiffres bruts.
 * `latentPl` (P/L latent des positions ouvertes) alimente le retour total.
 */
export default function RealizedPanel({ realized, latentPl = null }) {
  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(null);

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
    () => [...evFiltered].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    [evFiltered],
  );

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
          <Stat label="Dividendes encaissés" value={fmtEur(ret.dividends)} sub="nets de retenue" tone={ret.dividends ? 'pos' : ''} />
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

            {/* KPIs de la période sélectionnée */}
            <div className="grid stat-row" style={{ marginTop: 14 }}>
              <Stat label="Plus-values" value={signEur(summary.gains)} sub={`${periodLabel}`} tone={summary.gains ? 'pos' : ''} />
              <Stat label="Moins-values" value={signEur(summary.losses)} sub="pertes réalisées" tone={summary.losses ? 'neg' : ''} />
              <Stat label="Net réalisé" value={signEur(summary.net)} sub={plural(summary.sales, 'vente')} tone={tone(summary.net)} />
              <Stat label="Dividendes" value={fmtEur(summary.dividends)} sub="sur la période" tone={summary.dividends ? 'pos' : ''} />
            </div>

            {/* Récap par année (chiffres bruts) */}
            {yearRows.length > 1 && (
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table className="data compact">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Année</th>
                      <th>Ventes</th>
                      <th>Plus-values</th>
                      <th>Moins-values</th>
                      <th>Net réalisé</th>
                      <th>Dividendes</th>
                      <th>Total</th>
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
                        <td className={r.gains ? 'pos' : 'muted'}>{r.gains ? signEur(r.gains) : '—'}</td>
                        <td className={r.losses ? 'neg' : 'muted'}>{r.losses ? signEur(r.losses) : '—'}</td>
                        <td className={tone(r.net)}>{signEur(r.net)}</td>
                        <td className={r.dividends ? 'pos' : 'muted'}>{r.dividends ? fmtEur(r.dividends) : '—'}</td>
                        <td className={tone(r.total)} style={{ fontWeight: 650 }}>{signEur(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Détail des ventes de la période */}
            {salesRows.length > 0 ? (
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table className="data compact">
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Date</th>
                      <th style={{ textAlign: 'left' }}>Titre</th>
                      <th>Qté</th>
                      <th>Produit</th>
                      <th>Coût de revient</th>
                      <th>+/- value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesRows.map((e, i) => (
                      <tr key={`${e.isin}-${e.date}-${i}`}>
                        <td style={{ textAlign: 'left' }}>{fmtDate(e.date)}</td>
                        <td style={{ textAlign: 'left' }}>
                          <span className="sym">{e.name}</span>
                          {e.costUnknown && <span className="muted sm" title="Coût d'achat inconnu (achat antérieur à ton historique importé)"> · coût ?</span>}
                        </td>
                        <td>{fmtNum(e.qty, e.qty % 1 ? 4 : 0)}</td>
                        <td className="sym">{e.proceeds_eur == null ? '—' : fmtEur(e.proceeds_eur)}</td>
                        <td className="sym">{e.cost_eur == null ? <span className="muted">?</span> : fmtEur(e.cost_eur)}</td>
                        <td className={tone(e.gain_eur)}>{e.gain_eur == null ? <span className="muted">—</span> : signEur(e.gain_eur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ marginTop: 16 }}>Aucune vente sur cette période.</p>
            )}

            {summary.unknown > 0 && (
              <div style={{ marginTop: 12 }}>
                <Banner kind="info">
                  {plural(summary.unknown, 'vente')} sans coût d'achat connu (titre acheté avant la période couverte par ton
                  <strong> Transactions.csv</strong>) : leur plus-value n'est pas calculée. Importe un historique plus
                  ancien pour les compléter.
                </Banner>
              </div>
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
