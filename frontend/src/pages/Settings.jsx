import { useEffect, useState } from 'react';
import {
  uploadCsv, enrichNow, getEtfHoldings, uploadEtfHoldings,
  updatePseudo, deleteMyData, deleteAccount,
} from '../lib/api.js';
import { Card, Banner } from '../components/ui.jsx';
import IsinEditor from '../components/IsinEditor.jsx';

const KIND_LABEL = { portfolio: 'Portefeuille', account: 'Relevé de compte', transactions: 'Transactions' };

function Uploader({ hint, title, description, onImported }) {
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
    } catch (e) {
      setError(e.body?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="uploader">
      <div className={`drop ${file ? 'armed' : ''}`}>
        <div className="meta">
          <span className="k">{title}</span>
          <span className="d">{file ? file.name : description}</span>
        </div>
        <label className="btn ghost">
          {file ? 'Changer' : 'Choisir un CSV'}
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => choose(e.target.files[0])} />
        </label>
      </div>

      {busy && <div className="muted">Traitement…</div>}
      {error && <Banner kind="err">{error}</Banner>}

      {preview && (
        <div className="card card-pad" style={{ background: 'var(--card-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              Détecté : <strong>{KIND_LABEL[preview.kind] || preview.kind}</strong> · {preview.count} ligne(s)
              <span className="muted"> · délimiteur « {preview.delimiter === '\t' ? 'tab' : preview.delimiter} »</span>
            </div>
            <button className="btn" onClick={confirm} disabled={busy}>Confirmer l'import</button>
          </div>
        </div>
      )}

      {result && (
        <Banner kind="info">
          {result.kind === 'portfolio'
            ? `Portefeuille importé : ${result.positions} position(s)${result.replaced ? ', snapshot du jour remplacé' : ''}${result.deduplicated ? ' (déjà importé)' : ''}.`
            : `${KIND_LABEL[result.kind] || result.kind} : ${result.inserted} nouveau(x) mouvement(s) sur ${result.received}.`}
        </Banner>
      )}
    </div>
  );
}

function EtfHoldingsUploader({ onImported }) {
  const [etfs, setEtfs] = useState(null);
  const [selected, setSelected] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  async function reload() {
    try {
      const res = await getEtfHoldings();
      setEtfs(res.etfs || []);
      setSelected((cur) => cur || (res.etfs?.[0]?.isin ?? ''));
    } catch (e) {
      setError(e.status === 404 ? null : (e.body?.error || e.message));
      setEtfs([]);
    }
  }

  useEffect(() => { reload(); }, []);

  async function confirm() {
    if (!selected || !file) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await uploadEtfHoldings(file, selected, 'commit');
      setResult(res);
      setFile(null);
      await reload();
      onImported?.();
    } catch (e) {
      setError(e.body?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Compositions d'ETF (look-through)">
      <p className="muted" style={{ marginTop: 0 }}>
        Téléchargez le fichier « Holdings » d'un ETF (page de l'émetteur : iShares, Amundi, Vanguard…) puis importez-le ici.
        Chaque ETF sera éclaté en ses titres dans <strong>Exposition → Vraie exposition</strong>, révélant vos surexpositions.
      </p>

      {etfs && etfs.length === 0 && (
        <Banner kind="info">Aucun ETF détecté dans votre portefeuille. Importez d'abord vos positions.</Banner>
      )}

      {etfs && etfs.length > 0 && (
        <div className="grid" style={{ gap: 14 }}>
          <div className="field" style={{ maxWidth: 520 }}>
            <label>ETF à composer</label>
            <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {etfs.map((e) => (
                <option key={e.isin} value={e.isin}>
                  {e.covered ? '✓ ' : '• '}{e.name || e.isin} ({e.isin}){e.covered ? ` — ${e.count} titres` : ' — à importer'}
                </option>
              ))}
            </select>
          </div>

          <div className={`drop ${file ? 'armed' : ''}`}>
            <div className="meta">
              <span className="k">Fichier de composition</span>
              <span className="d">{file ? file.name : 'Holdings.csv de l\'émetteur (nom, ISIN, poids %)'}</span>
            </div>
            <label className="btn ghost">
              {file ? 'Changer' : 'Choisir un CSV'}
              <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { setFile(e.target.files[0]); setResult(null); setError(null); }} />
            </label>
          </div>

          <div>
            <button className="btn" onClick={confirm} disabled={busy || !file || !selected}>
              {busy ? 'Import…' : 'Importer la composition'}
            </button>
          </div>
        </div>
      )}

      {error && <div style={{ marginTop: 12 }}><Banner kind="err">{error}</Banner></div>}
      {result && (
        <div style={{ marginTop: 12 }}>
          <Banner kind="info">Composition importée : {result.saved} titre(s) enregistré(s) pour {result.etf_isin}.</Banner>
        </div>
      )}
    </Card>
  );
}

