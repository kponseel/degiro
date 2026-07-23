export function Spinner() {
  return (
    <div className="center">
      <div className="spinner" role="status" aria-label="Chargement" />
    </div>
  );
}

export function Card({ title, children, className = '' }) {
  return (
    <section className={`card card-pad ${className}`}>
      {title && <div className="card-title">{title}</div>}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value ${tone || ''}`}>{value}</div>
      {sub && <div className={`sub ${tone || ''}`}>{sub}</div>}
    </div>
  );
}

export function Banner({ kind = 'info', children }) {
  return <div className={`banner ${kind}`}>{children}</div>;
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <div>{children}</div>
    </div>
  );
}
