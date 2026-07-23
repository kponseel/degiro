-- Migration 004 — unicité par utilisateur (multi-tenant).
-- Les contraintes d'unicité globales (capture_id, external_id) provoqueraient des
-- collisions entre utilisateurs (ex. deux amis important le même CSV d'exemple, ou
-- des ID d'ordre DEGIRO identiques). On les scope par account_id.

ALTER TABLE snapshots
  DROP INDEX uq_capture,
  ADD UNIQUE KEY uq_capture (account_id, capture_id);

ALTER TABLE transactions
  DROP INDEX uq_external,
  ADD UNIQUE KEY uq_external (account_id, external_id);
