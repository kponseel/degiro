-- Sépare les taxes de transaction des retenues à la source.
--
-- La page Dividendes calcule « net = brut + tax ». Or la Taxe sur les
-- Transactions Financières et le stamp duty britannique arrivaient dans le même
-- seau `tax` que la retenue sur dividende : ils étaient donc retranchés des
-- dividendes, qui n'ont rien à voir avec eux. Sur cinq ans d'historique réel,
-- l'écart se chiffrait en centaines d'euros.
--
-- `computeDividends` ne lit que ('dividend','tax') : un type distinct suffit à
-- les écarter, sans toucher au calcul.
ALTER TABLE transactions
  MODIFY COLUMN type ENUM('deposit','withdrawal','buy','sell','dividend','tax',
                          'transaction_tax','fee','fx','split','isin_change','other') NOT NULL;
