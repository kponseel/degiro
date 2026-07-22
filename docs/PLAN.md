# DEGIRO Analyzer — Plan de développement

> Découle directement de l'[analyse du prompt](./ANALYSE-PROMPT.md). Ce document est
> la spec de référence du projet ; il remplace le prompt d'origine.

## Décisions actées

| # | Décision |
|---|---|
| D1 | Repo : `kponseel/degiro` (pas `estim`). Domaine : `degiro.estim.pro` (Hostinger « Web App Node.js »). |
| D2 | Monorepo npm workspaces `extension/` + `backend/` + `frontend/`. Un seul process en prod : Express sert l'API sous `/api/*` **et** le build React (`frontend/dist`, fallback SPA). `app.listen(process.env.PORT \|\| 3000)`. |
| D3 | Auth : bearer token unique (`API_TOKEN`, `openssl rand -hex 32`) vérifié par middleware global sur **toutes** les routes (`crypto.timingSafeEqual`). Extension : token en `chrome.storage.local` (page options). Frontend : saisie au premier accès, localStorage. |
| D4 | Capture extension : **replay same-origin** depuis le content script (`/pa/secure/client` → `intAccount`+`sessionId`, puis `/trading/secure/v5/update/{intAccount};jsessionid={sessionId}` + `/product_search/secure/v5/products/info` pour la jointure productId→ISIN). Hook fetch MAIN-world = plan B. Spike avant implémentation. |
| D5 | CSV : trois exports distincts (Transactions, Account, Portfolio), délimiteur **sniffé**, décimales à virgule, dates JJ-MM-AAAA, mapping d'en-têtes multilingue. Fixtures = exports réels anonymisés, committés. |
| D6 | Snapshots : capture opportuniste, dédupliquée à 1/jour civil (Europe/Paris, stockage UTC), idempotence par `capture_id` UUID + hash du payload, préséance extension > csv. |
| D7 | Jobs quotidiens (benchmark, FX, purge) : **fetch-on-demand avec cache**, pas de cron. |
| D8 | Benchmark : ETF proxy EUR (IWDA.AS / CSPX) stocké en `benchmark_prices`. FX : taux BCE via frankfurter.app dans `fx_rates`. |
| D9 | Périmètre v1 : actions + ETF + cash EUR ; P/L latent uniquement ; mono-compte (`account_id` posé en DB) ; fiscalité hors scope ; dividendes = perçus 12M glissants. |
| D10 | Qualité : vitest + fixtures réelles, CI GitHub Actions (lint + tests) avant tout déploiement, migrations SQL versionnées (pas de `schema.sql` brut), logs pino, jamais la base de prod en dev. |

## Architecture cible

```
Extension Chrome MV3 (unpacked)
  ├─ content.js (trader.degiro.nl) : replay same-origin des endpoints DEGIRO,
  │   jointure productId→ISIN, normalisation du payload
  ├─ background.js (service worker) : POST /api/ingest avec bearer token
  ├─ popup : bouton « Capturer maintenant », date de dernière capture, badge OK/KO
  └─ options : URL backend (https only) + token
       │ host_permissions: trader.degiro.nl/* , degiro.estim.pro/*
       ▼
Backend Node 20 / Express (un seul process, port injecté par Hostinger)
  ├─ middleware : auth bearer global, helmet, express.json({limit:'1mb'}),
  │   rate-limit (trust proxy), erreurs JSON centralisées, pino-http
  ├─ routes /api : ingest, ingest/csv (multipart), portfolio, snapshots,
  │   exposure, performance, attribution, risk, dividends, health
  ├─ services : degiroTransform (raw versionné → positions), csvParser (3 formats),
  │   enrich (OpenFIGI→ticker, Yahoo→secteur/pays, cache isin_ref),
  │   exposure (+ look-through), performance (Modified Dietz chaîné),
  │   marketData (benchmark + FX, fetch-on-demand + cache)
  ├─ db : pool mysql2, runner de migrations (migrations/*.sql + schema_migrations)
  └─ sert frontend/dist en statique + fallback SPA
       ▼
MySQL Hostinger (utf8mb4, InnoDB)
       ▼
Frontend React + Vite + Recharts
  └─ pages : Overview, Exposition, Historique, Attribution, Import/Réglages
```

## Schéma DB v1 (point de départ des migrations)

