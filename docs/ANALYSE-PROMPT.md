# Analyse du prompt « DEGIRO Analyzer »

> Analyse critique du prompt de démarrage (`PROMPTestimClaudeCode.md`) avant toute
> génération de code. Le plan de développement qui en découle est dans
> [`PLAN.md`](./PLAN.md).

## Verdict global

La vision produit est claire et l'architecture générale (extension Chrome sur session
authentifiée + backend Express + MySQL + React, CSV en secours) est le bon choix pour
DEGIRO, qui n'a effectivement pas d'API publique. Mais le prompt **ne doit pas être
donné tel quel à Claude Code** : il contient 7 problèmes bloquants, dont 2 qui rendent
les deux features phares (TWR et look-through ETF) mathématiquement incalculables avec
le modèle de données proposé, et 1 faille de sécurité majeure (API publique sans
authentification servant des données patrimoniales). Tout est corrigeable — c'est
l'objet du plan.

## Ce que le prompt fait bien

- **Deux voies d'acquisition** (extension + CSV) : la bonne stratégie. En se greffant
  sur la session authentifiée par l'humain, l'extension échappe au captcha/2FA qui
  casse régulièrement les libs de login automatisé (principal vecteur de rupture des
  clients DEGIRO non officiels).
- **Hygiène des secrets** : `.gitignore` avant le premier commit, `.env.example`,
  secrets uniquement en variables d'env Hostinger, identifiants DEGIRO jamais côté
  serveur.
- **Stockage du `raw_json`** dans `snapshots` : bon réflexe de résilience face aux
  changements de l'API interne.
- **Déployer dès le squelette** : à garder, et même à généraliser (déploiement vérifié
  à chaque milestone).

## Problèmes bloquants (P0 — à corriger avant d'écrire du code)

### 1. La capture décrite ne peut pas fonctionner telle quelle

« `content.js` lit le JSON du portefeuille » est techniquement inexact : un content
script Manifest V3 tourne dans un monde isolé et ne voit ni les réponses fetch/XHR de
la page, ni les corps de réponses via `chrome.webRequest`. Deux techniques réelles :

- **(a) Hook en monde MAIN** : content script déclaré `"world": "MAIN"` (Chrome 111+)
  qui patche `window.fetch`/`XMLHttpRequest` pour intercepter les réponses de
  `/trading/secure/v5/update*`, relayées ensuite au service worker. Capture passive —
  ne se déclenche que si la page fait l'appel.
- **(b) Replay same-origin** : le content script (monde isolé) refait les appels en
  `fetch` same-origin sur `trader.degiro.nl` (cookies envoyés automatiquement). Il faut
  récupérer `intAccount` et `sessionId` (via `/login/secure/config` puis
  `/pa/secure/client`) car l'endpoint s'appelle
  `/trading/secure/v5/update/{intAccount};jsessionid={sessionId}`. Capture à la
  demande — compatible avec un bouton « Capturer maintenant ».

**Deuxième piège** : la réponse de `/trading/secure/v5/update` est un format
`name/value` imbriqué (pas du « JSON propre ») et identifie les positions par
`productId` DEGIRO, **pas par ISIN**. Or tout le pipeline (positions, enrichissement,
look-through) repose sur l'ISIN. Il faut un second appel à
`/product_search/secure/v5/products/info` (POST de la liste des productIds) pour
obtenir ISIN, symbole, nom, devise et type de produit, et faire la jointure
`productId → ISIN` avant le POST vers le backend.

