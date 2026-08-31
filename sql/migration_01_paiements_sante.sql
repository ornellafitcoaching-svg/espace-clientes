-- ============================================================================
-- MIGRATION 01 — Coordonnées + santé + prix + paiements
-- À exécuter UNE FOIS sur la base déjà créée (idempotent).
-- ============================================================================
alter table public.clientes add column if not exists telephone      text;
alter table public.clientes add column if not exists email_perso    text;
alter table public.clientes add column if not exists date_naissance date;
alter table public.clientes add column if not exists taille_cm      numeric;
alter table public.clientes add column if not exists niveau         text;
alter table public.clientes add column if not exists disponibilites text;
alter table public.clientes add column if not exists sante          text;
alter table public.clientes add column if not exists allergies      text;

alter table public.accompagnements add column if not exists prix numeric;

create table if not exists public.paiements (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  date       date not null default current_date,
  montant    numeric not null,
  mode       text,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_paiements_cliente_date on public.paiements(cliente_id, date);

alter table public.paiements enable row level security;
drop policy if exists paiements_coach_all on public.paiements;
create policy paiements_coach_all on public.paiements
  for all using (is_coach()) with check (is_coach());