```sql
-- 001_init.sql — toutes les tables ENGINE=InnoDB DEFAULT CHARSET=utf8mb4

CREATE TABLE snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id TINYINT NOT NULL DEFAULT 1,
  captured_at DATETIME NOT NULL,            -- UTC
  snapshot_date DATE NOT NULL,              -- jour civil Europe/Paris
  source ENUM('extension','csv') NOT NULL,
  capture_id CHAR(36) NOT NULL,             -- UUID client (idempotence)
  schema_version SMALLINT NOT NULL DEFAULT 1,
  total_value_eur DECIMAL(18,2),
  cash_eur DECIMAL(18,2),
  raw_json JSON,                            -- purgeable après 90 j
  UNIQUE KEY uq_capture (capture_id),
  UNIQUE KEY uq_day_source (account_id, snapshot_date, source),
  KEY idx_captured (captured_at)
);

CREATE TABLE positions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id INT NOT NULL,
  isin CHAR(12) NOT NULL,
  symbol VARCHAR(20), name VARCHAR(255),
  product_type VARCHAR(20),                 -- STOCK / ETF / autre (source DEGIRO)
  qty DECIMAL(18,6), price DECIMAL(18,6),
  currency CHAR(3),
  fx_rate DECIMAL(12,6),                    -- taux devise→EUR au snapshot
  break_even_price DECIMAL(18,6),           -- PRU DEGIRO
  value_eur DECIMAL(18,2),
  pl_eur DECIMAL(18,2), pl_day_eur DECIMAL(18,2),
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
  KEY idx_isin (isin)
);

CREATE TABLE transactions (                  -- Account.csv + Transactions.csv
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id TINYINT NOT NULL DEFAULT 1,
  tx_date DATETIME NOT NULL,
  type ENUM('deposit','withdrawal','buy','sell','dividend','tax','fee',
            'fx','split','isin_change','other') NOT NULL,
  isin CHAR(12) NULL, description VARCHAR(255),
  qty DECIMAL(18,6) NULL, amount DECIMAL(18,2), currency CHAR(3),
  amount_eur DECIMAL(18,2),
  external_id VARCHAR(64) NULL,              -- ID ordre DEGIRO (dédoublonnage)
  UNIQUE KEY uq_external (external_id),
  KEY idx_date (tx_date), KEY idx_isin (isin)
);

CREATE TABLE isin_ref (
  isin CHAR(12) PRIMARY KEY,
  ticker VARCHAR(20), sector VARCHAR(80), country VARCHAR(60),
  asset_class VARCHAR(40),
  superseded_by CHAR(12) NULL,               -- changements d'ISIN
  manual_override TINYINT NOT NULL DEFAULT 0,
  updated_at DATETIME
);

CREATE TABLE etf_holdings (
  etf_isin CHAR(12) NOT NULL,
  constituent_name VARCHAR(255) NOT NULL,
  constituent_isin CHAR(12) NULL,
  weight_pct DECIMAL(7,4) NOT NULL,
  sector VARCHAR(80), country VARCHAR(60),
  as_of DATE NOT NULL,
  PRIMARY KEY (etf_isin, constituent_name, as_of)
);

CREATE TABLE market_prices (                 -- benchmark + FX, fetch-on-demand
  series VARCHAR(20) NOT NULL,               -- 'IWDA.AS', 'EURUSD', ...
  price_date DATE NOT NULL,
  close DECIMAL(18,6) NOT NULL,
  PRIMARY KEY (series, price_date)
);
```

## Contrat d'API v1

Toutes les routes sous `/api`, header `Authorization: Bearer <API_TOKEN>` obligatoire
(401 sinon), erreurs JSON typées (400 validation, 401, 409 doublon, 500).

| Endpoint | Rôle |
|---|---|
| `GET /api/health` | `{ status, db, version }` — sans auth, sans donnée sensible |
| `POST /api/ingest` | Body `{ schema_version, source, capture_id, captured_at (ISO UTC), cash, positions[] }` validé (zod). Idempotent : doublon → 200 avec le `snapshotId` existant |
| `POST /api/ingest/csv` | Multipart (Portfolio / Transactions / Account), sniffing + parsing serveur, prévisualisation puis confirmation |
| `GET /api/portfolio` | Dernier snapshot (max `captured_at`), positions enrichies via `isin_ref` |
| `GET /api/snapshots?from=&to=` | Série `{ date, total_value_eur, cash_eur }` |
| `GET /api/exposure?lookthrough=1` | Répartitions secteur/pays/devise/classe, avec ou sans look-through |
| `GET /api/performance` | TWR par période (Modified Dietz chaîné) + série benchmark |
| `GET /api/attribution` | 2 buckets (ETF vs titres vifs) + décomposition FX |
| `GET /api/risk` | Top-5, Herfindahl, alertes de concentration |
| `GET /api/dividends` | Dividendes perçus 12M glissants (net/brut distingués) |

## Milestones

Règle : chaque milestone se termine par un déploiement vérifié sur `degiro.estim.pro`
et une CI verte. Efforts : S < M < L < XL (dev solo assisté par IA).