À noter : les libs Node existantes (pladaria/degiro, degiro-api) sont abandonnées ; la
référence vivante des endpoints est [degiro-connector](https://github.com/Chavithra/degiro-connector)
(Python). Il faudra écrire le client soi-même.

### 2. API publique sans aucune authentification

Le contrat (`POST /ingest`, `GET /portfolio`, `/snapshots`, `/exposure`) n'a aucun
mécanisme d'auth alors qu'il sera exposé sur `degiro.estim.pro` : n'importe qui peut
lire l'intégralité du patrimoine ou empoisonner l'historique avec de faux snapshots.
L'URL ne restera pas « secrète » : les sous-domaines nouvellement certifiés sont
scannés en permanence via les logs Certificate Transparency. **Un bearer token partagé
sur TOUTES les routes (GET compris) est un prérequis absolu.**

### 3. TWR incalculable avec le modèle de données proposé

Le TWR exige les valorisations ET les flux externes (dépôts/retraits) pour borner les
sous-périodes chaînées géométriquement. Le schéma (snapshots/positions/isin_ref) ne
stocke aucun flux : un dépôt de 1 000 € serait compté comme +1 000 € de performance.
Les flux sont dans le relevé de compte DEGIRO (**Account.csv**), que le prompt ne
mentionne même pas — il faut une table `transactions`/`cash_flows` et un parseur
Account.csv. Le TWR devra en outre être implémenté pour intervalles **irréguliers**
(Modified Dietz par sous-période, chaîné), car les snapshots auront des trous.

### 4. Look-through ETF : aucune source de données ni table

La feature « différenciante » n'a ni table `etf_holdings` ni source de compositions.
Yahoo Finance et OpenFIGI ne fournissent PAS les compositions complètes d'ETF. Sources
réelles : fichiers publiés par les émetteurs (iShares : CSV quotidien à URL stable ;
Vanguard : fichier téléchargeable ; Amundi : XLSX mensuel), pas d'API gratuite
unifiée. C'est le plus gros chantier du projet (L/XL), pas un sous-point du dashboard.

### 5. Le frontend ne serait jamais servi en production

Hostinger « Web App Node.js » = **un seul process** (`node backend/src/server.js`).
Rien dans le prompt ne dit comment le build React est produit ni servi, et le
`.gitignore` exclut `dist/`. En l'état, `degiro.estim.pro` servirait l'API mais aucune
UI. Il faut : npm workspaces, script racine `build` (build du frontend), Express qui
sert `frontend/dist` en statique avec fallback SPA, routes API préfixées `/api/*`, et
`app.listen(process.env.PORT || 3000)` (port injecté par la plateforme).

### 6. Ordre de développement inversé

Le prompt construit l'extension (étape 2) et le parseur CSV (étape 3) **avant** le
backend `/ingest` et la DB (étape 4) : l'extension n'a nulle part où poster, le
parseur nulle part où stocker. Rien n'est testable de bout en bout avant l'étape 4 et
la première valeur utilisateur n'arrive qu'à l'étape 6/7. L'ordre corrigé (voir
PLAN.md) atteint « je vois mon portefeuille réel enrichi » au 4ᵉ milestone, sans
extension, via l'export CSV manuel.

### 7. Repo `estim` inexistant

Le prompt demande de cloner `kponseel/estim` ; le repo réel est **`kponseel/degiro`**
(vérifié : remote origin de ce dépôt). La toute première commande du prompt échoue.
Le domaine `degiro.estim.pro` reste cohérent (sous-domaine de estim.pro).

## Ambiguïtés à trancher (arbitrages proposés)

| Sujet | Constat | Décision proposée |
|---|---|---|
| Séparateur CSV DEGIRO | Le prompt dit « ; », plusieurs sources disent « , » avec nombres quotés (`"1234,56"`) ; les parseurs open source font du sniffing — le format varie selon langue/export | **Sniffer le délimiteur** sur la ligne d'en-tête + valider sur les **exports réels du compte** (à committer anonymisés comme fixtures) avant d'écrire `csvParser.js` |
| Technique de capture extension | Hook MAIN world (passif) vs replay same-origin (à la demande) | **Replay same-origin en voie principale** (compatible bouton « Capturer maintenant »), hook MAIN en plan B documenté ; un spike DevTools tranche définitivement avant M4 |
| Jobs quotidiens (benchmark, FX, purge) | Pas de scheduler fiable sur le runtime managé Hostinger | **Fetch-on-demand avec cache** : au premier GET du jour le backend rafraîchit puis sert le cache. Zéro dépendance à un cron |
| Fichiers CSV concernés | Le prompt parle d'« import CSV » générique | Trois exports distincts : **Transactions.csv** (ordres → positions/PRU), **Account.csv** (flux, dividendes, frais → TWR), **Portfolio.csv** (photo de contrôle, sans P/L) |

## Décisions de périmètre v1 (à acter pour éviter le scope creep)

- **Univers de produits** : actions, ETF, cash EUR. Tout autre `productType`
  (obligations, options, warrants…) est stocké tel quel et affiché en catégorie
  « Autres », sans enrichissement ni look-through.
- **P/L** : v1 = P/L **latent** des positions ouvertes uniquement (étiqueté ainsi dans
  l'UI). P/L réalisé (positions soldées, reconstruit depuis Transactions.csv) = v2.
- **Multi-comptes** : mono-compte assumé, mais colonne `account_id TINYINT DEFAULT 1`
  posée dès le départ (le retrofit serait pénible).
- **Fiscalité** (IFU, 3916-bis, PFU) : explicitement **hors périmètre**.
- **Dividendes** : v1 = dividendes **perçus** 12 mois glissants (Account.csv), en
  précisant brut vs net encaissé ; projection forward = v2.
- **Snapshots** : capture opportuniste (à chaque visite DEGIRO + bouton manuel),
  dédupliquée à **1 snapshot conservé par jour civil** (Europe/Paris, stockage UTC),
  préséance `extension > csv` à date égale. Pas de promesse de « quotidien » : les
  courbes tolèrent les trous, et l'historique peut être densifié plus tard par
  reconstruction (transactions + prix EOD).

## Autres constats importants

- **Enrichissement ISIN** : OpenFIGI ne fournit **ni secteur GICS ni pays** (juste
  ISIN→ticker). Chaîne à 2 étages : OpenFIGI (ISIN→ticker) puis Yahoo Finance
  `assetProfile` (ticker→secteur/pays, non officiel, fragile), cache agressif dans
  `isin_ref` (TTL 6-12 mois) + **écran d'édition manuelle** (pour 20-40 lignes,
  corriger à la main coûte moins cher que fiabiliser le scraping). Devise et classe
  d'actifs viennent du JSON DEGIRO, pas d'une API.
- **Benchmark** : pas de série MSCI gratuite et licite → **ETF proxy en EUR**
  (IWDA.AS pour MSCI World, CSPX pour S&P 500) via Yahoo, stocké en base
  (`benchmark_prices`). Comparaison EUR vs EUR = effet de change et dividendes inclus.
- **Effet devise** : taux BCE historiques gratuits et officiels via frankfurter.app,
  stockés en `fx_rates` ; décomposition `r_EUR − r_local` par position.
- **Attribution** : renoncer à Brinson complet ; version 2 buckets (ETF vs titres
  vifs via `productType`), TWR et contribution par bucket.
- **Corporate actions** (splits, changements d'ISIN, spin-offs) : ignorées partout
  alors qu'elles cassent PRU et séries historiques. Prévoir les types d'événements
  dans l'ENUM de `transactions`, une correspondance `ancien_isin → nouvel_isin`
  (`isin_ref.superseded_by`), et une alerte si la quantité change sans transaction.
- **Tests & CI absents** alors que Hostinger auto-déploie au push : vitest + fixtures
  CSV réelles anonymisées + oracle externe pour le TWR (Portfolio Performance ou
  tableur de contrôle) + GitHub Actions avant déploiement.
- **Boucle de dev locale non spécifiée** : MySQL local dédié (jamais la base de prod
  comme base de dev), `seed.sql`, `npm run dev` cross-platform (concurrently :
  nodemon + Vite avec proxy `/api`), `.gitattributes` (CRLF Windows).
- **Pages frontend manquantes** : une page **Import / Réglages** (upload des 3 CSV
  avec prévisualisation, saisie du token, édition d'`isin_ref`, état de santé).
- **Extension en mode unpacked** : ID d'extension instable → préférer l'auth par
  token aux allowlists CORS par origin ; `host_permissions` sur
  `https://trader.degiro.nl/*` et `https://degiro.estim.pro/*`.
- **Divers schéma/API** : `GET /exposure` au contrat mais absent des routes ; aucun
  index (`captured_at`, `isin`) ; pas d'idempotence ni de `schema_version` sur
  `/ingest` ; `utf8mb4`/InnoDB non spécifiés ; pas de healthcheck ; pas de stratégie
  de rétention du `raw_json` ; pas de rate limiting ni de `trust proxy`.
- **Risque ToS DEGIRO** : les conditions interdisent l'accès automatisé ; en lecture
  seule, basse fréquence, sans login automatisé ni identifiants stockés, le risque
  pratique est faible mais à documenter dans le README (pas de polling agressif).
