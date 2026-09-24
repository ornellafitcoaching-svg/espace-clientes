-- ============================================================================
-- MIGRATION 17 — QUESTIONNAIRE DE DÉMARRAGE (le "premier bilan" complet)
-- ----------------------------------------------------------------------------
-- Reprend TOUTES les questions du Google Form d'accueil d'Ornella (mode de vie,
-- santé, sommeil, nutrition, objectifs, mensurations de départ, logistique).
-- La cliente le remplit UNE FOIS dans son espace ; la coach voit les réponses.
-- Réponses stockées en JSONB (1 colonne) → pas 56 colonnes ; les questions
-- vivent côté code (Calc.QI). Table SÉPARÉE = 0 impact sur bilans/mensurations.
-- Mêmes règles de sécurité que bilans_demarrage. À exécuter dans SQL Editor. Idempotent.
-- ============================================================================

create table if not exists public.questionnaire_initial (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  date        date not null default current_date,
  reponses    jsonb not null default '{}'::jsonb,
  saisi_par   text not null default 'cliente',
  created_at  timestamptz not null default now()
);
create index if not exists idx_qinit_cliente on public.questionnaire_initial(cliente_id, date);

alter table public.questionnaire_initial enable row level security;

drop policy if exists qinit_coach_all      on public.questionnaire_initial;
drop policy if exists qinit_cliente_read   on public.questionnaire_initial;
drop policy if exists qinit_cliente_insert on public.questionnaire_initial;

create policy qinit_coach_all on public.questionnaire_initial
  for all using (is_coach()) with check (is_coach());
create policy qinit_cliente_read on public.questionnaire_initial
  for select using (cliente_id = my_cliente_id());
create policy qinit_cliente_insert on public.questionnaire_initial
  for insert with check (cliente_id = my_cliente_id());
