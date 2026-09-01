-- ============================================================================
-- MIGRATION 06 — « Mot d'Ornella » (message de motivation visible côté cliente)
-- ----------------------------------------------------------------------------
-- La coach écrit un petit message perso (depuis la fiche cliente → Modifier
-- l'accompagnement). Il s'affiche en haut de l'espace cliente (accueil).
-- Différent du commentaire_coach d'un bilan : ici c'est un message « du moment ».
-- À exécuter dans Supabase → SQL Editor. Idempotent.
-- ============================================================================

alter table public.accompagnements
  add column if not exists message_coach text;

-- La vue cliente doit exposer ce champ (toujours SANS le prix).
-- DROP obligatoire : CREATE OR REPLACE refuse d'insérer une colonne au milieu.
drop view if exists public.mon_accompagnement;
create view public.mon_accompagnement
with (security_invoker = false) as
  select
    a.id, a.cliente_id,
    a.date_debut, a.date_fin, a.nb_mois, a.formule,
    a.freq_prevue, a.seances_prevues,
    a.nutrition_active, a.nut_date_debut, a.nut_date_fin, a.nut_nb_mois,
    a.nut_calories, a.nut_proteines, a.nut_glucides, a.nut_lipides, a.nut_conseils,
    a.message_coach,
    a.created_at
  from public.accompagnements a
  join public.clientes c on c.id = a.cliente_id
  where c.profile_id = auth.uid();

grant select on public.mon_accompagnement to authenticated;
