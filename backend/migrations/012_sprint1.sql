-- Sprint 1 : versements nets capturés et notes par position.
--
-- 1) Versements nets selon DEGIRO (totalDepositWithdrawal / todayDepositWithdrawal
--    de totalPortfolio). Stockés dès la capture, sans affichage tant que le
--    chiffre n'a pas été vérifié sur un compte réel : chaque jour capturé d'ici là
--    enrichit l'historique au lieu d'être perdu.
ALTER TABLE snapshots ADD COLUMN net_deposits_eur DECIMAL(18,2) NULL AFTER cash_eur;
ALTER TABLE snapshots ADD COLUMN today_flow_eur DECIMAL(18,2) NULL AFTER net_deposits_eur;

-- 2) Notes privées par position : pourquoi je détiens ce titre, et le poids que
--    je vise. Propres à l'utilisateur (contrairement à isin_ref, partagée) et
--    effacées avec ses données.
CREATE TABLE IF NOT EXISTS position_notes (
  account_id TINYINT UNSIGNED NOT NULL,
  isin CHAR(12) NOT NULL,
  thesis VARCHAR(600) NULL,
  target_weight DECIMAL(5,2) NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (account_id, isin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
