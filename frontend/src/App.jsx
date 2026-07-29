import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMe, getPortfolio, requestMagicLink, verifyMagicLink, logout as apiLogout } from './lib/api.js';
import { Spinner } from './components/ui.jsx';
import Onboarding from './components/Onboarding.jsx';
import WelcomeTour from './components/WelcomeTour.jsx';
import CommandPalette from './components/CommandPalette.jsx';
import { useHashRoute } from './lib/useHashRoute.js';
import { IconOverview, IconExposure, IconHistory, IconSettings, IconAI, IconAdmin, IconNews, IconHelp, IconTheme, IconExtension } from './components/icons.jsx';
import { readTheme, resolveTheme, nextTheme, saveTheme, systemPrefersDark } from './lib/theme.js';
import Overview from './pages/Overview.jsx';
import Exposure from './pages/Exposure.jsx';
import History from './pages/History.jsx';
import News from './pages/News.jsx';
import AiPrompts from './pages/AiPrompts.jsx';
import Settings from './pages/Settings.jsx';
import ImportExtension from './pages/ImportExtension.jsx';
import Help from './pages/Help.jsx';
import Admin from './pages/Admin.jsx';

// `short` = libellé compact des onglets ; `offTab` = joignable par la palette
// et le tiroir, mais pas d'onglet dédié (l'aide a son bouton « ? » dans la barre).
const PAGES = [
  { id: 'overview', label: "Vue d'ensemble", short: 'Portefeuille', icon: IconOverview, Comp: Overview },
  { id: 'exposure', label: 'Exposition', short: 'Exposition', icon: IconExposure, Comp: Exposure },
  // Cette page s'est longtemps appelée « Historique » dans le menu, « Performance »
  // sur l'onglet compact et dans son propre titre. Trois noms pour un écran : on ne
  // pouvait ni s'y référer à l'oral, ni la retrouver dans l'aide. Un seul nom.
  { id: 'history', label: 'Performance', short: 'Performance', icon: IconHistory, Comp: History },
  { id: 'news', label: 'Actus', short: 'Actus', icon: IconNews, Comp: News },
  { id: 'ai', label: 'Prompts IA', short: 'Prompts IA', icon: IconAI, Comp: AiPrompts },
  // `highlight` : mise en avant visuelle. Tout ce qui fait ENTRER des données —
  // extension Chrome, fichiers CSV, compléments — vit sur cette seule page :
  // c'est le geste récurrent de l'outil, il ne doit y avoir qu'une porte.
  { id: 'import', label: 'Import / Extension', short: 'Import', icon: IconExtension, Comp: ImportExtension, highlight: true },
  // Les Réglages ne portent plus que les paramètres de l'utilisateur (compte, thème).
  { id: 'settings', label: 'Réglages', short: 'Réglages', icon: IconSettings, Comp: Settings },
  { id: 'help', label: 'Aide & astuces', short: 'Aide', icon: IconHelp, Comp: Help, offTab: true },
  // Visible uniquement pour l'administrateur (ADMIN_EMAIL).
  { id: 'admin', label: 'Administration', short: 'Admin', icon: IconAdmin, Comp: Admin, adminOnly: true },
];

