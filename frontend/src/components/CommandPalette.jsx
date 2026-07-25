import { useEffect, useMemo, useRef, useState } from 'react';

/** Correspondance approximative : « vue », « expo », « div »… */
function match(needle, hay) {
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  return hay.toLowerCase().includes(n);
}

/**
 * Palette de commandes (⌘K / Ctrl+K) : navigation et actions au clavier,
 * sans quitter les mains du clavier ni traverser l'écran à la souris.
 * @param items [{ id, label, hint, group, run }]
 */
export default function CommandPalette({ open, onClose, items }) {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const results = useMemo(
    () => items.filter((it) => match(q, `${it.label} ${it.hint || ''} ${it.group || ''}`)),
    [items, q],
  );

  useEffect(() => {
    if (open) { setQ(''); setCursor(0); setTimeout(() => inputRef.current?.focus(), 10); }
  }, [open]);

  useEffect(() => { setCursor(0); }, [q]);

  // Garde l'élément sélectionné visible lors de la navigation au clavier.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  function onKeyDown(e) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const it = results[cursor];
      if (it) { onClose(); it.run(); }
    }
  }

  return (
    <div className="palette-scrim" onMouseDown={onClose} role="presentation">
      <div
        className="palette"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Palette de commandes"
      >
        <input
          ref={inputRef}
          className="palette-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Aller à… (page, action)"
          aria-label="Rechercher une page ou une action"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={results[cursor] ? `palette-opt-${results[cursor].id}` : undefined}
        />
        <ul className="palette-list" id="palette-list" ref={listRef} role="listbox">
          {results.length === 0 && <li className="palette-empty">Aucun résultat</li>}
          {results.map((it, i) => (
            <li
              key={it.id}
              id={`palette-opt-${it.id}`}
              role="option"
              aria-selected={i === cursor}
              data-active={i === cursor}
              className={`palette-item ${i === cursor ? 'on' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={(e) => { e.preventDefault(); onClose(); it.run(); }}
            >
              <span className="palette-label">{it.label}</span>
              {it.group && <span className="palette-group">{it.group}</span>}
              {it.hint && <kbd className="palette-kbd">{it.hint}</kbd>}
            </li>
          ))}
        </ul>
        <div className="palette-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> naviguer</span>
          <span><kbd>↵</kbd> ouvrir</span>
          <span><kbd>Échap</kbd> fermer</span>
        </div>
      </div>
    </div>
  );
}
