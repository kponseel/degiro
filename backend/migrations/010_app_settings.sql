-- Réglages modifiables à chaud depuis l'administration.
--
-- Une variable d'environnement ne convient pas ici : la changer imposerait un
-- redémarrage du site (et un passage par hPanel). Ces réglages-là se pilotent
-- depuis l'interface, par l'administrateur, sans interruption de service.
--
-- Premier usage : le code d'invitation exigé pour créer un compte. Sans lui,
-- l'inscription est ouverte à quiconque connaît l'URL.
CREATE TABLE IF NOT EXISTS app_settings (
  name VARCHAR(64) PRIMARY KEY,
  value VARCHAR(255),
  updated_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Valeur initiale. `INSERT IGNORE` : rejouer la migration ne réécrase jamais un
-- code que l'administrateur aurait déjà changé depuis l'interface.
INSERT IGNORE INTO app_settings (name, value, updated_at)
VALUES ('invite_code', 'kev2026', NOW());
