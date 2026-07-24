-- Migration 006 — pseudos uniques + compteur de connexions.
-- 1. Dédoublonne les pseudos existants : les doublons reçoivent un suffixe -<id>,
--    la ligne la plus ancienne garde le pseudo d'origine.
--    NB : la table dérivée utilise GROUP BY/HAVING pour forcer sa matérialisation —
--    MySQL 8 fusionne les dérivées simples et lève alors ER_UPDATE_TABLE_USED (1093).
--    LEFT(…, 55) garde le résultat sous la limite VARCHAR(60).
UPDATE users u
JOIN (
  SELECT pseudo, MIN(id) AS keeper
  FROM users
  GROUP BY pseudo
  HAVING COUNT(*) > 1
) d ON d.pseudo = u.pseudo AND u.id <> d.keeper
SET u.pseudo = CONCAT(LEFT(u.pseudo, 55), '-', u.id);

-- 2. Unicité (collation CI de la table → insensible à la casse).
ALTER TABLE users ADD UNIQUE KEY uq_users_pseudo (pseudo);

-- 3. Compteur de connexions (affiché dans l'administration).
ALTER TABLE users ADD COLUMN login_count INT UNSIGNED NOT NULL DEFAULT 0;
