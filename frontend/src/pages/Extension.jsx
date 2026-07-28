import { Card, Banner } from '../components/ui.jsx';
import ExtensionTokens from '../components/ExtensionTokens.jsx';

/**
 * Page dédiée à l'extension Chrome : à quoi elle sert, comment l'installer, et
 * quoi faire quand ça coince.
 *
 * Elle vivait auparavant dans un coin des Réglages, sous une section repliée —
 * autant dire nulle part pour qui découvre l'application. C'est pourtant le
 * chemin le plus court vers des données complètes : l'extension lit l'historique
 * des ordres, que les CSV ne donnent qu'au prix de plusieurs exports.
 *
 * Le contenu s'adresse à quelqu'un qui n'a jamais installé d'extension : aucune
 * étape n'est sous-entendue, et chaque panne connue a son remède.
 */

/** Un symptôme de la vraie vie, et quoi faire. */
const PANNES = [
  {
    symptome: 'Le panneau Diagnostic affiche « Script de contenu ✗ »',
    cause: "L'onglet DEGIRO était déjà ouvert quand tu as installé (ou rechargé) l'extension. Chrome n'active une extension que sur les onglets ouverts ensuite.",
    remede: "Reviens sur l'onglet DEGIRO et recharge la page avec F5, puis relance la capture.",
  },
  {
    symptome: '« Session DEGIRO introuvable »',
    cause: "L'extension lit les identifiants de ta session au passage, dans les appels que le site DEGIRO fait lui-même. Si la page vient juste de s'ouvrir, il n'y en a pas encore eu.",
    remede: 'Reste quelques secondes sur ton portefeuille DEGIRO, laisse la page se rafraîchir une fois, puis relance.',
  },
  {
    symptome: '« Session DEGIRO expirée » ou HTTP 401',
    cause: 'DEGIRO t’a déconnecté — les sessions sont courtes.',
    remede: 'Reconnecte-toi sur DEGIRO, puis relance la capture.',
  },
  {
    symptome: '« Jeton refusé »',
    cause: 'Le jeton a été révoqué, ou collé de travers (un espace en trop suffit).',
    remede: 'Génère-en un nouveau ci-dessus, et colle-le sans rien autour. Il commence toujours par dgx_.',
  },
  {
    symptome: '« Adresse de l’API ou jeton manquant »',
    cause: "Les réglages n'ont jamais été enregistrés. La fenêtre de l'extension se ferme dès que Chrome perd le focus — donc dès que tu viens ici chercher ton jeton.",
    remede: "Utilise le bouton « Épingler » en haut de la fenêtre de l'extension : elle se rouvre dans un onglet qui reste ouvert. Puis clique bien sur « Enregistrer ».",
  },
  {
    symptome: '« Serveur injoignable »',
    cause: "Chrome n'a pas l'autorisation d'appeler ce serveur — elle se demande au moment où tu enregistres les réglages.",
    remede: "Ré-enregistre les réglages dans l'extension et accepte la demande d'autorisation de Chrome.",
  },
  {
    symptome: "« Historique des transactions ✗ » (HTTP 502 ou autre)",
    cause: "Le service de reporting de DEGIRO refuse parfois une demande. L'extension réessaie alors année par année.",
    remede: "Sans gravité : le portefeuille est capturé quand même. Le diagnostic indique les années manquantes — relance plus tard pour les récupérer.",
  },
  {
    symptome: '« Contrôle du total ✗ » — un écart de quelques euros',
    cause: 'Le plus souvent un solde en devise (des dollars, typiquement, venant de dividendes américains). Le diagnostic le nomme désormais.',
    remede: "Rien à faire si le montant correspond à ce solde. Un écart important, lui, mérite d'être signalé.",
  },
  {
    symptome: "L'icône de l'extension a disparu de la barre",
    cause: 'Chrome range les extensions dans un menu « puzzle » à droite de la barre d’adresse.',
    remede: "Clique sur la pièce de puzzle, trouve « DEGIRO Analyzer », puis l'épingle pour la garder visible.",
  },
  {
    symptome: "Chrome affiche « Cette extension n'est pas listée sur le Chrome Web Store »",
    cause: "C'est normal : elle est installée en mode développeur, sans passer par le store.",
    remede: "Tu peux ignorer l'avertissement. Ne supprime pas le dossier décompressé : Chrome le relit à chaque démarrage.",
  },
];

export default function Extension() {
  return (
    <>
      <Card title="À quoi sert l'extension">
        <p style={{ marginTop: 0 }}>
          C'est le moyen le plus simple de tenir ton analyse à jour : un clic, et ton portefeuille
          DEGIRO arrive ici. <strong>Aucun fichier à exporter, rien à glisser-déposer.</strong>
        </p>
        <p className="muted">
          Elle lit ton portefeuille depuis la session DEGIRO <em>déjà ouverte</em> dans ton navigateur.
          Elle ne connaît ni ton mot de passe ni tes identifiants, et ne parle qu'à deux adresses :
          DEGIRO, et cette application.
        </p>
        <p className="muted">
          Elle apporte aussi ce que les exports CSV ne donnent pas facilement : l'<strong>historique
          complet de tes ordres</strong>, d'où viennent les positions fermées et les plus-values réalisées.
        </p>
        <Banner kind="info">
          Sur ordinateur uniquement (Chrome, Edge ou Brave). Sur téléphone, l'import d'un fichier CSV
          depuis <strong>Import / Réglages</strong> reste la solution.
        </Banner>
      </Card>

      <div style={{ marginTop: 16 }}>
        <ExtensionTokens />
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="Ça ne marche pas — que faire">
          <p className="muted" style={{ marginTop: 0 }}>
            Commence toujours par ouvrir le panneau <strong>Diagnostic</strong> de l'extension : chaque
            étape y est marquée ✓ ou ✗ avec son détail, ce qui désigne directement la ligne ci-dessous.
            Le bouton <strong>Copier le diagnostic</strong> te permet de me l'envoyer tel quel.
          </p>

          {/* Tout est déplié : quelqu'un qui cherche pourquoi ça bloque ne doit
              pas avoir à ouvrir dix accordéons pour trouver son symptôme. */}
          <dl className="trouble">
            {PANNES.map((p) => (
              <div key={p.symptome} className="trouble-item">
                <dt>{p.symptome}</dt>
                <dd>
                  <span className="muted">{p.cause}</span>
                  <div className="trouble-fix">→ {p.remede}</div>
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
