-- Migration 007 — jetons d'extension par utilisateur.
-- L'extension Chrome ne peut pas utiliser le cookie de session (requête
-- cross-site depuis trader.degiro.nl, SameSite=Lax le bloque). Chaque
-- utilisateur génère donc son propre jeton, révocable, porté en Bearer.
-- On ne stocke QUE le hash SHA-256 : le jeton en clair n'est montré qu'une fois.
CREATE TABLE IF NOT EXISTS extension_tokens (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id     TINYINT UNSIGNED NOT NULL,
  label       VARCHAR(60)      NOT NULL,
  token_hash  CHAR(64)         NOT NULL,
  prefix      CHAR(8)          NOT NULL,   -- début du jeton, pour l'identifier dans l'UI
  created_at  DATETIME         NOT NULL,
  last_used_at DATETIME        NULL,
  uses        INT UNSIGNED     NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ext_token (token_hash),
  KEY idx_ext_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
