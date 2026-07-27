# Extension Chrome — capture du portefeuille

Envoie ton portefeuille DEGIRO vers ton instance DEGIRO Analyzer, en un clic,
depuis la session DEGIRO que tu as **déjà ouverte** dans ton navigateur.

> **Statut : à valider en conditions réelles.** L'API interne de DEGIRO n'est pas
> publique et n'est pas documentée. Le format lu ici correspond à celui décrit
> par la communauté, et il est couvert par des tests, mais il n'a pas encore été
> confronté à un vrai compte. C'est exactement pour ça que le popup embarque un
> panneau de diagnostic : en cas d'échec, il dit à quelle étape ça s'arrête.

## Installation

1. Ouvre `chrome://extensions` et active le **Mode développeur** (en haut à droite).
2. **Charger l'extension non empaquetée** → sélectionne ce dossier `extension/`.
3. Dans l'Analyzer : **Réglages → Extension Chrome** → *Générer un jeton*, puis copie-le
   (il n'est affiché qu'une seule fois).
4. Clique sur l'icône de l'extension, renseigne l'adresse de ton Analyzer et colle le jeton,
   puis **Enregistrer**. Chrome demandera l'autorisation d'appeler ce serveur — accepte.
   *(Le popup se referme pendant la demande : rouvre-le, les réglages sont conservés.)*

## Utilisation

1. Ouvre `trader.degiro.nl` et connecte-toi.
2. Laisse la page chargée quelques secondes — l'extension attend que l'application
   DEGIRO fasse ses propres appels pour y lire les identifiants de session.
3. Clique sur l'icône de l'extension → **Capturer mon portefeuille**.

Une capture par jour suffit : l'API ne garde qu'un instantané par jour et par
source, et rejouer la même capture ne crée pas de doublon.

Chaque capture envoie **deux choses** :

- **l'instantané du portefeuille** — positions détenues, positions **soldées**
  (quantité nulle) et liquidités ;
- **l'historique complet des ordres** (achats/ventes) depuis l'ouverture du
  compte, qui alimente la vue *Gains, pertes & fiscalité* : plus-values réalisées
  des positions fermées. Les ordres sont dédoublonnés par leur identifiant DEGIRO
  et se confondent avec ceux d'un import `Transactions.csv` — importer les deux ne
  double rien.

> Les **dividendes** (et retenues à la source) ne figurent pas dans l'historique
> des ordres : pour les intégrer à la vue fiscale, importe le `Account.csv` (relevé
> de compte) depuis l'Analyzer.

## Ce qui circule, et ce qui ne circule pas

- **Aucun identifiant DEGIRO n'est demandé, lu ou stocké.** Ni mot de passe, ni code.
- Les appels à DEGIRO partent **de l'onglet lui-même**, avec ses propres cookies.
  L'extension ne se connecte jamais à ta place.
- Le `sessionId` de ta session en cours ne sert qu'à ces appels, dans l'onglet, et
  n'est jamais envoyé à l'Analyzer ni stocké sur le disque.
- Le jeton de l'Analyzer vit dans le stockage local de l'extension et ne s'approche
  jamais du contexte de la page DEGIRO.
- Seules les données de portefeuille partent vers **ton** Analyzer : ISIN, quantités,
  prix, valeurs, plus/moins-values, liquidités, et l'historique des ordres (dates,
  quantités, montants).
- Permissions demandées : `storage`, l'accès à `trader.degiro.nl`, et l'accès au seul
  serveur que tu as toi-même saisi. Pas d'accès aux autres onglets.

## Comment ça marche

```
inject.js    (contexte de la page)  lit sessionId + intAccount dans les URLs
                                    que l'application DEGIRO appelle elle-même
      │ postMessage (sens unique)
content.js   (monde isolé)          exécute les requêtes DEGIRO dans l'onglet,
                                    donc avec les cookies de la session
      │ chrome.runtime
background.js (service worker)      lit le portefeuille (/v5/update) ET l'historique
                                    des ordres (/reporting/.../transactions),
                                    traduit vers le schéma de l'API, POST /api/ingest
                                    avec le jeton « dgx_ »
```

Les identifiants ne sont pas devinés : l'application DEGIRO les place dans ses
propres URLs (`/v5/update/<intAccount>;jsessionid=<sessionId>`), il suffit de les
y lire au passage. Si rien n'a encore été appelé au moment du clic, l'extension
retombe sur `/pa/secure/client`.

## Quand ça ne marche pas

Ouvre le panneau **Diagnostic** du popup : chaque étape est marquée ✓ ou ✗.
Le bouton *Copier le diagnostic* met le tout dans le presse-papiers.

| Étape en échec | Ce que ça veut dire |
|---|---|
| **Onglet DEGIRO** | Aucun onglet `trader.degiro.nl` ouvert — ou la page n'a pas été rechargée depuis l'installation de l'extension. |
| **Script de contenu** | L'onglet a été ouvert avant l'installation : recharge-le avec F5. |
| **Session DEGIRO** | Les identifiants n'ont pas encore été vus. Reste sur l'onglet quelques secondes, laisse l'application se rafraîchir, puis relance. |
| **Lecture du portefeuille** | Session expirée (reconnecte-toi), ou DEGIRO a changé son endpoint. |
| **Historique des transactions** | L'endpoint `reporting/.../transactions` a changé ou a refusé la lecture. Non bloquant : le portefeuille est quand même capturé, mais sans les plus-values réalisées. |
| **Résolution des ISIN** | L'endpoint `products/info` a changé de forme : les positions sont là, mais sans ISIN elles ne peuvent pas être rattachées. |
| **Contrôle du total** | Notre somme s'écarte de plus d'un euro du total affiché par DEGIRO : un champ est mal lu. **Les chiffres importés sont alors à considérer comme faux** — signale l'écart plutôt que de t'y fier. |
| **Envoi à Analyzer** | Jeton révoqué ou mal collé, ou serveur injoignable. |

## Pour le développement

La logique de traduction (`src/degiro.js`) et le repérage de session
(`src/session.js`) sont des modules purs, sans API navigateur : ce sont eux qui
cassent en premier si DEGIRO change quelque chose, et ce sont eux qui sont
testés — `npm test`, fichier `backend/test/extensionMapping.test.js`. Les tests
couvrent aussi le trajet complet jusqu'au portefeuille affiché, avec un vrai
jeton d'extension.

Si le format DEGIRO change, corrige `degiro.js` et ajuste les tests : le reste
de l'extension n'a normalement pas besoin d'y toucher.
