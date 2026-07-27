import { useId, useState } from 'react';
import { uploadCsv } from '../lib/api.js';
import { Banner } from './ui.jsx';
import { fmtDate, fmtEur, fmtNum, fmtMoney, plural } from '../lib/format.js';

const KIND_LABEL = { portfolio: 'Portefeuille', account: 'Relevé de compte', transactions: 'Transactions' };

/** Nombre de lignes montrées : assez pour juger d'un décalage, assez peu pour tenir sur un mobile. */
const SAMPLE_ROWS = 4;

/** Libellés longs : tronqués pour ne pas étirer le tableau, valeur entière au survol. */
const short = (s, n = 24) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * Quantité : entière dans l'immense majorité des cas, mais une fraction n'est
 * pas arrondie — un « 120,50 » tombé dans la colonne quantité est exactement
 * le décalage que cet aperçu doit rendre visible, pas masquer en « 121 ».
 */
const fmtQty = (n) => (Number.isInteger(Number(n)) ? fmtNum(n, 0) : fmtNum(n, 2));

const dash = <span className="muted">—</span>;
const text = (s) => (String(s ?? '').trim() ? <span title={String(s)}>{short(s)}</span> : dash);

/**
 * Colonnes de l'aperçu, par type de fichier.
 *
 * Les champs normalisés diffèrent d'un type à l'autre : on montre ceux qui
 * trahissent un décalage de colonnes (une quantité dans le cours, un montant
 * dans la devise), pas l'intégralité de l'objet.
 */
const SAMPLE_COLS = {
  portfolio: [
    { label: 'Nom', left: true, cell: (r) => text(r.name) },
    { label: 'ISIN', left: true, cell: (r) => <span className="muted">{r.isin || '—'}</span> },
    { label: 'Qté', cell: (r) => fmtQty(r.qty) },
    { label: 'Cours', cell: (r) => <>{fmtNum(r.price)} <span className="muted sm">{r.currency || ''}</span></> },
    { label: 'Valeur', cell: (r) => fmtEur(r.value_eur) },
  ],
  transactions: [
    { label: 'Date', left: true, cell: (r) => fmtDate(r.tx_date) },
    { label: 'ISIN', left: true, cell: (r) => <span className="muted">{r.isin || '—'}</span> },
    { label: 'Libellé', left: true, cell: (r) => text(r.description) },
    { label: 'Qté', cell: (r) => fmtQty(r.qty) },
    { label: 'Montant', cell: (r) => fmtEur(r.amount_eur) },
  ],
  account: [
    { label: 'Date', left: true, cell: (r) => fmtDate(r.tx_date) },
    { label: 'Description', left: true, cell: (r) => text(r.description) },
    { label: 'Montant', cell: (r) => fmtMoney(r.amount, r.currency) },
    { label: 'Devise', cell: (r) => <span className="muted">{r.currency || '—'}</span> },
  ],
};

/**
 * Aperçu des premières lignes telles que le serveur les a interprétées.
 *
 * L'application demande de ne pas confirmer « si les colonnes semblent
 * décalées » — mais rien n'était affiché pour en juger : l'utilisateur validait
 * à l'aveugle alors que la réponse de prévisualisation contenait déjà de quoi
 * décider. On montre le résultat du mapping, et non le CSV brut : c'est bien
 * l'interprétation du serveur qu'il s'agit de valider.
 */
