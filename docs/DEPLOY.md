# Déploiement sur Hostinger

L'app est un monorepo Node.js **mono-process** : Express sert l'API (`/api/*`) et le
build React. Hostinger déploie depuis la branche **`main`**.

## Prérequis GitHub

Hostinger n'importe que les dépôts auxquels son **application GitHub** a accès. Si
`kponseel/degiro` n'apparaît pas dans la liste d'import :

1. https://github.com/settings/installations → **Hostinger** → **Configure**
2. Section **Repository access** → ajouter **kponseel/degiro** (ou « All repositories »)
3. **Save**, puis rafraîchir (↻) l'écran d'import Hostinger.

> Le dépôt doit contenir un `package.json` à la racine sur la branche déployée
> (`main`) — sinon Hostinger propose seulement un site statique.

## Configuration du site

- Type : **Web App Node.js** (« Déployez l'application web »), Node **20+**.
- Dépôt : `kponseel/degiro`, branche **`main`**, répertoire racine.
- **Build** : `npm install && npm run build`
- **Démarrage** : `npm start`  (→ `node backend/src/server.js`, port `process.env.PORT`)

## Base de données

Créer une base **MySQL** (menu Bases de données) et noter l'hôte affiché
(`localhost` ou `srvXXXX.hstgr.io`). Les tables sont créées **automatiquement au
démarrage** (migrations idempotentes) — aucune exécution SQL manuelle nécessaire.

## Variables d'environnement (interface Hostinger, jamais dans le code)

| Variable | Valeur |
|---|---|
| `DB_HOST` | hôte MySQL Hostinger |
| `DB_PORT` | `3306` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | identifiants de la base créée |
| `API_TOKEN` | secret d'accès — générer avec `openssl rand -hex 32` |
| `OPENFIGI_API_KEY` | (optionnel) clé gratuite openfigi.com pour l'enrichissement |

## Premier accès

Ouvrir `https://degiro.estim.pro`, saisir l'`API_TOKEN`, puis **Import / Réglages**
→ déposer son `Portfolio.csv` (toute langue) → **Lancer l'enrichissement**.

Vérifier la santé : `GET /api/health` doit renvoyer `{"status":"ok","db":"up"}`.
Si `db` est `down`, revoir les variables `DB_*` (et l'autorisation Remote MySQL,
restreinte à l'IP du serveur — jamais « Any Host »).
