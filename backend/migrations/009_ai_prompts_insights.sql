-- Boucle « Prompts IA » : historique des prompts générés, et avis ré-ingérés
-- depuis les réponses collées (ChatGPT, Claude, Gemini…).
--
-- Table SÉPARÉE de isin_ref, à dessein : isin_ref est une donnée de référence
-- partagée (des faits — secteur, pays — identiques pour tous), alors qu'un avis
-- d'IA est une opinion PAR UTILISATEUR (obtenue à partir de son portefeuille)
-- et DATÉE. La ranger dans isin_ref ferait fuiter l'analyse d'un compte chez
-- les autres et écraserait l'historique.

CREATE TABLE IF NOT EXISTS ai_prompts (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  account_id  TINYINT UNSIGNED NOT NULL,
  goal        VARCHAR(40)      NOT NULL,
  scope       ENUM('position','portfolio') NOT NULL,
  isin        CHAR(12)         NULL,
  ref         CHAR(10)         NOT NULL,      -- recopié par l'IA dans sa réponse
  params      JSON             NULL,          -- choix du wizard (bornes, filtres…)
  prompt_text MEDIUMTEXT       NOT NULL,
  created_at  DATETIME         NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_prompt_ref (account_id, ref),
  KEY idx_prompts_user (account_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_insights (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  account_id     TINYINT UNSIGNED NOT NULL,
  prompt_id      BIGINT UNSIGNED  NULL,       -- prompt d'origine (via ref)
  scope          ENUM('position','portfolio') NOT NULL,
  isin           CHAR(12)         NULL,       -- NULL pour un avis portefeuille
  provider       VARCHAR(20)      NULL,       -- chatgpt / claude / gemini (déclaratif)
  -- Champs extraits du payload pour les badges et tris, sans parser du JSON :
  risk_score     TINYINT          NULL,
  recommendation ENUM('strong_buy','buy','hold','reduce','sell') NULL,
  confidence     ENUM('low','medium','high') NULL,
  fair_value     DECIMAL(18,4)    NULL,
  fair_value_ccy CHAR(3)          NULL,
  summary        VARCHAR(500)     NULL,
  as_of          DATE             NULL,
  payload        JSON             NOT NULL,   -- le bloc validé, intégral
  created_at     DATETIME         NOT NULL,
  PRIMARY KEY (id),
  KEY idx_insights_user_isin (account_id, isin, id),
  KEY idx_insights_prompt (prompt_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