function SamplePreview({ kind, sample }) {
  const cols = SAMPLE_COLS[kind];
  const rows = (sample || []).slice(0, SAMPLE_ROWS);
  if (!cols || !rows.length) return null;
  return (
    <>
      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="data compact">
          <thead>
            <tr>{cols.map((c) => <th key={c.label} style={c.left ? { textAlign: 'left' } : undefined}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.external_id || `${r.isin || ''}-${i}`}>
                {cols.map((c) => (
                  <td key={c.label} style={c.left ? { textAlign: 'left' } : undefined}>{c.cell(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted sm" style={{ marginTop: 8 }}>
        Aperçu des premières lignes telles qu'elles ont été lues. Si les valeurs semblent
        décalées d'une colonne, ne confirme pas.
      </div>
    </>
  );
}

/**
 * Dépôt d'un export DEGIRO : prévisualisation puis import.
 * Partagé entre Réglages et l'onboarding.
 * @param onImported  rafraîchit les pages après un commit réussi
 * @param onDone      callback(result) après un commit réussi (ex. aller à la Vue d'ensemble)
 */
export default function Uploader({ hint, title, description, onImported, onDone }) {
  // Trois uploaders coexistent sur la page Réglages : un id en dur ferait
  // pointer les trois labels sur le premier input.
  const inputId = useId();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function choose(f) {
    setFile(f); setPreview(null); setResult(null); setError(null);
    if (!f) return;
    setBusy(true);
    try {
      const res = await uploadCsv(f, hint, 'preview');
      setPreview(res);
    } catch (e) {
      setError(e.body?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true); setError(null);
    try {
      const res = await uploadCsv(file, preview.kind, 'commit');
      setResult(res);
      setPreview(null);
      onImported?.();
      onDone?.(res);
    } catch (e) {
      setError(e.body?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    // minWidth:0 (ici et sur la carte d'aperçu) : sans lui, ces blocs de grille
    // refusent de passer sous la largeur du tableau et font déborder la page
    // entière sur mobile, au lieu de laisser .table-wrap défiler seul.
    <div className="uploader" style={{ minWidth: 0 }}>
      <div className={`drop ${file ? 'armed' : ''}`}>
        <div className="meta">
          <span className="k">{title}</span>
          <span className="d">{file ? file.name : description}</span>
        </div>
        {/* `hidden` posait display:none : l'input sortait de l'ordre de
            tabulation et un <label> n'est jamais focalisable — l'import était
            impossible sans souris. `.sr-only` masque sans dé-focaliser, et
            htmlFor/id rétablit la sémantique native (« Choisir un CSV,
            bouton » à la synthèse vocale, Espace ouvre le sélecteur). */}
        <label className="btn ghost" htmlFor={inputId}>
          {file ? 'Changer' : 'Choisir un CSV'}
          {/* Filtre large à dessein : sur mobile (iOS surtout) un accept trop
              strict grise le CSV dans le sélecteur, et un CSV téléchargé arrive
              souvent en octet-stream. Le serveur détecte le vrai type de toute
              façon, donc on privilégie la sélectionnabilité. */}
          <input
            id={inputId}
            className="sr-only"
            type="file"
            accept=".csv,text/csv,text/comma-separated-values,text/plain,application/csv,application/octet-stream"
            onChange={(e) => choose(e.target.files[0])}
          />
        </label>
      </div>

      {busy && <div className="muted">Traitement…</div>}
      {error && <Banner kind="err">{error}</Banner>}

      {preview && (
        <div className="card card-pad" style={{ background: 'var(--card-2)', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              Détecté : <strong>{KIND_LABEL[preview.kind] || preview.kind}</strong> · {plural(preview.count, 'ligne')}
              <span className="muted"> · délimiteur « {preview.delimiter === '\t' ? 'tab' : preview.delimiter} »</span>
            </div>
            <button className="btn" onClick={confirm} disabled={busy}>Confirmer l'import</button>
          </div>
          <SamplePreview kind={preview.kind} sample={preview.sample} />
        </div>
      )}

      {result && result.deduplicated && (
        <Banner kind="warn">
          Ce fichier avait <strong>déjà été importé</strong> — aucune nouvelle donnée. Pour mettre à jour,
          exporte un fichier plus récent depuis DEGIRO.
        </Banner>
      )}
      {result && !result.deduplicated && (
        <Banner kind="info">
          {result.kind === 'portfolio'
            ? `Portefeuille importé : ${plural(result.positions, 'position')}${result.replaced ? ', snapshot du jour remplacé' : ''}.`
            : `${KIND_LABEL[result.kind] || result.kind} : ${plural(result.inserted, 'nouveau mouvement', 'nouveaux mouvements')} sur ${result.received}.`}
        </Banner>
      )}
    </div>
  );
}