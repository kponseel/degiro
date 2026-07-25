import { useState } from 'react';
import { Card } from '../components/ui.jsx';

/**
 * Aide et astuces. Volontairement statique : aucune donnée à charger, donc la
 * page reste consultable même quand l'API ou l'import posent problème — ce qui
 * est précisément le moment où on vient y chercher quelque chose.
 */

function Kbd({ children }) {
  return <kbd className="help-kbd">{children}</kbd>;
}

const SHORTCUTS = [
  { keys: ['⌘K'], alt: ['Ctrl', 'K'], what: 'Ouvrir la palette : atteindre n\'importe quelle page ou action' },
  { keys: ['g', 'p'], what: 'Aller au portefeuille' },
  { keys: ['g', 'e'], what: "Aller à l'exposition" },
  { keys: ['g', 'h'], what: 'Aller à la performance' },
  { keys: ['g', 'd'], what: 'Aller aux dividendes' },
  { keys: ['g', 'n'], what: 'Aller aux actus' },
  { keys: ['g', 'i'], what: 'Aller aux prompts IA' },
  { keys: ['g', 'r'], what: 'Aller aux réglages / import' },
  { keys: ['g', '?'], what: 'Ouvrir cette aide' },
  { keys: ['Échap'], what: 'Fermer le panneau ou la fenêtre ouverte' },
];

const TIPS = [
  {
    title: 'Commence par la vraie exposition',
    body: "C'est la vue qui surprend le plus. Importe la composition de tes ETF (Réglages → Compositions d'ETF), puis regarde l'onglet « vraie exposition » : les titres que tu détiens sans le savoir apparaissent, et les doublons entre deux ETF aussi.",
  },
  {
    title: 'Le relevé de compte débloque deux vues',
    body: "Sans Account.csv, pas de dividendes ni de TWR — l'outil ne peut pas distinguer un versement d'une hausse. Une fois importé, la performance devient enfin comparable à un indice.",
  },
  {
    title: 'Clique sur une ligne du portefeuille',
    body: "Le panneau de détail donne le prix de revient, l'exposition réelle du titre (en direct et via tes ETF), ses actualités et des liens directs vers Yahoo Finance, Finviz et le profil de l'entreprise.",
  },
  {
    title: 'Les secteurs se complètent tout seuls',
    body: "Réglages → Lancer l'enrichissement. Ce qui reste vide se corrige à la main juste en dessous, et la correction est conservée.",
  },
  {
    title: 'Une capture par jour suffit',
    body: "L'outil ne garde qu'un instantané par journée et par source. Capturer plusieurs fois dans la journée remplace simplement le précédent — ça ne crée jamais de doublon ni de faux point sur la courbe.",
  },
  {
    title: 'Les prompts IA sont pré-remplis avec tes chiffres',
    body: 'La page Prompts IA génère des questions à copier-coller dans ton assistant préféré, déjà remplies avec ta répartition réelle. Utile pour un avis extérieur sans ressaisir quoi que ce soit.',
  },
];

const FAQ = [
  {
    q: 'Mon import est refusé ou mal lu',
    a: "Vérifie que le fichier vient bien de DEGIRO et qu'il est au format CSV (pas Excel). La langue de l'export n'a pas d'importance. Une prévisualisation s'affiche avant l'import définitif : si les colonnes semblent décalées, ne confirme pas et signale-le.",
  },
  {
    q: 'Je ne vois aucun dividende',
    a: "Les dividendes viennent du relevé de compte (Account.csv), pas du portefeuille. DEGIRO → Activité → Relevés, puis importe-le dans Réglages.",
  },
  {
    q: 'Ma performance a l\'air fausse',
    a: "Une courbe de valeur monte aussi quand tu verses de l'argent. Le TWR neutralise tes versements — c'est lui qu'il faut comparer à un indice. Il a besoin du relevé de compte pour connaître les dates de tes versements.",
  },
  {
    q: 'Un secteur ou un pays reste vide',
    a: "Les sources gratuites ne connaissent pas tout. Lance l'enrichissement, puis complète à la main dans Réglages → Références ISIN. Ta correction est définitive et prioritaire.",
  },
  {
    q: "L'extension Chrome ne capture rien",
    a: "Ouvre son panneau Diagnostic : chaque étape y est marquée ✓ ou ✗ avec son détail. Le plus fréquent : l'onglet DEGIRO a été ouvert avant l'installation de l'extension (recharge-le avec F5), ou la session a expiré (reconnecte-toi).",
  },
  {
    q: 'Mes données sont-elles visibles par les autres utilisateurs ?',
    a: "Non. Chaque compte ne voit que ses propres positions, mouvements et instantanés. Seules les données de référence — compositions d'ETF, secteurs, cours des indices — sont partagées, parce qu'elles ne disent rien de personne.",
  },
  {
    q: 'Comment repartir de zéro ?',
    a: "Réglages → Mon compte → « Effacer mes données » retire tes instantanés, positions et mouvements en gardant le compte. « Supprimer mon compte » efface tout, définitivement.",
  },
];

