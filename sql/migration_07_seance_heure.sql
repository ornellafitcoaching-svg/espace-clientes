-- ============================================================================
-- MIGRATION 07 — Heure des séances
-- ----------------------------------------------------------------------------
-- Ajoute une heure (facultative) aux séances, affichée dans l'agenda coach,
-- l'espace cliente et les rappels WhatsApp. La cliente lit déjà la table
-- seances directement (RLS SELECT) → aucune vue à recréer.
-- À exécuter dans Supabase → SQL Editor. Idempotent.
-- ============================================================================

alter table public.seances
  add column if not exists heure time;