| # | Contenu | Critère « je peux… » | Effort |
|---|---|---|---|
| **M0** | Squelette monorepo (workspaces, Express + statique React, `.gitattributes`, CI lint+test, `.env.example`) + déploiement Hostinger + MySQL créée, migrations 001 appliquées | ouvrir degiro.estim.pro : la page React s'affiche, `GET /api/health` renvoie 200 avec ping DB | S |
| **M1** | Auth bearer + `POST /api/ingest` idempotent + `GET /api/portfolio` + `GET /api/snapshots` + durcissement (helmet, rate-limit, limite payload) | POSTer une fixture JSON via curl avec le token et la relire ; sans token → 401 | S |
| **M2** | Parseur CSV (3 formats, sniffing, fixtures réelles anonymisées + tests vitest) + page Import/Réglages (upload, prévisualisation, token) + table `transactions` alimentée par Account/Transactions.csv | importer mes exports réels et voir mes lignes + mes flux en base | M |
| **M3** | Enrichissement ISIN (OpenFIGI→Yahoo, cache `isin_ref`, édition manuelle) + pages Overview & Exposition v1 (secteur/pays/devise/classe, concentration top-5, alertes) | voir la répartition réelle de mon portefeuille — **premier jalon de valeur, sans extension** | M |
| **M4** | **Spike capture** (DevTools sur session réelle : valider replay same-origin, formats de réponse) puis extension MV3 complète (capture, jointure ISIN, POST, popup, options) | un clic sur l'icône pousse mon portefeuille DEGIRO vers le dashboard | M-L |
| **M5** | Historique : dédoublonnage jour, courbe de valeur totale, page Historique ; rétention `raw_json` (purge > 90 j au fil de l'eau) | après N jours de captures, voir ma courbe entre deux dates | S-M |
| **M6** | **Spike holdings** (vérifier les sources pour MES ETF) puis look-through : import compositions émetteurs (iShares CSV, Amundi XLSX…), table `etf_holdings`, exposition consolidée + concentration réelle | mon % tech inclut le contenu de mon ETF Nasdaq ; l'alerte se déclenche sur NVDA direct + indirect | L-XL |
| **M7** | TWR (Modified Dietz chaîné, validé contre un oracle externe type Portfolio Performance) vs benchmark proxy + attribution 2 buckets + effet FX + dividendes 12M | voir mon TWR vs MSCI World sur la période couverte | L |

**Chemin critique de valeur : M0 → M1 → M2 → M3** (~30-40 % de l'effort total).
M4-M7 s'y greffent sans bloquer la valeur. M6+M7 ≈ 40-50 % de l'effort : les garder
hors du chemin critique.

## Checklist avant la première ligne de code

1. **Vérifier 5 points Hostinger dans hPanel** (chacun peut invalider le squelette) :
   plan compatible « Web App Node.js » avec Node 20+ ; commandes build/start
   configurables à la racine ; port injecté (`process.env.PORT`) ; hôte MySQL vu
   depuis l'app (localhost vs `srvXXXX.hstgr.io`, Remote MySQL restreint par IP,
   jamais « Any Host ») ; phpMyAdmin disponible.
2. **Exporter les 3 CSV réels** du compte DEGIRO (Portfolio, Transactions, Account),
   les anonymiser → fixtures de test. Ça tranche aussi la question du séparateur.
3. **Générer `API_TOKEN`** (`openssl rand -hex 32`) et le poser en variable d'env
   Hostinger dès M0.
4. **MySQL local** pour le dev (installeur Windows ou Docker Desktop) + `seed.sql` —
   règle absolue : jamais la base de prod comme base de dev.

## Risques principaux et parades

| Risque | Impact | Parade |
|---|---|---|
| L'API interne DEGIRO change (v5→v6, format) | Capture cassée | `raw_json` conservé, transformateur versionné, validation de schéma à l'ingestion avec alerte dashboard, CSV en secours, degiro-connector comme doc de référence |
| Yahoo Finance (enrichissement, benchmark) casse | Enrichissement dégradé | Cache long dans `isin_ref`, séries stockées en base, édition manuelle, Stooq en secours pour le S&P 500 |
| Compositions ETF introuvables pour un émetteur | Look-through partiel | Spike avant M6 limité aux ETF détenus ; fallback top-10 + répartitions publiées |
| Corruption/perte de la base (seul historique existant) | Irréversible | Backups Hostinger vérifiés + export mensuel de `snapshots` hors Hostinger ; `snapshots` = source de vérité, tout le reste est reconstructible |
| ToS DEGIRO (accès automatisé) | Suspension de compte (improbable) | Lecture seule, 1 capture/jour, pas de login automatisé, pas de polling ; documenté au README |
| Régression silencieuse des calculs financiers | TWR faux qui a l'air juste | Tests vitest sur fixtures réelles, oracle externe (Portfolio Performance), CI bloquante avant déploiement |
