-- ============================================================================
-- MIGRATION 09 — Séances déjà effectuées (report initial, dates inconnues)
-- ----------------------------------------------------------------------------
-- Pour les clientes reprises du CRM : nombre de séances déjà faites AVANT l'appli
-- (dates incertaines). Le décompte « réalisées » = ce report + les séances
-- réellement cochées « faite » dans l'appli. Ça permet de supprimer les fausses
-- séances CRM sans fausser le compteur.
-- À exécuter dans Supabase → SQL Editor. Idempotent.
-- ============================================================================

alter table public.accompagnements
  add column if not exists seances_faites_init integer not null default 0;

-- La vue cliente doit exposer ce champ (pour le décompte côté espace cliente).
-- DROP obligatoire : CREATE OR REPLACE refuse d'insérer une colonne au milieu.
drop view if exists public.mon_accompagnement;
create view public.mon_accompagnement
with (security_invoker = false) as
  select
    a.id, a.cliente_id,
    a.date_debut, a.date_fin, a.nb_mois, a.formule,
    a.freq_prevue, a.seances_prevues, a.seances_faites_init,
    a.nutrition_active, a.nut_date_debut, a.nut_date_fin, a.nut_nb_mois,
    a.nut_calories, a.nut_proteines, a.nut_glucides, a.nut_lipides, a.nut_conseils,
    a.message_coach,
    a.created_at
  from public.accompagnements a
  join public.clientes c on c.id = a.cliente_id
  where c.profile_id = auth.uid();

grant select on public.mon_accompagnement to authenticated;
