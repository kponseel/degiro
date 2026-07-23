import { useEffect, useState } from 'react';

const STATES = {
  loading: { label: 'Vérification…', tone: 'muted' },
  ok: { label: 'API en ligne', tone: 'ok' },
  degraded: { label: 'API en ligne · base indisponible', tone: 'warn' },
  down: { label: 'API injoignable', tone: 'down' },
};

export default function App() {
  const [health, setHealth] = useState(null);
  const [state, setState] = useState('loading');

  useEffect(() => {
    let alive = true;
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!alive) return;
        setHealth(data);
        setState(data.db === 'up' ? 'ok' : 'degraded');
      })
      .catch(() => {
        if (alive) setState('down');
      });
    return () => {
      alive = false;
    };
  }, []);

  const current = STATES[state];

  return (
    <main className="shell">
      <header className="masthead">
        <p className="eyebrow">Portefeuille · pilotage</p>
        <h1>DEGIRO Analyzer</h1>
        <p className="tagline">
          Squelette déployable (M0). Les modules d&apos;analyse — exposition, look-through,
          performance — arrivent aux milestones suivants.
        </p>
      </header>

      <section className="card" aria-live="polite">
        <div className={`status status--${current.tone}`}>
          <span className="dot" aria-hidden="true" />
          <span>{current.label}</span>
        </div>
        <dl className="meta">
          <div>
            <dt>Statut</dt>
            <dd>{health?.status ?? '—'}</dd>
          </div>
          <div>
            <dt>Base de données</dt>
            <dd>{health?.db ?? '—'}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{health?.version ?? '—'}</dd>
          </div>
        </dl>
      </section>

      <footer className="foot">
        <span>degiro.estim.pro</span>
        <span>Health&nbsp;: <code>GET /api/health</code></span>
      </footer>
    </main>
  );
}
