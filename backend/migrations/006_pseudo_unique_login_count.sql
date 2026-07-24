-- Migration 006 — pseudos uniques + compteur de connexions.
-- 1. Dédoublonne les pseudos existants (les doublons reçoivent un suffixe -<id>,
--    la ligne la plus ancienne garde le pseudo d'origine).
UPDATE users u
JOIN (
  SELECT u1.id FROM users u1
  WHERE EXISTS (SELECT 1 FROM users u2 WHERE u2.pseudo = u1.pseudo AND u2.id < u1.id)
) d ON d.id = u.id
SET u.pseudo = CONCAT(u.pseudo, '-', u.id);

-- 2. Unicité (collation CI de la table → insensible à la casse).
ALTER TABLE users ADD UNIQUE KEY uq_users_pseudo (pseudo);

-- 3. Compteur de connexions (affiché dans l'administration).
ALTER TABLE users ADD COLUMN login_count INT UNSIGNED NOT NULL DEFAULT 0;
