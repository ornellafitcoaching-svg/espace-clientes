-- migration_16 : « Montant dû » par cliente (accompagnements.montant_du).
-- Champ SAISI À LA MAIN par la coach = ce que la cliente lui doit, indépendamment
-- du calcul « prix du forfait − paiements reçus » (qui reste utilisé s'il n'y a pas
-- de montant dû explicite, cf. Calc.detteCliente).
--
-- ⚠️ ADDITIF & NON DESTRUCTIF : add column IF NOT EXISTS, ré-exécutable, aucune
--    donnée existante modifiée, aucune policy RLS touchée (colonne réservée coach,
--    non exposée par la vue mon_accompagnement).
alter table public.accompagnements
  add column if not exists montant_du numeric;
