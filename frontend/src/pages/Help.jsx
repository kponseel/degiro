import { useState } from 'react';
import { Card, Banner } from '../components/ui.jsx';
import { buildBrowserAgentPrompt } from '../lib/browserAgentPrompt.js';

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
    title: 'Le relevé de compte débloque deux vues',
    body: "Sans Account.csv, pas de dividendes ni de TWR — l'outil ne peut pas distinguer un versement d'une hausse. Une fois importé, la performance devient enfin comparable à un indice.",
  },
  {
    title: 'Clique sur une ligne du portefeuille',
    body: "Le panneau de détail donne le prix de revient, l'exposition réelle du titre (en direct et via tes ETF), ses actualités et des liens directs vers Yahoo Finance, Finviz et le profil de l'entreprise.",
  },
  {
    title: 'Les secteurs se complètent tout seuls',
    body: "Import / Extension → Lancer l'enrichissement. Ce qui reste vide se corrige à la main juste en dessous, et la correction est conservée.",
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
    a: "Les dividendes viennent du relevé de compte (Account.csv), pas du portefeuille. DEGIRO → Activité → Relevés, puis importe-le dans Import / Extension.",
  },
  {
    q: 'Ma performance a l\'air fausse',
    a: "Une courbe de valeur monte aussi quand tu verses de l'argent. Le TWR neutralise tes versements — c'est lui qu'il faut comparer à un indice. Il a besoin du relevé de compte pour connaître les dates de tes versements.",
  },
  {
    q: 'Un secteur ou un pays reste vide',
    a: "Les sources gratuites ne connaissent pas tout. Lance l'enrichissement, puis complète à la main dans Import / Extension → Références ISIN. Ta correction est définitive et prioritaire.",
  },
  {
    q: 'Mon historique semble incomplet (ventes ou dividendes manquants)',
    a: "Presque toujours la plage de dates de l'export DEGIRO : elle est courte par défaut et ne couvre pas tout l'historique. Réexporte Transactions et Relevé de compte depuis l'ouverture du compte (au besoin année par année — réimporter ne crée aucun doublon). Pour le portefeuille, pense à cocher « toutes les positions », sinon les lignes soldées n'apparaissent pas.",
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
    a: "Non. Chaque compte ne voit que ses propres positions, mouvements et instantanés. Seules les données de référence — compositions d'ETF, secteurs, cours des indices — sont partagées, parce qu'elles ne disent rien de personne.",
  },
  {
    q: 'Comment repartir de zéro ?',
    a: "Réglages → Mon compte → « Effacer mes données » retire tes instantanés, positions et mouvements en gardant le compte. « Supprimer mon compte » efface tout, définitivement.",
  },
];

/**
 * Mise à jour pilotée par un agent navigateur (Claude for Chrome et équivalents).
 * Troisième voie, à côté de l'extension de capture et de l'import manuel : l'agent
 * va chercher les exports lui-même. Le prompt insiste sur les deux réglages que
 * DEGIRO rate par défaut — plages de dates et « toutes les positions ».
 */
function BrowserAgentCard() {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const prompt = buildBrowserAgentPrompt({ appUrl: window.location.origin });

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Presse-papiers refusé (permission, http) : on déplie, l'utilisateur copie à la main.
      setOpen(true);
    }
  }

  return (
    <Card title="Mise à jour par un agent navigateur (Claude for Chrome)">
      <p className="muted" style={{ marginTop: 0 }}>
        Si tu utilises un agent qui pilote ton navigateur — <strong>Claude for Chrome</strong> avec
        Sonnet&nbsp;5, ou équivalent — il peut aller chercher tes trois exports DEGIRO et les importer
        ici à ta place. Le prompt ci-dessous lui donne les consignes exactes, y compris les deux
        réglages que l'on rate presque toujours&nbsp;: les <strong>plages de dates complètes</strong>
        {' '}et l'option <strong>« toutes les positions »</strong> du portefeuille.
      </p>

      <ol className="help-steps" style={{ marginTop: 14 }}>
        <li>
          <strong>Ouvre DEGIRO et connecte-toi</strong>
          <div className="muted">
            L'agent ne doit jamais saisir tes identifiants : la session doit déjà être ouverte.
          </div>
        </li>
        <li>
          <strong>Copie le prompt et donne-le à ton agent</strong>
          <div className="muted">
            Laisse cet onglet ouvert&nbsp;: l'agent y reviendra pour importer les fichiers.
          </div>
        </li>
        <li>
          <strong>Surveille et valide</strong>
          <div className="muted">
            Le prompt lui demande de vérifier l'étendue réelle des fichiers et de te faire un rapport.
            Relis-le avant de considérer la mise à jour comme faite.
          </div>
        </li>
      </ol>

      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn" onClick={copy}>{copied ? 'Copié ✓' : 'Copier le prompt'}</button>
        <button className="link-btn" onClick={() => setOpen((o) => !o)}>
          {open ? 'Masquer le prompt' : 'Voir le prompt'}
        </button>
      </div>

      {open && <pre className="prompt-pre">{prompt}</pre>}

      <div style={{ marginTop: 16 }}>
        <Banner kind="warn">
          Le prompt impose à l'agent de rester en <strong>lecture seule</strong>&nbsp;: aucun ordre passé,
          modifié ou annulé, aucun mouvement d'argent, aucun identifiant saisi. Garde tout de même un œil
          sur ce qu'il fait — c'est ton compte-titres réel.
        </Banner>
      </div>
    </Card>
  );
}

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
              Import / Extension → <em>Importer un export DEGIRO</em>. Le type de fichier est reconnu tout seul,
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

      <BrowserAgentCard />

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
            La courbe de valeur, le <strong>TWR</strong> (la performance débarrassée de l'effet de tes
            versements, donc comparable à un indice), tes plus-values réalisées — et tes
            <strong> dividendes</strong>, en bas de page, tirés du relevé de compte.
          </dd>
          <dt>Actus</dt>
          <dd>L'actualité des titres que tu détiens, filtrable, avec des liens vers les pages finance.</dd>
          <dt>Prompts IA</dt>
          <dd>Des questions d'analyse déjà remplies avec tes chiffres, à copier dans l'assistant de ton choix.</dd>
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
