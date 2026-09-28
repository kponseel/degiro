import { useState } from 'react';
import { Card } from '../components/ui.jsx';

/**
 * Aide et astuces. Volontairement statique : aucune donnée à charger, donc la
 * page reste consultable même quand l'API ou l'import posent problème — ce qui
 * est précisément le moment où on vient y chercher quelque chose.
 */

const TIPS = [
  {
    title: 'Commence par la vraie exposition',
    body: "C'est la vue qui surprend le plus. Importe la composition de tes ETF (Import / Extension → Compositions d'ETF), puis regarde l'onglet « vraie exposition » : les titres que tu détiens sans le savoir apparaissent, et les doublons entre deux ETF aussi.",
  },
  {
    title: 'Clique sur une ligne du portefeuille',
    body: "Le panneau de détail donne le prix de revient, l'exposition réelle du titre (en direct et via tes ETF), des liens directs vers Yahoo Finance, Finviz et l'actualité — et un bouton pour préparer un prompt IA sur ce titre.",
  },
  {
    title: 'Les secteurs se complètent tout seuls',
    body: "Import / Extension → Lancer l'enrichissement. Ce qui reste vide se corrige à la main juste en dessous, et la correction est conservée.",
  },
  {
    title: 'Une capture par jour suffit',
    body: "L'outil ne garde qu'un instantané par journée et par source. Capturer plusieurs fois dans la journée remplace simplement le précédent — ça ne crée jamais de doublon.",
  },
  {
    title: 'Les prompts IA sont pré-remplis avec tes chiffres',
    body: "La page Prompts IA prépare un texte à copier-coller dans ton assistant préféré : tout le portefeuille ou quelques titres choisis, avec l'objectif de ton choix (risques, diversification, rééquilibrage…). Aucune ressaisie.",
  },
];

const FAQ = [
  {
    q: 'Mon import est refusé ou mal lu',
    a: "Vérifie que le fichier vient bien de DEGIRO et qu'il est au format CSV (pas Excel). La langue de l'export n'a pas d'importance. Une prévisualisation s'affiche avant l'import définitif : si les colonnes semblent décalées, ne confirme pas et signale-le.",
  },
  {
    q: 'Un secteur ou un pays reste vide',
    a: "Les sources gratuites ne connaissent pas tout. Lance l'enrichissement, puis complète à la main dans Import / Extension → Références ISIN. Ta correction est définitive et prioritaire.",
  },
  {
    q: "L'extension me demande « l'adresse de mon Analyzer » — je mets quoi ?",
    a: "L'adresse à laquelle tu consultes cette page, sans rien après le nom de domaine (par exemple https://degiro.estim.pro). Elle est désormais pré-remplie dans l'extension — tu n'as normalement rien à saisir. La page « Import / Extension » l'affiche aussi, prête à copier.",
  },
  {
    q: "L'extension Chrome ne capture rien",
    a: "Ouvre son panneau Diagnostic : chaque étape y est marquée ✓ ou ✗ avec son détail. La page « Import / Extension » liste chaque symptôme et son remède. Le plus fréquent : l'onglet DEGIRO a été ouvert avant l'installation de l'extension (recharge-le avec F5), ou la session a expiré (reconnecte-toi).",
  },
  {
    q: 'Mes données sont-elles visibles par les autres utilisateurs ?',
    a: "Non. Chaque compte ne voit que ses propres positions et instantanés. Seules les données de référence — compositions d'ETF, secteurs, pays — sont partagées, parce qu'elles ne disent rien de personne.",
  },
  {
    q: 'Comment repartir de zéro ?',
    a: "Réglages → Mon compte → « Effacer mes données » retire tes instantanés et positions en gardant le compte. « Supprimer mon compte » efface tout, définitivement.",
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

      <Card title="Démarrer en deux minutes">
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
              Import / Extension → <em>Importer un export DEGIRO</em>. Une prévisualisation s'affiche avant
              de valider.
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
          <dt>Actus</dt>
          <dd>Des raccourcis vers l'actualité et les pages finance (Google News, Yahoo Finance, Finviz…) de chacun de tes titres.</dd>
          <dt>Prompts IA</dt>
          <dd>Un prompt prêt à copier — portefeuille entier ou titres sélectionnés, selon l'objectif choisi — rempli avec tes chiffres.</dd>
        </dl>
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
