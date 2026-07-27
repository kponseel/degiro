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

- Type : **Web App Node.js** (« Déployez l'application web »), Node **22** (minimum 20.19 — voir `.nvmrc` ; la chaîne de build Vite refuse les versions antérieures).
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
| `API_TOKEN` | jeton de service (accès propriétaire / scripts) — `openssl rand -hex 32` |
| `OWNER_EMAIL` | **ton** email : devient l'utilisateur #1 et hérite des données existantes |
| `ADMIN_EMAIL` | email de l'administrateur (page Administration) — à défaut, `OWNER_EMAIL` |
| `APP_URL` | **OBLIGATOIRE** — `https://degiro.estim.pro` (sans slash final). Le démarrage est **refusé** si elle manque : sans elle, la base du lien de connexion se déduirait de l'en-tête `Host` envoyé par le client, ce qui permettrait de faire parvenir à une victime un lien valide pointant ailleurs. |
| `ALLOWED_EMAILS` | (optionnel) liste blanche d'inscription, adresses séparées par des virgules. Voir aussi le **code d'invitation**, réglable depuis Administration. |
| `NODE_ENV` | (optionnel) inutile : les protections — cookie `Secure`, refus d'exposer le lien — sont actives **par défaut** et ne s'assouplissent que sur `development`/`test` explicites. |
| `SMTP_HOST` | `smtp.hostinger.com` |
| `SMTP_PORT` | `587` (STARTTLS) ou `465` (TLS) |
| `SMTP_USER` | la boîte email du domaine (ex. `noreply@estim.pro`) |
| `SMTP_PASS` | mot de passe de cette boîte |
| `MAIL_FROM` | `DEGIRO Analyzer <noreply@estim.pro>` |
| `SESSION_TTL_DAYS` / `MAGIC_LINK_TTL_MIN` | (optionnel) défauts `30` / `15` |
| `OPENFIGI_API_KEY` | (optionnel) clé gratuite openfigi.com pour l'enrichissement |

## Code d'invitation

Créer un compte exige un code, **modifiable depuis Administration** sans
redéploiement. Valeur initiale `kev2026` (posée par la migration 010).

Il n'est demandé qu'à la **création** : les inscrits existants se connectent sans
lui. Le vider rouvre l'inscription à tous.

## Comptes & connexion (lien magique)

L'app est **multi-utilisateurs** (~5-10 amis). Connexion **sans mot de passe** :
on saisit son email (+ un pseudo à la première connexion), on reçoit un lien
valable 15 min, un clic ouvre une session (cookie httpOnly, 30 jours).

**Email via Hostinger** :
1. hPanel → **Emails** → créer une boîte, ex. `noreply@estim.pro`.
2. Renseigner `SMTP_HOST=smtp.hostinger.com`, `SMTP_USER=noreply@estim.pro`,
   `SMTP_PASS=…`, `SMTP_PORT=587`, `MAIL_FROM` (voir table ci-dessus).
3. Vérifier que **SPF/DKIM** du domaine sont actifs (hPanel → Emails → configuration)
   pour éviter le dossier spam.

> **SMTP est indispensable en production.** Sans lui, l'application démarre (avec
> un avertissement dans les journaux) mais **personne ne peut se connecter** :
> chaque demande de lien renvoie un 503 explicite. Le repli « mode dev », où le
> lien était renvoyé dans la réponse HTTP, n'existe plus hors développement — il
> constituait une prise de compte ouverte à quiconque connaît une adresse email.

## Premier accès

Ouvrir `https://degiro.estim.pro` → saisir ton email (celui de `OWNER_EMAIL`) +
un pseudo → cliquer le lien reçu → **Import / Réglages** → déposer `Portfolio.csv`
(toute langue) → **Lancer l'enrichissement**. Tes amis se connectent pareil avec
leur propre email ; chacun ne voit que ses données.

Vérifier la santé : `GET /api/health` doit renvoyer `{"status":"ok","db":"up",…}`.
- `db: down` → revoir les `DB_*` (et l'autorisation Remote MySQL, restreinte à l'IP
  du serveur — jamais « Any Host »).
- Le diagnostic détaillé (code d'erreur MySQL, hôte refusé, état SMTP) n'est plus
  public : il renseignait un attaquant sur l'infrastructure. Pour l'obtenir :
  `curl -H "Authorization: Bearer $API_TOKEN" https://degiro.estim.pro/api/health`.
- Si la connexion échoue alors que `db: up`, vérifier `email` dans cette réponse
  authentifiée : `dev` signifie que SMTP n'est pas pris en compte.
