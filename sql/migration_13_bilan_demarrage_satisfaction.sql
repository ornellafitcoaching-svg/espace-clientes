-- ============================================================================
-- MIGRATION 13 — BILAN DE DÉMARRAGE : questions de satisfaction en plus
-- ----------------------------------------------------------------------------
-- Ajoute 2 questions : est-ce que les séances conviennent ? la fréquence ?
-- (complète l'intensité déjà présente). Colonnes facultatives, non destructif.
-- À exécuter dans Supabase → SQL Editor. Idempotent.
-- ============================================================================

alter table public.bilans_demarrage
  add column if not exists seances_ok   text;   -- 'oui' | 'a_ajuster' | 'non'
alter table public.bilans_demarrage
  add column if not exists frequence_ok text;   -- 'bonne' | 'trop' | 'pas_assez'
