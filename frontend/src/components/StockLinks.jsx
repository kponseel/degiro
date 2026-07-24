import { stockLinks } from '../lib/links.js';

/** Rangée de raccourcis vers les pages finance d'un titre (Yahoo, Finviz…). */
export default function StockLinks({ stock, className = '' }) {
  const links = stockLinks(stock || {});
  if (!links.length) return null;
  return (
    <div className={`stock-links ${className}`}>
      {links.map((l) => (
        <a key={l.label} className="chip link-chip" href={l.url} target="_blank" rel="noopener noreferrer">
          {l.label} ↗
        </a>
      ))}
    </div>
  );
}