function AccountCard({ user, onUserChange, onLogout }) {
  const [pseudo, setPseudo] = useState(user?.pseudo || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [confirmData, setConfirmData] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function savePseudo() {
    if (!pseudo.trim() || pseudo.trim() === user?.pseudo) return;
    setBusy(true); setMsg(null);
    try {
      const res = await updatePseudo(pseudo.trim());
      onUserChange?.(res.user);
      setMsg({ kind: 'info', text: 'Pseudo mis à jour.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e.body?.error || e.message });
    } finally { setBusy(false); }
  }

  async function wipeData() {
    setBusy(true); setMsg(null);
    try {
      await deleteMyData();
      setConfirmData(false);
      setMsg({ kind: 'info', text: 'Toutes tes données de portefeuille ont été effacées.' });
    } catch (e) {
      setMsg({ kind: 'err', text: e.body?.error || e.message });
    } finally { setBusy(false); }
  }

  async function removeAccount() {
    setBusy(true);
    try {
      await deleteAccount();
      onLogout?.();
    } catch (e) {
      setMsg({ kind: 'err', text: e.body?.error || e.message });
      setBusy(false);
    }
  }

  return (
    <Card title="Mon compte">
      <p className="muted" style={{ marginTop: 0 }}>
        Connecté en tant que <strong>{user?.email}</strong>.
      </p>
      <div className="field" style={{ maxWidth: 480 }}>
        <label>Pseudo</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" value={pseudo} maxLength={60} onChange={(e) => setPseudo(e.target.value)} placeholder="Ton pseudo" />
          <button className="btn" disabled={busy || !pseudo.trim() || pseudo.trim() === user?.pseudo} onClick={savePseudo}>Enregistrer</button>
        </div>
      </div>

      {msg && <div style={{ marginTop: 12 }}><Banner kind={msg.kind}>{msg.text}</Banner></div>}

      <div style={{ marginTop: 18, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={onLogout}>Se déconnecter</button>
        {!confirmData
          ? <button className="btn ghost" onClick={() => setConfirmData(true)}>Effacer mes données</button>
          : <button className="btn danger" disabled={busy} onClick={wipeData}>Confirmer l'effacement des données</button>}
        {!confirmDelete
          ? <button className="link-btn danger-text" onClick={() => setConfirmDelete(true)}>Supprimer mon compte</button>
          : <button className="btn danger" disabled={busy} onClick={removeAccount}>Confirmer la suppression du compte</button>}
      </div>
      {(confirmData || confirmDelete) && (
        <div className="sub muted" style={{ marginTop: 10, fontSize: 12.5 }}>
          {confirmDelete
            ? 'La suppression du compte est définitive : données, sessions et pseudo seront effacés.'
            : 'L’effacement retire tes snapshots, positions et mouvements — le compte est conservé.'}
        </div>
      )}
    </Card>
  );
}

export default function Settings({ onImported, user, onUserChange, onLogout }) {
  const [enrichMsg, setEnrichMsg] = useState(null);
  const [theme, setThemeState] = useState(localStorage.getItem('degiro_theme') || 'light');

  function applyTheme(t) {
    setThemeState(t);
    localStorage.setItem('degiro_theme', t);
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  async function runEnrich() {
    setEnrichMsg({ kind: 'info', text: 'Enrichissement en cours…' });
    try {
      const res = await enrichNow();
      setEnrichMsg({ kind: 'info', text: `Enrichissement terminé : ${res.enriched ?? 0} ISIN traité(s), ${res.failed ?? 0} échec(s).` });
      onImported?.();
    } catch (e) {
      setEnrichMsg({ kind: 'err', text: e.status === 404 ? "Endpoint d'enrichissement pas encore disponible." : (e.body?.error || e.message) });
    }
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 880 }}>
      <Card title="Importer un export DEGIRO">
        <p className="muted" style={{ marginTop: 0 }}>
          Exportez vos fichiers depuis DEGIRO puis déposez-les ici. Le type est détecté automatiquement ; une prévisualisation
          s'affiche avant l'import définitif.
        </p>
        <div className="grid" style={{ gap: 22 }}>
          <Uploader hint="auto" title="Portefeuille (positions)" description="Portfolio.csv — vos lignes actuelles" onImported={onImported} />
          <Uploader hint="auto" title="Relevé de compte" description="Account.csv — dépôts, dividendes, frais" onImported={onImported} />
          <Uploader hint="auto" title="Transactions" description="Transactions.csv — vos ordres exécutés" onImported={onImported} />
        </div>
      </Card>

      <EtfHoldingsUploader onImported={onImported} />

      <Card title="Enrichissement ISIN">
        <p className="muted" style={{ marginTop: 0 }}>
          Complète secteur, pays et ticker de chaque position via des sources externes. Résultats mis en cache et corrigeables à la main.
        </p>
        <button className="btn" onClick={runEnrich}>Lancer l'enrichissement</button>
        {enrichMsg && <div style={{ marginTop: 12 }}><Banner kind={enrichMsg.kind}>{enrichMsg.text}</Banner></div>}
        <div style={{ marginTop: 18 }}>
          <div className="card-title">Références ISIN (correction manuelle)</div>
          <IsinEditor reloadKey={enrichMsg?.text} />
        </div>
      </Card>

      <AccountCard user={user} onUserChange={onUserChange} onLogout={onLogout} />

      <Card title="Apparence">
        <div style={{ display: 'flex', gap: 8 }}>
          {['auto', 'light', 'dark'].map((t) => (
            <button key={t} className={`btn ${theme === t ? '' : 'ghost'}`} onClick={() => applyTheme(t)}>
              {t === 'auto' ? 'Système' : t === 'light' ? 'Clair' : 'Sombre'}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
