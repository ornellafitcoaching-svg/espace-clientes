-- ============================================================================
-- MIGRATION 12 — BILAN DE DÉMARRAGE (ressenti des premières séances)
-- ----------------------------------------------------------------------------
-- Questionnaire distinct du bilan périodique (poids/mensurations toutes les 4 sem.).
-- Orienté "premières séances" : douleur/courbatures, intensité, récupération,
-- énergie, motivation, plaisir, exercices difficiles/préférés, gêne à signaler.
-- La coach l'envoie quand elle veut (typiquement après ~5 séances) ; la cliente
-- le remplit dans son espace ; la coach voit les réponses dans la fiche.
-- Table séparée = AUCUN impact sur bilanStats / timeline / poids existants.
-- À exécuter dans Supabase → SQL Editor. Idempotent.
-- ============================================================================

create table if not exists public.bilans_demarrage (
  id                   uuid primary key default gen_random_uuid(),
  cliente_id           uuid not null references public.clientes(id) on delete cascade,
  date                 date not null default current_date,
  douleur              int,    -- courbatures / douleurs après séances (0 = aucune → 10 = très fortes)
  douleur_zones        text,   -- où (jambes, dos, épaules…)
  intensite            text,   -- 'trop_facile' | 'adaptee' | 'trop_dure'
  recuperation         text,   -- 'bonne' | 'moyenne' | 'difficile'
  energie              int,    -- forme/énergie après les séances (1 → 5)
  motivation           int,    -- motivation actuelle (1 → 5)
  plaisir              int,    -- plaisir pendant les séances (1 → 5)
  exercices_difficiles text,   -- exercices difficiles / inconfortables
  exercices_preferes   text,   -- exercices préférés
  gene_a_signaler      text,   -- douleur inhabituelle / gêne / blessure (sécurité)
  commentaire          text,   -- commentaire libre
  saisi_par            text not null default 'cliente',
  created_at           timestamptz not null default now()
);
create index if not exists idx_bilan_dem_cliente_date on public.bilans_demarrage(cliente_id, date);

-- RLS : coach = tous les droits ; cliente = lecture + insertion de SON dossier.
alter table public.bilans_demarrage enable row level security;

drop policy if exists bilan_dem_coach_all      on public.bilans_demarrage;
drop policy if exists bilan_dem_cliente_read   on public.bilans_demarrage;
drop policy if exists bilan_dem_cliente_insert on public.bilans_demarrage;

create policy bilan_dem_coach_all on public.bilans_demarrage
  for all using (is_coach()) with check (is_coach());
create policy bilan_dem_cliente_read on public.bilans_demarrage
  for select using (cliente_id = my_cliente_id());
create policy bilan_dem_cliente_insert on public.bilans_demarrage
  for insert with check (cliente_id = my_cliente_id());
