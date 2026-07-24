import { useEffect, useState } from 'react';
import { getMe, getPortfolio, requestMagicLink, verifyMagicLink, logout as apiLogout } from './lib/api.js';
import { Spinner } from './components/ui.jsx';
import Onboarding from './components/Onboarding.jsx';
import { IconOverview, IconExposure, IconHistory, IconSettings, IconAI, IconDividends, IconAdmin, IconNews } from './components/icons.jsx';
import Overview from './pages/Overview.jsx';
import Exposure from './pages/Exposure.jsx';
import History from './pages/History.jsx';
import Dividends from './pages/Dividends.jsx';
import News from './pages/News.jsx';
import AiPrompts from './pages/AiPrompts.jsx';
import Settings from './pages/Settings.jsx';
import Admin from './pages/Admin.jsx';

const PAGES = [
  { id: 'overview', label: "Vue d'ensemble", icon: IconOverview, Comp: Overview },
  { id: 'exposure', label: 'Exposition', icon: IconExposure, Comp: Exposure },
  { id: 'history', label: 'Historique', icon: IconHistory, Comp: History },
  { id: 'dividends', label: 'Dividendes', icon: IconDividends, Comp: Dividends },
  { id: 'news', label: 'Actus', icon: IconNews, Comp: News },
  { id: 'ai', label: 'Prompts IA', icon: IconAI, Comp: AiPrompts },
  { id: 'settings', label: 'Import / Réglages', icon: IconSettings, Comp: Settings },
  // Visible uniquement pour l'administrateur (ADMIN_EMAIL).
  { id: 'admin', label: 'Administration', icon: IconAdmin, Comp: Admin, adminOnly: true },
];

function Login({ initialError }) {
  const [email, setEmail] = useState('');
  const [pseudo, setPseudo] = useState('');
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || '');

  async function submit(e) {
    e.preventDefault();
    const mail = email.trim();
    if (!mail) return;
    setBusy(true); setError('');
    try {
      const res = await requestMagicLink(mail, pseudo.trim() || undefined);
      setSent(true);
      setDevLink(res.devLink || null);
    } catch (e2) {
      setError(e2.status === 400 ? 'Email invalide.' : (e2.message || 'Erreur, réessaie.'));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="gate">
        <div className="card card-pad">
          <div className="brand" style={{ padding: 0, marginBottom: 16 }}>
            <span className="brand-mark">DEGIRO Analyzer</span>
            <span className="brand-sub">Connexion</span>
          </div>
          <h3 style={{ margin: '0 0 8px' }}>Vérifie ta boîte mail 📬</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            On a envoyé un lien de connexion à <strong>{email}</strong>. Il est valable 15 minutes, à usage unique.
          </p>
          {devLink && (
            <div className="banner info" style={{ marginTop: 12, wordBreak: 'break-all' }}>
              Lien de dev : <a href={devLink}>{devLink}</a>
            </div>
          )}
          <button className="btn ghost" style={{ marginTop: 16 }} onClick={() => { setSent(false); setDevLink(null); }}>
            Changer d'email / renvoyer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gate">
      <form className="card card-pad" onSubmit={submit}>
        <div className="brand" style={{ padding: 0, marginBottom: 16 }}>
          <span className="brand-mark">DEGIRO Analyzer</span>
          <span className="brand-sub">Accès privé</span>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>Connexion par lien magique — sans mot de passe.</p>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoFocus autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="toi@exemple.com" />
        </div>
        <div className="field">
          <label htmlFor="pseudo">Pseudo <span className="muted">(optionnel — sinon la partie avant le @)</span></label>
          <input id="pseudo" className="input" maxLength={60}
            value={pseudo} onChange={(e) => setPseudo(e.target.value)} placeholder="Ton pseudo" />
        </div>
        {error && <div className="banner err" style={{ marginTop: 12 }}>{error}</div>}
        <button className="btn" type="submit" disabled={busy} style={{ marginTop: 16, width: '100%', justifyContent: 'center' }}>
          {busy ? 'Envoi…' : 'Recevoir mon lien'}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState('checking'); // checking | login | ready
  const [user, setUser] = useState(null);
  const [active, setActive] = useState('overview');
  const [reloadKey, setReloadKey] = useState(0);
  const [loginError, setLoginError] = useState('');
  // null = à déterminer ; true = compte sans données → parcours de bienvenue.
  const [needsOnboarding, setNeedsOnboarding] = useState(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.pathname === '/auth/verify') {
      const token = url.searchParams.get('token');
      verifyMagicLink(token)
        .then((res) => {
          window.history.replaceState({}, '', '/');
          setUser(res.user);
          setStatus('ready');
        })
        .catch(() => {
          window.history.replaceState({}, '', '/');
          setLoginError('Lien invalide ou expiré. Redemande un lien de connexion.');
          setStatus('login');
        });
      return;
    }
    getMe()
      .then((res) => { setUser(res.user); setStatus('ready'); })
      .catch(() => setStatus('login'));
  }, []);

  // Compte sans aucune donnée → onboarding (sauf s'il a déjà été passé sur cet appareil).
  useEffect(() => {
    if (status !== 'ready' || !user) return;
    if (localStorage.getItem(`degiro_onboarded_${user.id}`)) { setNeedsOnboarding(false); return; }
    getPortfolio()
      .then((d) => setNeedsOnboarding(!d.snapshot))
      .catch(() => setNeedsOnboarding(false));
  }, [status, user]);

  function finishOnboarding() {
    if (user) localStorage.setItem(`degiro_onboarded_${user.id}`, '1');
    setNeedsOnboarding(false);
    setActive('overview');
    setReloadKey((k) => k + 1);
  }

  async function handleLogout() {
    try { await apiLogout(); } catch { /* ignore */ }
    setUser(null);
    setActive('overview');
    setNeedsOnboarding(null);
    setStatus('login');
  }

  if (status === 'checking') return <Spinner />;
  if (status === 'login') return <Login initialError={loginError} />;
  if (needsOnboarding === null) return <Spinner />;
  if (needsOnboarding) {
    return <Onboarding user={user} onFinished={finishOnboarding} onSkip={finishOnboarding} />;
  }

  const pages = PAGES.filter((p) => !p.adminOnly || user?.isAdmin);
  const current = pages.find((p) => p.id === active) || pages[0];
  const Comp = current.Comp;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">DEGIRO</span>
          <span className="brand-sub">Analyzer</span>
        </div>
        <nav className="nav">
          {pages.map((p) => {
            const Icon = p.icon;
            return (
              <button key={p.id} className={active === p.id ? 'active' : ''} onClick={() => setActive(p.id)}>
                <Icon /> {p.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <span className="user-pseudo">{user?.pseudo}</span>
            <button className="link-btn" onClick={handleLogout}>Déconnexion</button>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="page-head">
          <h1>{current.label}</h1>
        </div>
        <Comp
          key={`${current.id}-${reloadKey}`}
          user={user}
          onUserChange={setUser}
          onLogout={handleLogout}
          onGoImport={() => setActive('settings')}
          onGoOverview={() => { setActive('overview'); setReloadKey((k) => k + 1); }}
        />
      </main>
    </div>
  );
}
