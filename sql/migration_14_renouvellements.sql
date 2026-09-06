-- ============================================================================
-- MIGRATION 14 — Historique des renouvellements d'accompagnement
-- Chaque entrée = { "date": "YYYY-MM-DD", "formule": "...", "nb_mois": N }.
-- Colonne coach uniquement (non exposée à la cliente).
-- ============================================================================
alter table public.accompagnements
  add column if not exists renouvellements jsonb not null default '[]'::jsonb;
