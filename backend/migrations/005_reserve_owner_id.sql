-- Migration 005 — réserve l'id 1 (propriétaire) : une inscription ne doit JAMAIS
-- pouvoir hériter des données historiques (account_id = 1) par simple ordre d'arrivée.
-- Seul ensureOwner (OWNER_EMAIL) crée l'utilisateur #1, explicitement.
ALTER TABLE users AUTO_INCREMENT = 2;
