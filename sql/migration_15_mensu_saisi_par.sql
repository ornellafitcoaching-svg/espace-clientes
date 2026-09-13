-- migration_15 : savoir QUI a saisi une mensuration (coach vs cliente)
-- Objectif : notifier la coach dans son tableau de bord quand une cliente
-- saisit ses mesures depuis son espace (badge « 🆕 Nouvelles mensurations »).
--
-- ⚠️ ADDITIF & NON DESTRUCTIF :
--   • add column IF NOT EXISTS → ré-exécutable sans risque.
--   • default 'coach' → toutes les mensurations DÉJÀ enregistrées restent
--     considérées comme saisies par la coach : AUCUNE notif rétroactive,
--     aucune donnée modifiée en valeur.
--   • Aucune policy RLS touchée (l'insert cliente reste borné par my_cliente_id()).
alter table public.mensurations
  add column if not exists saisi_par text not null default 'coach';
