-- ============================================================================
-- MIGRATION 18 — QUESTIONNAIRE ALIMENTAIRE DE DÉPART (« bilan nutrition »)
-- ----------------------------------------------------------------------------
-- Questionnaire nutrition dédié, SÉPARÉ du questionnaire de démarrage : allergies,
-- intolérances, habitudes, goûts, digestion, contraintes. La cliente le remplit UNE
-- FOIS dans son espace ; la coach voit les réponses. Réponses en JSONB (1 colonne) ;
-- les questions vivent côté code (Calc.QN). Mêmes règles de sécurité que
-- questionnaire_initial. À exécuter dans le SQL Editor. Idempotent.
-- ============================================================================

create table if not exists public.questionnaire_nutrition (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  date        date not null default current_date,
  reponses    jsonb not null default '{}'::jsonb,
  saisi_par   text not null default 'cliente',
  created_at  timestamptz not null default now()
);
create index if not exists idx_qnut_cliente on public.questionnaire_nutrition(cliente_id, date);

alter table public.questionnaire_nutrition enable row level security;

drop policy if exists qnut_coach_all      on public.questionnaire_nutrition;
drop policy if exists qnut_cliente_read   on public.questionnaire_nutrition;
drop policy if exists qnut_cliente_insert on public.questionnaire_nutrition;

create policy qnut_coach_all on public.questionnaire_nutrition
  for all using (is_coach()) with check (is_coach());
create policy qnut_cliente_read on public.questionnaire_nutrition
  for select using (cliente_id = my_cliente_id());
create policy qnut_cliente_insert on public.questionnaire_nutrition
  for insert with check (cliente_id = my_cliente_id());
