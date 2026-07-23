import { useEffect, useState } from 'react';
import { getToken, setToken, validateToken } from './lib/api.js';
import { Spinner } from './components/ui.jsx';
import { IconOverview, IconExposure, IconHistory, IconSettings, IconAI } from './components/icons.jsx';
import Overview from './pages/Overview.jsx';
import Exposure from './pages/Exposure.jsx';
import History from './pages/History.jsx';
import AiPrompts from './pages/AiPrompts.jsx';
import Settings from './pages/Settings.jsx';

const PAGES = [
  { id: 'overview', label: "Vue d'ensemble", icon: IconOverview, Comp: Overview },
  { id: 'exposure', label: 'Exposition', icon: IconExposure, Comp: Exposure },
  { id: 'history', label: 'Historique', icon: IconHistory, Comp: History },
  { id: 'ai', label: 'Prompts IA', icon: IconAI, Comp: AiPrompts },
  { id: 'settings', label: 'Import / Réglages', icon: IconSettings, Comp: Settings },
];

function Gate({ onUnlock }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const token = value.trim();
    if (!token) return;
    setBusy(true); setError('');
    const ok = await validateToken(token);
    setBusy(false);
    if (ok) { setToken(token); onUnlock(); } else setError('Jeton refusé par le serveur.');
  }

  return (
    <div className="gate">
      <form className="card card-pad" onSubmit={submit}>
        <div className="brand" style={{ padding: 0, marginBottom: 16 }}>
          <span className="brand-mark">DEGIRO Analyzer</span>
          <span className="brand-sub">Accès privé</span>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>Saisissez votre jeton d'accès (variable <code>API_TOKEN</code> du serveur).</p>
        <div className="field">
          <label htmlFor="tok">Jeton d'accès</label>
          <input id="tok" className="input" type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="••••••••" />
        </div>
        {error && <div className="banner err" style={{ marginTop: 12 }}>{error}</div>}
        <button className="btn" type="submit" disabled={busy} style={{ marginTop: 16, width: '100%', justifyContent: 'center' }}>
          {busy ? 'Vérification…' : 'Entrer'}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState('checking'); // checking | locked | ready
  const [active, setActive] = useState('overview');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const token = getToken();
    if (!token) { setStatus('locked'); return; }
    validateToken(token).then((ok) => setStatus(ok ? 'ready' : 'locked'));
  }, []);

  if (status === 'checking') return <Spinner />;
  if (status === 'locked') return <Gate onUnlock={() => setStatus('ready')} />;

  const current = PAGES.find((p) => p.id === active) || PAGES[0];
  const Comp = current.Comp;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">DEGIRO</span>
          <span className="brand-sub">Analyzer</span>
        </div>
        <nav className="nav">
          {PAGES.map((p) => {
            const Icon = p.icon;
            return (
              <button key={p.id} className={active === p.id ? 'active' : ''} onClick={() => setActive(p.id)}>
                <Icon /> {p.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span>degiro.estim.pro</span>
        </div>
      </aside>

      <main className="main">
        <div className="page-head">
          <h1>{current.label}</h1>
        </div>
        <Comp
          key={`${current.id}-${reloadKey}`}
          onGoImport={() => setActive('settings')}
          onImported={() => setReloadKey((k) => k + 1)}
        />
      </main>
    </div>
  );
}
