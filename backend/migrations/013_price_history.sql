-- Historique des cours des lignes détenues et taux de change BCE, rapportés par
-- l'extension (le serveur ne peut pas appeler l'extérieur chez l'hébergeur).
--
-- Une ligne par (utilisateur, ISIN), remplacée à chaque capture : les points
-- sont stockés en JSON compact `[["AAAA-MM-JJ", cours], …]`. Propres à
-- l'utilisateur — la liste des ISIN révèle ses positions — et effacées avec ses
-- données.
CREATE TABLE IF NOT EXISTS price_history (
  account_id TINYINT UNSIGNED NOT NULL,
  isin CHAR(12) NOT NULL,
  currency CHAR(3) NULL,
  daily_json MEDIUMTEXT NULL,
  weekly_json MEDIUMTEXT NULL,
  fetched_at DATETIME NOT NULL,
  PRIMARY KEY (account_id, isin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fx_history (
  account_id TINYINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL,
  rates_json MEDIUMTEXT NOT NULL,
  fetched_at DATETIME NOT NULL,
  PRIMARY KEY (account_id, currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