function Login({ initialError }) {
  const [email, setEmail] = useState('');
  const [pseudo, setPseudo] = useState('');
  const [invite, setInvite] = useState('');
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
      const res = await requestMagicLink(mail, pseudo.trim() || undefined, invite.trim() || undefined);
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
        <div className="field">
          <label htmlFor="invite">
            Code d'invitation <span className="muted">(uniquement pour une première inscription)</span>
          </label>
          <input id="invite" className="input" maxLength={255} autoComplete="off"
            value={invite} onChange={(e) => setInvite(e.target.value)}
            placeholder="Laisse vide si tu as déjà un compte"
            aria-describedby="invite-help" />
          <span id="invite-help" className="muted" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
            Demande-le à la personne qui t'a partagé ce lien.
          </span>
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
  const [status, setStatus] = useState('checking'); // checking | login | ready | unavailable
  const [user, setUser] = useState(null);
  const [route, navigate] = useHashRoute('overview');
  const [reloadKey, setReloadKey] = useState(0);
  const [loginError, setLoginError] = useState('');
  const [bootError, setBootError] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // null = à déterminer ; true = compte sans données → parcours de bienvenue.
  const [needsOnboarding, setNeedsOnboarding] = useState(null);
  const [showTour, setShowTour] = useState(false);
  // Thème : 'auto' | 'light' | 'dark'. L'état vit ici, et non dans les Réglages,
  // pour que la bascule de la barre et la carte « Apparence » ne divergent pas.
  // `systemDark` ne sert qu'à afficher la bonne icône quand le choix est
  // « Système » : la CSS, elle, suit l'OS toute seule.
  const [theme, setTheme] = useState(() => readTheme(localStorage));
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  // Empêche la présentation de resurgir à chaque changement de `user`
  // (renommage du pseudo, par exemple) quand elle a déjà été écartée.
  const tourSeenThisSession = useRef(false);

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
      .catch((e) => {
        // Seul un 401 signifie « session expirée ». Traiter aussi les 500, les
        // 502 et les coupures réseau comme une déconnexion affichait l'écran de
        // connexion à des utilisateurs parfaitement connectés — donnant à croire
        // que leur compte avait sauté — à la moindre indisponibilité du serveur.
        if (e?.status === 401) { setStatus('login'); return; }
        setBootError(e?.message || 'Service momentanément indisponible.');
        setStatus('unavailable');
      });
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

  // Présentation du produit, une fois les données (ou leur absence) tranchées :
  // elle passe après le parcours d'import, pour ne pas empiler deux écrans.
  useEffect(() => {
    if (status !== 'ready' || !user || needsOnboarding !== false) return;
    if (tourSeenThisSession.current) return;
    if (localStorage.getItem(`degiro_tour_v1_${user.id}`)) return;
    tourSeenThisSession.current = true;
    setShowTour(true);
  }, [status, user, needsOnboarding]);

  // La case fonctionne dans les deux sens : la décocher redemande la
  // présentation au prochain démarrage, sans quoi elle mentirait une fois
  // l'écran déjà vu.
  const closeTour = useCallback(({ remember }) => {
    if (user) {
      const key = `degiro_tour_v1_${user.id}`;
      if (remember) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    }
    tourSeenThisSession.current = true;
    setShowTour(false);
  }, [user]);

  const replayTour = useCallback(() => setShowTour(true), []);

  // L'OS peut basculer en cours de session (macOS/Windows le font à heure fixe).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const shownTheme = resolveTheme(theme, systemDark);
  const changeTheme = useCallback((t) => setTheme(saveTheme(t)), []);
  const toggleTheme = useCallback(
    () => changeTheme(nextTheme(theme, systemDark)),
    [changeTheme, theme, systemDark],
  );

  const go = useCallback((id) => { navigate(id); setNavOpen(false); }, [navigate]);

  const handleLogout = useCallback(async () => {
    try { await apiLogout(); } catch { /* ignore */ }
    setUser(null);
    navigate('overview', { replace: true });
    setNavOpen(false);
    setNeedsOnboarding(null);
    setShowTour(false);
    tourSeenThisSession.current = false;
    setStatus('login');
  }, [navigate]);

  const pages = useMemo(() => PAGES.filter((p) => !p.adminOnly || user?.isAdmin), [user]);

  // ⌘K / Ctrl+K ouvre la palette « Aller à… », qui a aussi son bouton dans la
  // barre. Les raccourcis « g » puis une lettre ont été retirés : invisibles,
  // impossibles à deviner, ils n'apportaient rien à une application qu'on ouvre
  // quelques minutes par semaine.
  useEffect(() => {
    if (status !== 'ready') return undefined;
    const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !isTyping(e.target)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status]);

  function finishOnboarding() {
    if (user) localStorage.setItem(`degiro_onboarded_${user.id}`, '1');
    setNeedsOnboarding(false);
    navigate('overview', { replace: true });
    setReloadKey((k) => k + 1);
  }

  if (status === 'checking') return <Spinner />;
  // Panne du serveur : surtout pas l'écran de connexion, qui laisserait croire à
  // une session perdue. On dit ce qui se passe et on propose de réessayer.
  if (status === 'unavailable') {
    return (
      <div className="center" style={{ padding: 24 }}>
        <div className="card card-pad" style={{ maxWidth: 460, textAlign: 'center' }}>
          <div className="card-title">Service momentanément indisponible</div>
          <p className="muted" style={{ marginTop: 0 }}>{bootError}</p>
          <p className="muted" style={{ fontSize: 13 }}>
            Tu es toujours connecté : rien n'est perdu, c'est le serveur qui ne répond pas.
          </p>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>
            Réessayer
          </button>
        </div>
      </div>
    );
  }
  if (status === 'login') return <Login initialError={loginError} />;
  if (needsOnboarding === null) return <Spinner />;
  if (needsOnboarding) {
    return (
      <Onboarding
        user={user}
        onFinished={finishOnboarding}
        onSkip={finishOnboarding}
        onInstallExtension={() => { finishOnboarding(); navigate('import', { replace: true }); }}
      />
    );
  }

  // Anciennes routes toujours servies pour ne casser aucun lien ou marque-page :
  // les dividendes vivent dans Performance, et la page extension a fusionné avec
  // l'import dans « Import / Extension » (le popup de l'extension y renvoie).
  const resolue = route === 'dividends' ? 'history' : route === 'extension' ? 'import' : route;
  const current = pages.find((p) => p.id === resolue) || pages[0];
  const Comp = current.Comp;

  const commands = [
    ...pages.map((p) => ({ id: `go-${p.id}`, label: p.label, group: 'Aller à', run: () => go(p.id) })),
    { id: 'act-import', label: 'Importer un fichier DEGIRO', group: 'Action', run: () => go('import') },
    { id: 'act-tour', label: 'Revoir la présentation', group: 'Action', run: replayTour },
    { id: 'act-refresh', label: 'Rafraîchir les données', group: 'Action', run: () => setReloadKey((k) => k + 1) },
    { id: 'act-theme', label: 'Basculer le thème clair / sombre', group: 'Action', run: toggleTheme },
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
          {pages.filter((p) => !p.offTab).map((p) => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                className={`tab ${route === p.id ? 'active' : ''} ${p.highlight ? 'tab-highlight' : ''}`}
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
          {/* Réutilise .help-trigger : même pastille 32×32 que l'aide, la barre
              ne s'alourdit pas et le bouton reste lisible sur mobile, où les
              onglets et le raccourci ⌘K disparaissent. */}
          <button
            className="help-trigger"
            onClick={toggleTheme}
            aria-label={`Thème ${shownTheme === 'dark' ? 'sombre' : 'clair'} — basculer en ${shownTheme === 'dark' ? 'clair' : 'sombre'}`}
            title="Basculer le thème clair / sombre"
          >
            <IconTheme dark={shownTheme === 'dark'} />
          </button>
          <button
            className={`help-trigger ${route === 'help' ? 'active' : ''}`}
            onClick={() => go('help')}
            aria-label="Aide et astuces"
            aria-current={route === 'help' ? 'page' : undefined}
            title="Aide & astuces"
          >
            <IconHelp />
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
              <button
                key={p.id}
                className={`${route === p.id ? 'active' : ''} ${p.highlight ? 'nav-highlight' : ''}`}
                onClick={() => go(p.id)}
              >
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
          onGoImport={() => go('import')}
          onGoExtension={() => go('import')}
          onGoOverview={() => { go('overview'); setReloadKey((k) => k + 1); }}
          onReplayTour={replayTour}
          theme={theme}
          onThemeChange={changeTheme}
        />
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={commands} />
      {showTour && <WelcomeTour user={user} onClose={closeTour} />}
    </div>
  );
}
