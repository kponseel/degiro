# DEGIRO Analyzer

Web app perso d'analyse de portefeuille DEGIRO : exposition et diversification
(dont look-through ETF), performance (TWR vs benchmark), risque et historique —
au-delà de ce que montre l'interface DEGIRO.

> **Spécification de référence :** [`docs/PLAN.md`](docs/PLAN.md) (décisions, schéma,
> contrat d'API, milestones) et [`docs/ANALYSE-PROMPT.md`](docs/ANALYSE-PROMPT.md)
> (analyse critique du cahier des charges initial).

## État — M0 (squelette déployable)

Monorepo npm workspaces. Un seul process en production : Express sert l'API sous
`/api/*` **et** le build React (`frontend/dist`). Point d'entrée
`node backend/src/server.js`, port `process.env.PORT || 3000`.

- `GET /api/health` → `{ status, db, version, ts }` (sans authentification).
- Runner de migrations idempotent (`npm run migrate`) appliquant `backend/migrations/*.sql`.
- CI GitHub Actions : lint → migrations → tests → build, avec un service MySQL.

## Architecture

```
extension/   Extension Chrome MV3 — capture du portefeuille (arrive au M4)
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
- L'API sera protégée par un jeton bearer sur toutes les routes (M1).

## Note sur l'accès aux données DEGIRO

Usage strictement personnel, en lecture seule, sur son propre compte, à faible
volumétrie (une capture par jour), sans login automatisé ni stockage d'identifiants.
L'API interne DEGIRO n'est pas officielle : le parseur CSV sert de voie de secours.
