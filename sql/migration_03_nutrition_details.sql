-- ============================================================================
-- MIGRATION 03 — Nutrition détaillée (visible côté cliente)
-- ----------------------------------------------------------------------------
-- La cliente ne voyait que "suivi actif + dates + programmes". On ajoute les
-- objectifs nutritionnels (calories, macros) et des conseils, remplis par la
-- coach sur la fiche et affichés dans l'espace cliente.
-- À exécuter dans Supabase → SQL Editor. Idempotent.
-- ============================================================================

alter table public.accompagnements
  add column if not exists nut_calories  numeric,
  add column if not exists nut_proteines numeric,
  add column if not exists nut_glucides  numeric,
  add column if not exists nut_lipides   numeric,
  add column if not exists nut_conseils  text;

-- La vue cliente doit exposer ces nouveaux champs (toujours SANS le prix).
-- DROP obligatoire : CREATE OR REPLACE refuse d'insérer des colonnes au milieu.
drop view if exists public.mon_accompagnement;
create view public.mon_accompagnement
with (security_invoker = false) as
  select
    a.id, a.cliente_id,
    a.date_debut, a.date_fin, a.nb_mois, a.formule,
    a.freq_prevue, a.seances_prevues,
    a.nutrition_active, a.nut_date_debut, a.nut_date_fin, a.nut_nb_mois,
    a.nut_calories, a.nut_proteines, a.nut_glucides, a.nut_lipides, a.nut_conseils,
    a.created_at
  from public.accompagnements a
  join public.clientes c on c.id = a.cliente_id
  where c.profile_id = auth.uid();

grant select on public.mon_accompagnement to authenticated;
