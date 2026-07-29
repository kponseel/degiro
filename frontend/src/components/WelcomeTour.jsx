import { useEffect, useRef, useState } from 'react';

/**
 * Présentation affichée à la connexion : à quoi sert l'outil, ce que contient
 * chaque vue, comment aller vite, comment garder les données à jour.
 *
 * Elle ne s'impose qu'une fois. La case « ne plus afficher » (cochée par défaut)
 * laisse le choix de la revoir au prochain démarrage, et l'écran reste
 * rappelable à tout moment depuis l'Aide.
 */

const STEPS = [
  {
    title: 'Ce que cet outil ajoute à DEGIRO',
    body: (
      <>
        <p>
          DEGIRO t'affiche ce que tu possèdes. Ici, tu vois ce que ça <strong>signifie</strong> :
          ta répartition réelle, ta performance réelle, et ce que ton portefeuille te rapporte.
        </p>
        <ul className="tour-list">
          <li><strong>Ta vraie répartition</strong> — y compris les titres cachés <em>à l'intérieur</em> de tes ETF.</li>
          <li><strong>Ta performance réelle</strong> — celle qui ne se laisse pas flatter par tes versements.</li>
          <li><strong>Tes dividendes</strong> — ce qui est tombé, et ce que ça représente.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Les vues, en une phrase chacune',
    body: (
      <ul className="tour-list">
        <li><strong>Portefeuille</strong> — tes positions et leurs +/− values. Clique une ligne : tout son détail s'ouvre.</li>
        <li><strong>Exposition</strong> — secteurs, pays, devises. L'onglet <em>vraie exposition</em> éclate tes ETF en leurs titres : c'est là qu'on découvre qu'on détient trois fois la même entreprise.</li>
        <li><strong>Performance</strong> — ta courbe, ton TWR face à un indice, tes plus-values réalisées et tes dividendes.</li>
        <li><strong>Actus</strong> — l'actualité de tes titres, avec les raccourcis vers Yahoo Finance et Finviz.</li>
      </ul>
    ),
  },
  {
    title: 'Aller vite',
    body: (
      <>
        <ul className="tour-list">
          <li><kbd>⌘K</kbd> (ou <kbd>Ctrl</kbd>+<kbd>K</kbd>) — tout atteindre sans lâcher le clavier.</li>
          <li>Les tableaux se trient en cliquant sur les en-têtes, et se filtrent en haut de page.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Garder tes données à jour',
    body: (
      <>
        <p>Deux façons, au choix :</p>
        <ul className="tour-list">
          <li><strong>Import CSV</strong> — l'export DEGIRO, déposé dans <em>Import / Extension</em>. Aucune installation.</li>
          <li><strong>Extension Chrome</strong> — un clic depuis ta session DEGIRO ouverte, sans fichier à manipuler.</li>
        </ul>
        <p className="muted">
          Une capture par jour suffit : l'outil n'en garde qu'une par journée, et réimporter la même
          ne crée pas de doublon.
        </p>
      </>
    ),
  },
];

export default function WelcomeTour({ user, onClose }) {
  const [step, setStep] = useState(0);
  const [remember, setRemember] = useState(true);
  const panelRef = useRef(null);
  const previousFocus = useRef(null);

  const last = step === STEPS.length - 1;
  const finish = () => onClose({ remember });

  // La case à cocher est lue par référence : si `remember` était une dépendance
  // de l'effet, chaque clic dessus démonterait le piège à focus et renverrait
  // le focus sur le bouton principal — la case perdrait le focus en étant cochée.
  const rememberRef = useRef(remember);
  rememberRef.current = remember;

  useEffect(() => {
    previousFocus.current = document.activeElement;
    const panel = panelRef.current;

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose({ remember: rememberRef.current }); return; }
      if (e.key !== 'Tab') return;
      // Piège à focus : la tabulation reste dans la fenêtre.
      const f = panel?.querySelectorAll('a[href], button, input, [tabindex]:not([tabindex="-1"])');
      if (!f?.length) return;
      const first = f[0];
      const end = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); end.focus(); }
      else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
    }

    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => panel?.querySelector('.tour-next')?.focus(), 40);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(t);
      previousFocus.current?.focus?.();
    };
  }, [onClose]);

  const current = STEPS[step];

  return (
    <div className="palette-scrim tour-scrim" role="presentation">
      <div
        className="tour"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
      >
        <div className="tour-head">
          <div>
            <span className="brand-mark">DEGIRO Analyzer</span>
            <h2 id="tour-title">
              {step === 0 && user?.pseudo ? `Bienvenue ${user.pseudo} 👋` : current.title}
            </h2>
            {step === 0 && user?.pseudo && <p className="tour-sub">{current.title}</p>}
          </div>
          {/* Pas d'aria-label ici : il masquerait le texte visible, et « Passer »
              cesserait d'être prononçable en commande vocale. */}
          <button className="link-btn" onClick={finish}>Passer</button>
        </div>

        <div className="tour-body">{current.body}</div>

        <div className="tour-foot">
          <div className="tour-dots" role="tablist" aria-label="Étapes">
            {STEPS.map((s, i) => (
              <button
                key={s.title}
                className={`tour-dot ${i === step ? 'on' : ''}`}
                onClick={() => setStep(i)}
                role="tab"
                aria-selected={i === step}
                aria-label={`Étape ${i + 1} : ${s.title}`}
              />
            ))}
          </div>

          <div className="tour-actions">
            {step > 0 && (
              <button className="btn ghost" onClick={() => setStep((s) => s - 1)}>Précédent</button>
            )}
            <button
              className="btn tour-next"
              onClick={() => (last ? finish() : setStep((s) => s + 1))}
            >
              {last ? 'Commencer' : 'Suivant'}
            </button>
          </div>
        </div>

        <label className="tour-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Ne plus afficher au démarrage <span className="muted">— toujours disponible dans l'Aide</span></span>
        </label>
      </div>
    </div>
  );
}
