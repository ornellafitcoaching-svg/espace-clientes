-- ============================================================================
-- MIGRATION 11 — Exposer `tutoiement` dans la vue cliente ma_fiche
-- ----------------------------------------------------------------------------
-- Pour que l'espace cliente adapte son texte (tu/vous) selon le réglage.
-- tutoiement n'est pas sensible. Ajouté EN FIN de select → CREATE OR REPLACE OK.
-- À exécuter dans Supabase → SQL Editor. Idempotent.
-- ============================================================================

create or replace view public.ma_fiche
with (security_invoker = false) as
  select
    id, prenom, nom, type, statut,
    objectif_principal, objectifs_secondaires,
    niveau, disponibilites, taille_cm, date_naissance,
    created_at, tutoiement
  from public.clientes
  where profile_id = auth.uid();

grant select on public.ma_fiche to authenticated;
