-- ============================================================================
-- MIGRATION 22 — BILAN DES 4 SEMAINES : questions « en profondeur »
-- ----------------------------------------------------------------------------
-- Ajoute une colonne JSONB `reponses` à `bilans` pour stocker, à chaque bilan
-- (toutes les 4 semaines), le point sur : sommeil, stress, énergie, motivation
-- et « le pourquoi » (ce qui a changé dans le ressenti, au-delà de la balance).
-- Aucune colonne existante n'est modifiée → 0 impact sur bilanStats / timeline.
-- À exécuter dans Supabase → SQL Editor. Idempotent.
-- ============================================================================
alter table public.bilans
  add column if not exists reponses jsonb not null default '{}'::jsonb;
