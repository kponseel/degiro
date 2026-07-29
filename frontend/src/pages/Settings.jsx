import { useState } from 'react';
import { updatePseudo, deleteMyData, deleteAccount } from '../lib/api.js';
import { Card, Banner } from '../components/ui.jsx';

/**
 * Réglages : uniquement les paramètres de l'utilisateur — compte (pseudo,
 * déconnexion, effacement) et apparence. Tout ce qui fait entrer des données
 * (extension, imports CSV, ETF, enrichissement) vit sur la page
 * « Import / Extension » : une intention, un endroit du menu.
 */

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

export default function Settings({ user, onUserChange, onLogout, theme, onThemeChange }) {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 880 }}>
      <AccountCard user={user} onUserChange={onUserChange} onLogout={onLogout} />

      <Card title="Apparence">
        {/* « Système » est le défaut : sans choix explicite, la feuille de styles
            suit prefers-color-scheme — plus d'écran blanc sur un OS en sombre. */}
        <div style={{ display: 'flex', gap: 8 }} role="group" aria-label="Thème de l'interface">
          {['auto', 'light', 'dark'].map((t) => (
            <button key={t} className={`btn ${theme === t ? '' : 'ghost'}`} aria-pressed={theme === t} onClick={() => onThemeChange(t)}>
              {t === 'auto' ? 'Système' : t === 'light' ? 'Clair' : 'Sombre'}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
