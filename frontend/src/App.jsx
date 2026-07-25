import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMe, getPortfolio, requestMagicLink, verifyMagicLink, logout as apiLogout } from './lib/api.js';
import { Spinner } from './components/ui.jsx';
import Onboarding from './components/Onboarding.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { useHashRoute } from './lib/useHashRoute.js';
import { IconOverview, IconExposure, IconHistory, IconSettings, IconAI, IconDividends, IconAdmin, IconNews } from './components/icons.jsx';
import Overview from './pages/Overview.jsx';
import Exposure from './pages/Exposure.jsx';
import History from './pages/History.jsx';
import Dividends from './pages/Dividends.jsx';
import News from './pages/News.jsx';
import AiPrompts from './pages/AiPrompts.jsx';
import Settings from './pages/Settings.jsx';
import Admin from './pages/Admin.jsx';

// `short` = libellé compact des onglets ; `key` = raccourci après « g ».
const PAGES = [
  { id: 'overview', label: "Vue d'ensemble", short: 'Portefeuille', key: 'p', icon: IconOverview, Comp: Overview },
  { id: 'exposure', label: 'Exposition', short: 'Exposition', key: 'e', icon: IconExposure, Comp: Exposure },
  { id: 'history', label: 'Historique', short: 'Performance', key: 'h', icon: IconHistory, Comp: History },
  { id: 'dividends', label: 'Dividendes', short: 'Dividendes', key: 'd', icon: IconDividends, Comp: Dividends },
  { id: 'news', label: 'Actus', short: 'Actus', key: 'n', icon: IconNews, Comp: News },
  { id: 'ai', label: 'Prompts IA', short: 'Prompts IA', key: 'i', icon: IconAI, Comp: AiPrompts },
  { id: 'settings', label: 'Import / Réglages', short: 'Réglages', key: 'r', icon: IconSettings, Comp: Settings },
  // Visible uniquement pour l'administrateur (ADMIN_EMAIL).
  { id: 'admin', label: 'Administration', short: 'Admin', key: 'a', icon: IconAdmin, Comp: Admin, adminOnly: true },
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
  const [route, navigate] = useHashRoute('overview');
  const [reloadKey, setReloadKey] = useState(0);
  const [loginError, setLoginError] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
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

  // Estampille la route par défaut dans l'URL (partage / rafraîchissement fiables).
  useEffect(() => {
    if (status === 'ready' && !window.location.hash) navigate('overview', { replace: true });
  }, [status, navigate]);

  // Compte sans aucune donnée → onboarding (sauf s'il a déjà été passé sur cet appareil).
  useEffect(() => {
    if (status !== 'ready' || !user) return;
    if (localStorage.getItem(`degiro_onboarded_${user.id}`)) { setNeedsOnboarding(false); return; }
    getPortfolio()
      .then((d) => setNeedsOnboarding(!d.snapshot))
      .catch(() => setNeedsOnboarding(false));
  }, [status, user]);

  const go = useCallback((id) => { navigate(id); setNavOpen(false); }, [navigate]);

  const handleLogout = useCallback(async () => {
    try { await apiLogout(); } catch { /* ignore */ }
    setUser(null);
    navigate('overview', { replace: true });
    setNavOpen(false);
    setNeedsOnboarding(null);
    setStatus('login');
  }, [navigate]);

  const pages = useMemo(() => PAGES.filter((p) => !p.adminOnly || user?.isAdmin), [user]);

  // Raccourcis : ⌘K/Ctrl+K ouvre la palette ; « g » puis une lettre change de page.
  useEffect(() => {
    if (status !== 'ready') return undefined;
    let pending = false;
    let timer;
    const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (pending) {
        const hit = pages.find((p) => p.key === e.key.toLowerCase());
        pending = false;
        clearTimeout(timer);
        if (hit) { e.preventDefault(); go(hit.id); }
        return;
      }
      if (e.key.toLowerCase() === 'g') {
        pending = true;
        timer = setTimeout(() => { pending = false; }, 1400);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(timer); };
  }, [status, pages, go]);

  function finishOnboarding() {
    if (user) localStorage.setItem(`degiro_onboarded_${user.id}`, '1');
    setNeedsOnboarding(false);
    navigate('overview', { replace: true });
    setReloadKey((k) => k + 1);
  }

  if (status === 'checking') return <Spinner />;
  if (status === 'login') return <Login initialError={loginError} />;
  if (needsOnboarding === null) return <Spinner />;
  if (needsOnboarding) {
    return <Onboarding user={user} onFinished={finishOnboarding} onSkip={finishOnboarding} />;
  }

  const current = pages.find((p) => p.id === route) || pages[0];
  const Comp = current.Comp;

  const commands = [
    ...pages.map((p) => ({ id: `go-${p.id}`, label: p.label, group: 'Aller à', hint: `g ${p.key}`, run: () => go(p.id) })),
    { id: 'act-import', label: 'Importer un fichier DEGIRO', group: 'Action', run: () => go('settings') },
    { id: 'act-refresh', label: 'Rafraîchir les données', group: 'Action', run: () => setReloadKey((k) => k + 1) },
    { id: 'act-theme', label: "Basculer le thème clair / sombre", group: 'Action', run: () => {
      const now = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', now);
      localStorage.setItem('degiro_theme', now);
    } },
    { id: 'act-logout', label: 'Se déconnecter', group: 'Compte', run: handleLogout },
  ];

  return (
    <div className={`app ${navOpen ? 'nav-open' : ''}`}>
      <header className="topbar">
        <button
          className="hamburger"
          onClick={() => setNavOpen((o) => !o)}
          aria-label={navOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          aria-expanded={navOpen}
        >
          <span /><span /><span />
        </button>

        <span className="topbar-brand">
          <span className="brand-mark">DEGIRO</span>
          <span className="brand-sub">Analyzer</span>
        </span>

        <nav className="tabs" aria-label="Navigation principale">
          {pages.map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                className={`tab ${route === p.id ? 'active' : ''}`}
                onClick={() => go(p.id)}
                aria-current={route === p.id ? 'page' : undefined}
              >
                <Icon /> <span>{p.short}</span>
              </button>
            );
          })}
        </nav>

        <div className="topbar-right">
          <button className="cmd-trigger" onClick={() => setPaletteOpen(true)} aria-label="Ouvrir la palette de commandes">
            <span className="cmd-hint">Aller à…</span><kbd>⌘K</kbd>
          </button>
          <span className="topbar-user" title={user?.email}>{user?.pseudo}</span>
          <button className="link-btn" onClick={handleLogout}>Quitter</button>
        </div>
      </header>

      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      {/* Tiroir mobile : reprend la même navigation. */}
      <aside className="drawer" aria-label="Menu">
        <div className="brand">
          <span className="brand-mark">DEGIRO</span>
          <span className="brand-sub">Analyzer</span>
        </div>
        <nav className="nav">
          {pages.map((p) => {
            const Icon = p.icon;
            return (
              <button key={p.id} className={route === p.id ? 'active' : ''} onClick={() => go(p.id)}>
                <Icon /> {p.short}
              </button>
            );
          })}
        </nav>
        <div className="drawer-foot">
          <span className="user-pseudo">{user?.pseudo}</span>
          <button className="link-btn" onClick={handleLogout}>Déconnexion</button>
        </div>
      </aside>

      <main className="main">
        <Comp
          key={`${current.id}-${reloadKey}`}
          user={user}
          onUserChange={setUser}
          onLogout={handleLogout}
          onGoImport={() => go('settings')}
          onGoOverview={() => { go('overview'); setReloadKey((k) => k + 1); }}
        />
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={commands} />
    </div>
  );
}
