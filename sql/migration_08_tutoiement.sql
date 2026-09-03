-- ============================================================================
-- MIGRATION 08 — Tutoiement / vouvoiement par cliente
-- ----------------------------------------------------------------------------
-- Par défaut on VOUVOIE (false). On tutoie Émeline, Louise + toutes les
-- distancielles. Les messages WhatsApp (rappels bilan, rappels séance,
-- invitation espace) s'adaptent selon ce réglage.
-- À exécuter dans Supabase → SQL Editor. Idempotent.
-- ============================================================================

alter table public.clientes
  add column if not exists tutoiement boolean not null default false;

-- Tutoiement pour Émeline, Louise + toutes les distancielles.
-- (Ré-exécutable : on remet d'abord tout le monde en vouvoiement, puis on tutoie.)
update public.clientes set tutoiement = false;
update public.clientes
set tutoiement = true
where prenom ilike 'émeline%' or prenom ilike 'emeline%'
   or prenom ilike 'louise%'
   or type = 'distanciel';
