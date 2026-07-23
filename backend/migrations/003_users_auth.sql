-- Migration 003 — comptes utilisateurs & authentification par lien magique.
-- Multi-tenant : users.id devient la clé de locataire (= account_id existant).
-- Passwordless : magic_links (codes à usage unique) + sessions (jetons opaques).

CREATE TABLE IF NOT EXISTS users (
  id            TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255)     NOT NULL,
  pseudo        VARCHAR(60)      NOT NULL,
  created_at    DATETIME         NOT NULL,
  last_login_at DATETIME         NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Codes de connexion à usage unique. On ne stocke QUE le hash SHA-256 du jeton.
CREATE TABLE IF NOT EXISTS magic_links (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email      VARCHAR(255)    NOT NULL,
  pseudo     VARCHAR(60)     NULL,            -- pseudo souhaité si première connexion
  token_hash CHAR(64)        NOT NULL,
  expires_at DATETIME        NOT NULL,
  used_at    DATETIME        NULL,
  created_at DATETIME        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_magic_token (token_hash),
  KEY idx_magic_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sessions navigateur : jeton opaque (hash stocké), cookie httpOnly côté client.
CREATE TABLE IF NOT EXISTS sessions (
  id         BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id    TINYINT UNSIGNED NOT NULL,
  token_hash CHAR(64)         NOT NULL,
  created_at DATETIME         NOT NULL,
  expires_at DATETIME         NOT NULL,
  last_seen  DATETIME         NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_session_token (token_hash),
  KEY idx_session_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
