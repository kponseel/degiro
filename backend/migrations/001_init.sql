-- Migration 001 — schéma initial du DEGIRO Analyzer.
-- Toutes les tables en InnoDB / utf8mb4. Voir docs/PLAN.md pour la justification.

CREATE TABLE IF NOT EXISTS snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id TINYINT NOT NULL DEFAULT 1,
  captured_at DATETIME NOT NULL,               -- UTC
  snapshot_date DATE NOT NULL,                 -- jour civil (Europe/Paris)
  source ENUM('extension','csv') NOT NULL,
  capture_id CHAR(36) NOT NULL,                -- UUID client (idempotence)
  schema_version SMALLINT NOT NULL DEFAULT 1,
  total_value_eur DECIMAL(18,2),
  cash_eur DECIMAL(18,2),
  raw_json JSON,                               -- purgeable après rétention
  UNIQUE KEY uq_capture (capture_id),
  UNIQUE KEY uq_day_source (account_id, snapshot_date, source),
  KEY idx_captured (captured_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS positions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  snapshot_id INT NOT NULL,
  isin CHAR(12) NOT NULL,
  symbol VARCHAR(20),
  name VARCHAR(255),
  product_type VARCHAR(20),                    -- STOCK / ETF / autre (source DEGIRO)
  qty DECIMAL(18,6),
  price DECIMAL(18,6),
  currency CHAR(3),
  fx_rate DECIMAL(12,6),                       -- taux devise->EUR au snapshot
  break_even_price DECIMAL(18,6),              -- PRU DEGIRO
  value_eur DECIMAL(18,2),
  pl_eur DECIMAL(18,2),
  pl_day_eur DECIMAL(18,2),
  CONSTRAINT fk_positions_snapshot
    FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE,
  KEY idx_isin (isin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  account_id TINYINT NOT NULL DEFAULT 1,
  tx_date DATETIME NOT NULL,
  type ENUM('deposit','withdrawal','buy','sell','dividend','tax','fee',
            'fx','split','isin_change','other') NOT NULL,
  isin CHAR(12) NULL,
  description VARCHAR(255),
  qty DECIMAL(18,6) NULL,
  amount DECIMAL(18,2),
  currency CHAR(3),
  amount_eur DECIMAL(18,2),
  external_id VARCHAR(64) NULL,                -- ID ordre DEGIRO (dédoublonnage)
  UNIQUE KEY uq_external (external_id),
  KEY idx_date (tx_date),
  KEY idx_isin (isin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS isin_ref (
  isin CHAR(12) PRIMARY KEY,
  ticker VARCHAR(20),
  sector VARCHAR(80),
  country VARCHAR(60),
  asset_class VARCHAR(40),
  superseded_by CHAR(12) NULL,                 -- changements d'ISIN
  manual_override TINYINT NOT NULL DEFAULT 0,
  updated_at DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS etf_holdings (
  etf_isin CHAR(12) NOT NULL,
  constituent_name VARCHAR(255) NOT NULL,
  constituent_isin CHAR(12) NULL,
  weight_pct DECIMAL(7,4) NOT NULL,
  sector VARCHAR(80),
  country VARCHAR(60),
  as_of DATE NOT NULL,
  PRIMARY KEY (etf_isin, constituent_name, as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS market_prices (
  series VARCHAR(20) NOT NULL,                 -- 'IWDA.AS', 'EURUSD', ...
  price_date DATE NOT NULL,
  close DECIMAL(18,6) NOT NULL,
  PRIMARY KEY (series, price_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
