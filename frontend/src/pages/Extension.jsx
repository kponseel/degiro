import { Card, Banner } from '../components/ui.jsx';
import ExtensionTokens from '../components/ExtensionTokens.jsx';

/**
 * Guide de l'extension Chrome : à quoi elle sert, comment l'installer, et quoi
 * faire quand ça coince. Rendu par la page « Import / Extension », qui réunit
 * tous les moyens de faire entrer des données.
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
    cause: "Le service d'historique de DEGIRO refuse la demande — le plus souvent parce que DEGIRO a déplacé son adresse interne. L'extension essaie alors toute seule les adresses voisines connues.",
    remede: "Si ça persiste : dans l'onglet DEGIRO, ouvre Activité → Transactions, laisse la liste s'afficher, puis relance la capture. L'extension apprend l'adresse exacte que DEGIRO utilise et s'en souvient. Le portefeuille, lui, est capturé quand même — et tant que l'historique n'est pas complet, la capture suivante retentera tout.",
  },
  {
    symptome: '« Contrôle du total ✗ » — un écart de quelques euros ou plus',
    cause: "Un solde en devise non converti, ou une ligne dont la valeur DEGIRO est elle-même incohérente (opération sur titres mal répercutée, par exemple). Le diagnostic nomme désormais les lignes suspectes (« piste(s) : … »).",
    remede: "Vérifie la ligne nommée sur le site DEGIRO : si son cours y est aussi bizarre, l'écart vient de DEGIRO, pas de la capture. Le total enregistré ici reste celui affiché par DEGIRO.",
  },
  {
    symptome: "J'ai vidé mes données côté Analyzer, et l'historique ne revient pas",
    cause: "L'extension retient que ton historique complet a déjà été envoyé, et ne relit que la période récente — elle ne peut pas savoir que la base a été vidée.",
    remede: 'Révoque ton jeton ci-dessus et génères-en un nouveau : la prochaine capture refera la découverte complète.',
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
          complet de tes ordres</strong>, d'où viennent les positions fermées et les plus-values réalisées,
          et depuis peu ton <strong>relevé de compte</strong> — versements, dividendes, taxes et frais.
          Autrement dit : <strong>plus aucun fichier à exporter</strong>, même pour la performance réelle
          (TWR) et les dividendes.
        </p>
        <Banner kind="info">
          Sur ordinateur uniquement (Chrome, Edge ou Brave). Sur téléphone, l'import d'un fichier CSV
          — plus bas sur cette page — reste la solution.
        </Banner>
      </Card>

      <div style={{ marginTop: 16 }}>
        <ExtensionTokens />
      </div>

      {/* L'installation était décrite jusqu'au collage du jeton, et s'arrêtait là :
          rien ne disait comment capturer, ni où regarder ensuite. C'est pourtant
          le seul geste qu'on refera, chaque semaine. */}
      <div style={{ marginTop: 16 }}>
        <Card title="S'en servir — le geste à retenir">
          <p className="muted" style={{ marginTop: 0 }}>
            L'installation ne se fait qu'une fois. Ensuite, mettre à jour ton analyse tient en
            quatre gestes, à refaire quand tu veux.
          </p>

          <ol className="ext-instr">
            <li>
              <strong>Ouvre <code>trader.degiro.nl</code> et connecte-toi.</strong>
              <div className="muted">
                L'extension travaille à partir de cette session : sans elle, elle n'a accès à rien.
              </div>
            </li>
            <li>
              <strong>Va sur ton portefeuille et laisse la page s'afficher quelques secondes.</strong>
              <div className="muted">
                L'extension récupère les identifiants de session au passage, dans les appels que le
                site DEGIRO fait lui-même. Sur une page à peine ouverte, il n'y en a pas encore eu.
              </div>
            </li>
            <li>
              <strong>Clique sur l'icône de l'extension</strong>, puis sur
              <strong> « Capturer mon portefeuille »</strong>.
              <div className="muted">
                Quelques secondes : elle lit tes positions, tes positions fermées et l'historique de
                tes ordres, puis envoie le tout ici.
              </div>
            </li>
            <li>
              <strong>Attends le message vert</strong> — par exemple
              «&nbsp;Envoyé : 27 positions, 412 ordres, 6 794 mouvements, 85&nbsp;946&nbsp;€&nbsp;».
              <div className="muted">
                Un message rouge&nbsp;? Ouvre le panneau <strong>Diagnostic</strong> juste en dessous :
                la section suivante explique chaque cas.
              </div>
            </li>
          </ol>

          <p style={{ marginTop: 12 }}>
            <strong>Reviens ensuite ici</strong> : tes pages Portefeuille, Performance et Exposition
            sont à jour. Rien d'autre à faire.
          </p>

          <Banner kind="info">
            Capture aussi souvent que tu veux — une par semaine suffit à suivre l'évolution. Deux
            captures identiques ne créent pas de doublon&nbsp;: l'extension te répondra simplement
            «&nbsp;déjà enregistré&nbsp;». Et si tu gardes la fenêtre épinglée dans un onglet, la
            capture se lance en deux clics.
          </Banner>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
            La première capture retrouve toute seule ta première année chez DEGIRO et lit l'historique
            complet de tes ordres. Les suivantes ne relisent que la période récente&nbsp;: le passé ne
            change pas, et DEGIRO n'est pas sollicité pour rien.
          </p>
        </Card>
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
