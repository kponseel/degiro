-- Plus-value déjà RÉALISÉE sur une ligne encore détenue (ventes partielles).
--
-- DEGIRO ne livre pas le coût des titres encore détenus : son `plBase` est le
-- flux net de la ligne depuis l'origine (achats − ventes). `valeur + plBase`
-- donne donc un résultat TOTAL, ventes passées comprises — sur une ligne en
-- partie vendue, une « plus-value latente » de +2 200 %. L'extension retranche
-- désormais le réalisé et le conserve ici, pour l'afficher à part.
ALTER TABLE positions ADD COLUMN pl_realized_eur DECIMAL(18,2) NULL AFTER pl_day_eur;
