/**
 * Prompt pour un agent navigateur (Claude for Chrome, Comet, Operator…) chargé
 * de récupérer les exports CSV DEGIRO et de les importer ici.
 *
 * Troisième voie de mise à jour, à côté de l'extension de capture et de l'import
 * manuel : l'agent conduit le navigateur à la place de l'utilisateur.
 *
 * Deux points font toute la valeur de ce prompt, parce que ce sont exactement les
 * deux endroits où un export DEGIRO se rate silencieusement :
 *  1. les plages de dates — DEGIRO propose par défaut une fenêtre courte, qui
 *     tronque l'historique et fausse les plus-values comme le TWR ;
 *  2. l'option « toutes les positions » du portefeuille, sans laquelle les lignes
 *     soldées n'apparaissent pas.
 *
 * Le prompt est volontairement écrit par objectif plutôt qu'en clics : les
 * libellés DEGIRO changent avec la langue et les refontes, un agent s'adapte mieux
 * avec un but et des critères de vérification qu'avec un chemin figé.
 *
 * Module pur (aucune API navigateur) : testé dans `backend/test/browserAgent.test.js`.
 */

/** Date du jour au format JJ/MM/AAAA, celui qu'attendent les champs DEGIRO. */
export function frDate(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}/${p(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/**
 * Construit le prompt à copier dans l'agent navigateur.
 * @param {{ appUrl?: string, today?: Date }} opts
 */
export function buildBrowserAgentPrompt({ appUrl = '', today = new Date() } = {}) {
  const url = String(appUrl || '').replace(/\/+$/, '') || "l'adresse de DEGIRO Analyzer";
  const jour = frDate(today);

  return `Tu es un agent navigateur. Objectif : récupérer mes trois exports CSV DEGIRO **complets**, puis les importer dans DEGIRO Analyzer.

## Règles absolues — il s'agit d'un compte-titres réel

- Tu es en **LECTURE SEULE** sur DEGIRO. Tu ne dois JAMAIS passer, modifier ou annuler un ordre, ni vendre, ni acheter, ni virer ou retirer de l'argent, ni modifier un réglage du compte.
- Tu ne touches qu'aux pages de consultation et aux boutons d'export/téléchargement.
- **Ne saisis jamais mes identifiants et ne valide jamais une double authentification.** Si une connexion est demandée, arrête-toi et demande-moi de le faire moi-même.
- Si une action réclame une confirmation autre qu'un simple téléchargement, arrête-toi et demande-moi.
- En cas de doute sur un bouton, ne clique pas : décris-le-moi et attends.

## Contexte

- DEGIRO : https://trader.degiro.nl — je suis déjà connecté dans un onglet.
- DEGIRO Analyzer : ${url} — je suis déjà connecté.
- Date du jour : ${jour}.

Les libellés DEGIRO changent selon la langue et les refontes de l'interface. Raisonne par objectif, pas par chemin figé : cherche l'équivalent (français, anglais ou néerlandais) de ce qui est décrit.

## Étape 1 — Portefeuille (Portfolio.csv)

1. Ouvre la page **Portefeuille** (« Portfolio »).
2. **Le point critique** : active l'affichage de **toutes les positions** — l'option se nomme « Afficher toutes les positions », « Toutes les positions » ou « Show all positions » selon la langue. Sans elle, seules les lignes encore détenues sortent, et tout l'historique des positions fermées est perdu.
3. Date de l'instantané : **${jour}** (aujourd'hui).
4. Exporte au format **CSV** (bouton d'export/téléchargement, en haut du tableau).

## Étape 2 — Transactions (Transactions.csv)

1. Va dans **Activité** (ou « Boîte de réception » / « Inbox ») → **Transactions**.
2. **Le point critique** : la plage de dates doit couvrir **tout mon historique, depuis l'ouverture du compte jusqu'à aujourd'hui**. La plage proposée par défaut est courte (souvent le mois ou la semaine en cours) : la garder tronquerait l'historique et fausserait le calcul des plus-values réalisées.
   - Si tu ne connais pas la date d'ouverture du compte, mets **01/01/2000** comme date de début : DEGIRO renverra simplement tout ce qui existe.
   - Si DEGIRO refuse une plage trop longue, découpe-la **année par année** et télécharge un fichier par année. Aucun risque : l'import ignore les doublons, un ordre déjà connu n'est jamais compté deux fois.
3. Exporte au format **CSV**.

## Étape 3 — Relevé de compte (Account.csv)

1. Va dans **Activité** → **Relevé de compte** (« Relevés », « Account statement »).
2. Même exigence de plage : **tout l'historique**, mêmes consignes de découpage si nécessaire.
3. Exporte au format **CSV**.

Ce fichier est celui qui apporte les **dividendes**, les **retenues à la source** et les **versements/retraits**. Sans lui, ni la page Dividendes ni la performance réelle (TWR) ne peuvent être justes.

## Étape 4 — Import dans DEGIRO Analyzer

Pour **chaque** fichier téléchargé :

1. Va sur ${url} → **Import / Réglages** → « Importer un export DEGIRO ».
2. Sélectionne le fichier. Le type est reconnu automatiquement.
3. **Vérifie la prévisualisation avant de valider** : le type détecté doit être cohérent (portefeuille / transactions / relevé de compte) et les colonnes ne doivent pas être décalées.
4. Si la prévisualisation semble décalée, ou si le type n'est pas reconnu : **ne valide pas**, signale-le-moi et passe au fichier suivant.
5. Sinon, valide l'import.

## Vérification finale — ne conclus pas sans l'avoir faite

- **Nombre de lignes de chaque fichier.** Un Transactions.csv ou un Account.csv de quelques lignes seulement trahit une plage de dates trop courte : recommence l'étape avec la bonne plage.
- **Date la plus ancienne** dans Transactions.csv et Account.csv : correspond-elle bien au début de mon historique, et non à ce mois-ci ?
- **Portefeuille** : le fichier contient-il des lignes à **quantité 0** (positions soldées) ? Si aucune, l'option « toutes les positions » n'a pas été prise en compte — refais l'étape 1.
- Dans l'Analyzer : la page **Performance → « Gains, pertes & fiscalité »** affiche-t-elle des ventes, et la page **Dividendes** est-elle remplie ? Si l'une des deux est vide, l'import correspondant n'a pas fonctionné.

## Rapport

Termine par un compte rendu court :

- les trois fichiers récupérés, avec leur **plage de dates réelle** et leur **nombre de lignes** ;
- ce qui a été importé avec succès ;
- tout ce qui a échoué, ce que tu n'as pas trouvé, ou ce qui te paraît douteux.

N'invente aucun chiffre : si tu n'as pas pu vérifier quelque chose, dis-le.`;
}
