# DEGIRO Analyzer

Web app perso d'analyse de portefeuille DEGIRO : exposition et diversification
(dont look-through ETF), performance (TWR vs benchmark), risque et historique —
au-delà de ce que montre l'interface DEGIRO.

> **Spécification de référence :** [`docs/PLAN.md`](docs/PLAN.md) (décisions, schéma,
> contrat d'API, milestones) et [`docs/ANALYSE-PROMPT.md`](docs/ANALYSE-PROMPT.md)
> (analyse critique du cahier des charges initial).

## État — MVP fonctionnel (M0 → M3)

Monorepo npm workspaces. Un seul process en production : Express sert l'API sous
`/api/*` **et** le build React (`frontend/dist`). Point d'entrée
`node backend/src/server.js`, port `process.env.PORT || 3000`.

Ce qui marche aujourd'hui, de bout en bout :

- **Import** de ses exports DEGIRO (Portfolio / Relevé de compte / Transactions)
  avec prévisualisation, ou ingestion JSON via l'extension (à venir).
- **Vue d'ensemble** : valeur, liquidités, P/L latent, concentration top‑5 + alerte.
- **Exposition** : répartitions par devise, classe d'actifs, secteur et pays.
- **Historique** : courbe de valeur totale par jour.
- **Enrichissement ISIN** (pays déterministe + OpenFIGI best‑effort) avec
  correction manuelle.
- **Sécurité** : jeton bearer sur toutes les routes sauf `/api/health`.

### API

| Méthode | Route | Rôle |
|--------|-------|------|
| GET | `/api/health` | Santé (public) |
| POST | `/api/ingest` | Ingestion d'un snapshot (JSON), idempotent |
| POST | `/api/ingest/csv` | Import CSV (multipart), modes `preview`/`commit` |
| GET | `/api/portfolio` | Dernier snapshot enrichi |
| GET | `/api/snapshots` | Série de valeur par jour |
| GET | `/api/exposure` | Répartitions devise/classe/secteur/pays |
| POST | `/api/enrich` | Enrichit les ISIN du dernier snapshot |
| GET/PUT | `/api/isin-ref[/:isin]` | Références ISIN + correction manuelle |

Runner de migrations idempotent (`npm run migrate`) ; CI GitHub Actions
(lint → migrations → tests → build, avec un service MySQL).

### Reste à faire (post‑MVP, voir `docs/PLAN.md`)

L'extension Chrome (M4) est écrite et testée hors navigateur, mais **reste à
valider sur un compte DEGIRO réel** — voir [`extension/README.md`](extension/README.md).

## Architecture

```
extension/   Extension Chrome MV3 — capture du portefeuille depuis la session ouverte
backend/     Express + MySQL (mysql2). Sert aussi le build React en prod.
frontend/    React + Vite + Recharts.
docs/        Spécification et analyse.
```

## Développement local

Prérequis : Node 20+ et un MySQL local dédié (**jamais** la base de prod).

```bash
npm install                      # installe les 3 workspaces
cp .env.example backend/.env     # renseigner les identifiants du MySQL local
npm run migrate                  # crée les tables
npm run dev                      # API (:3000) + frontend Vite (:5173, proxy /api)
```

Autres scripts : `npm run lint`, `npm test`, `npm run build`, `npm start`
(sert le build sur le port configuré).

## Déploiement Hostinger (« Web App Node.js »)

Un seul process. Renseigner dans l'interface Hostinger :

- **Build** : `npm install && npm run build`
- **Démarrage** : `npm start`
- **Variables d'environnement** : voir [`.env.example`](.env.example) — `DB_*`,
  `API_TOKEN`, `OPENFIGI_API_KEY`. Le mot de passe MySQL se saisit uniquement ici,
  jamais dans le code.

Les migrations s'appliquent via `npm run migrate` (ou phpMyAdmin pour inspecter).

## Sécurité

- Identifiants DEGIRO : jamais côté serveur. La capture se fait dans la session
  navigateur déjà authentifiée ; seules les données de portefeuille sont envoyées.
- Secrets uniquement dans les variables d'environnement Hostinger, jamais commités.
- Toutes les routes de données exigent une authentification. Trois voies :
  cookie de session (lien magique), **jeton d'extension** par utilisateur, ou
  `API_TOKEN` (propriétaire, usage administratif).

### Jetons d'extension

L'extension Chrome tourne sur `trader.degiro.nl` : le cookie de session
(`SameSite=Lax`) n'est donc pas envoyé vers l'API. Chaque utilisateur génère son
propre jeton dans **Réglages → Extension Chrome**, et l'extension l'envoie en
`Authorization: Bearer dgx_…`.

- Le jeton n'est affiché en clair **qu'à la création** ; seul son SHA‑256 est stocké.
- Il est révocable à tout moment, et la suppression du compte révoque les siens.
- Il donne accès aux données de son propriétaire uniquement, et **ne permet pas**
  de gérer les jetons (pas d'escalade : cette gestion exige une vraie session).
- Chaque usage incrémente un compteur et horodate le dernier envoi, ce qui permet
  de repérer un jeton inutilisé ou anormalement actif.

## Note sur l'accès aux données DEGIRO

Usage strictement personnel, en lecture seule, sur son propre compte, à faible
volumétrie (une capture par jour), sans login automatisé ni stockage d'identifiants.
L'API interne DEGIRO n'est pas officielle : le parseur CSV sert de voie de secours.