export default function Help({ onGoImport, onReplayTour }) {
  const [openFaq, setOpenFaq] = useState(null);

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 880 }}>
      <div className="page-head">
        <h1>Aide &amp; astuces</h1>
        <p>
          Comment alimenter l'outil, ce que chaque vue raconte, et quoi faire quand quelque chose
          ne se passe pas comme prévu.
        </p>
      </div>

      <Card title="Démarrer en trois minutes">
        <ol className="help-steps">
          <li>
            <strong>Exporte ton portefeuille depuis DEGIRO</strong>
            <div className="muted">
              Site DEGIRO → <em>Portefeuille</em> → <em>Exporter</em> (en haut à droite) → format <strong>CSV</strong>.
            </div>
          </li>
          <li>
            <strong>Importe-le ici</strong>
            <div className="muted">
              Réglages → <em>Importer un export DEGIRO</em>. Le type de fichier est reconnu tout seul,
              et une prévisualisation s'affiche avant de valider.
            </div>
          </li>
          <li>
            <strong>Ajoute ton relevé de compte</strong>
            <div className="muted">
              DEGIRO → <em>Activité</em> → <em>Relevés</em> → CSV. C'est lui qui débloque les
              <strong> dividendes</strong> et la <strong>performance réelle (TWR)</strong>.
            </div>
          </li>
          <li>
            <strong>Va plus loin quand tu veux</strong>
            <div className="muted">
              Les compositions d'ETF révèlent ta vraie exposition ; l'extension Chrome remplace
              l'import manuel par un clic.
            </div>
          </li>
        </ol>
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn" onClick={onGoImport}>Aller à l'import →</button>
          <button className="btn ghost" onClick={onReplayTour}>Revoir la présentation</button>
        </div>
      </Card>

      <Card title="Ce que montre chaque vue">
        <dl className="help-defs">
          <dt>Portefeuille</dt>
          <dd>Tes positions, leur valeur et leurs +/− values. Clique une ligne pour ouvrir son détail complet.</dd>
          <dt>Exposition</dt>
          <dd>
            Ta répartition par secteur, pays, devise et classe d'actifs. L'onglet <em>vraie exposition</em> éclate
            tes ETF en leurs titres — c'est là qu'on voit les concentrations invisibles autrement.
          </dd>
          <dt>Performance</dt>
          <dd>
            La courbe de valeur, et le <strong>TWR</strong> : la performance débarrassée de l'effet de tes
            versements, donc comparable à un indice de référence.
          </dd>
          <dt>Dividendes</dt>
          <dd>Ce que tu as encaissé, par ligne et par mois. Vient du relevé de compte.</dd>
          <dt>Actus</dt>
          <dd>L'actualité des titres que tu détiens, filtrable, avec des liens vers les pages finance.</dd>
          <dt>Prompts IA</dt>
          <dd>Des questions d'analyse déjà remplies avec tes chiffres, à copier dans l'assistant de ton choix.</dd>
        </dl>
      </Card>

      <Card title="Raccourcis clavier">
        <div className="table-wrap">
          <table className="data compact">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', width: 170 }}>Touches</th>
                <th style={{ textAlign: 'left' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {SHORTCUTS.map((s) => (
                <tr key={s.what}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {s.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}
                    {s.alt && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        {' '}ou {s.alt.map((k) => <Kbd key={k}>{k}</Kbd>)}
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'left' }}>{s.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 12, fontSize: 12.5 }}>
          Les raccourcis à deux touches s'enchaînent : appuie sur <Kbd>g</Kbd>, relâche, puis la seconde touche.
        </p>
      </Card>

      <Card title="Astuces">
        <div className="help-tips">
          {TIPS.map((t) => (
            <div className="help-tip" key={t.title}>
              <strong>{t.title}</strong>
              <p className="muted">{t.body}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Problèmes fréquents">
        <div className="help-faq">
          {FAQ.map((f, i) => (
            <div key={f.q} className={`help-faq-item ${openFaq === i ? 'open' : ''}`}>
              <button
                className="help-faq-q"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                aria-expanded={openFaq === i}
              >
                <span>{f.q}</span>
                <span className="help-faq-chevron" aria-hidden="true">›</span>
              </button>
              {openFaq === i && <p className="help-faq-a">{f.a}</p>}
            </div>
          ))}
        </div>
      </Card>

      <Card title="Tes données">
        <p className="muted" style={{ marginTop: 0 }}>
          Aucun identifiant DEGIRO n'est demandé ni stocké, nulle part. L'import se fait à partir de
          fichiers que tu exportes toi-même ; l'extension lit ton portefeuille depuis la session que
          tu as déjà ouverte, sans jamais se connecter à ta place.
        </p>
        <p className="muted">
          La connexion se fait par lien à usage unique — il n'y a pas de mot de passe à retenir ni à
          protéger. Tu peux effacer tes données ou supprimer ton compte à tout moment depuis les réglages.
        </p>
      </Card>
    </div>
  );
}
