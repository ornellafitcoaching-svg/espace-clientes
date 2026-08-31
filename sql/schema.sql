-- ============================================================================
-- ESPACE CLIENTES — Ornella Fit Coaching
-- Schéma Postgres + Row Level Security pour Supabase
-- ----------------------------------------------------------------------------
-- À exécuter UNE FOIS dans Supabase : Dashboard → SQL Editor → coller → Run.
-- Idempotent autant que possible (drop policy if exists avant create).
-- ============================================================================

-- Extensions utiles ---------------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ============================================================================
-- 1) PROFILES  (1 ligne par utilisateur auth : la coach + chaque cliente)
-- ============================================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'cliente' check (role in ('coach','cliente')),
  prenom     text,
  nom        text,
  email      text,
  created_at timestamptz not null default now()
);

-- Création auto d'un profil à chaque nouvel utilisateur auth.
-- SÉCURITÉ : le rôle 'coach' n'est JAMAIS accordé ici (toujours 'cliente' par
-- défaut). La coach est promue manuellement (voir tout en bas du fichier).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role, prenom, nom, email)
  values (
    new.id,
    'cliente',
    coalesce(new.raw_user_meta_data->>'prenom', ''),
    coalesce(new.raw_user_meta_data->>'nom', ''),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 2) FONCTIONS D'AIDE POUR LES POLICIES (SECURITY DEFINER = pas de récursion RLS)
-- ============================================================================
-- Est-ce que l'utilisateur courant est la coach ?
create or replace function public.is_coach()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'coach'
  );
$$;
-- NB : my_cliente_id() est définie plus bas, APRÈS la table clientes qu'elle référence.

-- ============================================================================
-- 3) CLIENTES
-- ============================================================================
create table if not exists public.clientes (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid references public.profiles(id) on delete set null, -- rempli en Étape 2 (accès cliente)
  prenom                text not null,
  nom                   text,
  type                  text not null default 'presentiel'
                          check (type in ('presentiel','distanciel','hybride')),
  statut                text not null default 'a_demarrer'
                          check (statut in ('active','a_demarrer','en_pause','termine','a_renouveler')),
  objectif_principal    text,
  objectifs_secondaires text,
  -- Coordonnées
  telephone             text,
  email_perso           text,
  date_naissance        date,
  taille_cm             numeric,        -- pour calcul IMC
  -- Profil sportif
  niveau                text,           -- débutant / intermédiaire / avancé
  disponibilites        text,
  -- Santé (sécurité) — antécédents, blessures, pathologies, contre-indications
  sante                 text,
  allergies             text,
  access_code           text,   -- code d'accès cliente (généré par la coach). Étape 2 : sert d'identifiant/mot de passe.
  created_at            timestamptz not null default now()
);
create index if not exists idx_clientes_profile on public.clientes(profile_id);
create index if not exists idx_clientes_statut  on public.clientes(statut);

-- Quelle est la cliente rattachée à l'utilisateur courant (null si coach/aucune) ?
-- Définie ici car elle référence la table clientes créée juste au-dessus.
create or replace function public.my_cliente_id()
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select c.id from public.clientes c
  where c.profile_id = auth.uid()
  limit 1;
$$;

-- ============================================================================
-- 4) ACCOMPAGNEMENTS (contrat / suivi)  — 1 par cliente
-- ============================================================================
create table if not exists public.accompagnements (
  id               uuid primary key default gen_random_uuid(),
  cliente_id       uuid not null references public.clientes(id) on delete cascade,
  date_debut       date,
  date_fin         date,
  nb_mois          int,
  formule          text,
  prix             numeric,           -- montant du forfait (€)
  freq_prevue      text,
  seances_prevues  int default 0,
  -- Nutrition, indépendante du sport :
  nutrition_active boolean not null default false,
  nut_date_debut   date,
  nut_date_fin     date,
  nut_nb_mois      int,
  created_at       timestamptz not null default now()
);
create index if not exists idx_accomp_cliente on public.accompagnements(cliente_id);

-- ============================================================================
-- 5) SÉANCES  (3 niveaux de saisie : rapide / standard / détaillé)
-- ============================================================================
create table if not exists public.seances (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  date        date not null default current_date,
  type        text,
  statut      text not null default 'realisee' check (statut in ('realisee','prevue','annulee')),
  niveau      text not null default 'rapide' check (niveau in ('rapide','standard','detaille')),
  objectif    text,
  intensite   text,
  duree       int,               -- minutes
  commentaire text,
  exercices   jsonb,             -- niveau détaillé : [{nom,series,reps,charge,repos,rpe,obs}]
  created_at  timestamptz not null default now()
);
create index if not exists idx_seances_cliente_date on public.seances(cliente_id, date);

-- ============================================================================
-- 6) BILANS  (toutes les ~4 semaines, tous les champs facultatifs)
-- ============================================================================
create table if not exists public.bilans (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references public.clientes(id) on delete cascade,
  date               date not null default current_date,
  semaine            int,        -- 0, 4, 8, 12...
  poids              numeric,
  ressenti           text,
  evolution          text,
  objectifs_atteints text,
  difficultes        text,
  points_positifs    text,
  nouveaux_objectifs text,
  commentaire_coach  text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_bilans_cliente_date on public.bilans(cliente_id, date);

-- ============================================================================
-- 7) MENSURATIONS  (flexible : la coach choisit les mesures)
-- ============================================================================
create table if not exists public.mensurations (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  date       date not null default current_date,
  type       text not null,       -- 'poids','tour_taille','tour_hanches'...
  valeur     numeric not null,
  unite      text default 'cm',
  created_at timestamptz not null default now()
);
create index if not exists idx_mensu_cliente_type_date on public.mensurations(cliente_id, type, date);

-- ============================================================================
-- 8) PHOTOS  (fichiers dans Storage privé ; ici seulement les métadonnées)
-- ============================================================================
create table if not exists public.photos (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references public.clientes(id) on delete cascade,
  date         date not null default current_date,
  storage_path text not null,     -- '<cliente_id>/<visibilite>/<uuid>.jpg'
  visibilite   text not null default 'prive' check (visibilite in ('cliente','prive')),
  legende      text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_photos_cliente_date on public.photos(cliente_id, date);

-- ============================================================================
-- 9) OBJECTIFS
-- ============================================================================
create table if not exists public.objectifs (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.clientes(id) on delete cascade,
  titre         text not null,
  description   text,
  statut        text not null default 'en_cours' check (statut in ('en_cours','atteint','abandonne')),
  date_creation date not null default current_date,
  date_atteinte date,
  created_at    timestamptz not null default now()
);
create index if not exists idx_objectifs_cliente on public.objectifs(cliente_id);

-- ============================================================================
-- 10) PROGRAMMES  (sportif + nutrition, indépendants)
-- ============================================================================
create table if not exists public.programmes (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  kind        text not null check (kind in ('sportif','nutrition')),
  envoye      boolean not null default false,
  date_envoi  date,
  version     text,
  date_debut  date,
  date_fin    date,
  commentaire text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_programmes_cliente on public.programmes(cliente_id, kind);

-- ============================================================================
-- 11) NOTES PRIVÉES COACH  (JAMAIS visibles côté cliente)
-- ============================================================================
create table if not exists public.notes_privees (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  date       date not null default current_date,
  contenu    text,
  created_at timestamptz not null default now()
);
create index if not exists idx_notes_cliente on public.notes_privees(cliente_id, date);

-- ============================================================================
-- 11bis) PAIEMENTS  (suivi financier — coach uniquement, JAMAIS côté cliente)
-- ============================================================================
create table if not exists public.paiements (
  id         uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  date       date not null default current_date,
  montant    numeric not null,        -- en €
  mode       text,                    -- 'Stripe','GoCardless','Virement','Espèces','Klarna'...
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_paiements_cliente_date on public.paiements(cliente_id, date);

-- ============================================================================
-- 12) TIMELINE  (vue : agrège tous les événements datés d'une cliente)
--     Les notes privées sont EXCLUES. Les photos privées sont EXCLUES.
--     La vue est filtrée par les RLS des tables sous-jacentes (security_invoker).
-- ============================================================================
create or replace view public.timeline
with (security_invoker = true) as
  select cliente_id, date, 'bilan'::text as kind,
         coalesce('Bilan semaine '||semaine, 'Bilan') as libelle, id as ref_id
  from public.bilans
  union all
  select cliente_id, date, 'seance',
         coalesce('Séance '||type, 'Séance'), id from public.seances
  union all
  select cliente_id, date, 'mensuration',
         'Mensuration '||type, id from public.mensurations
  union all
  select cliente_id, date, 'photo', 'Photo', id
         from public.photos where visibilite = 'cliente'
  union all
  select cliente_id, coalesce(date_envoi, date_debut), 'programme',
         case kind when 'sportif' then 'Programme sportif envoyé'
                   else 'Programme nutrition envoyé' end, id
         from public.programmes where envoye = true
  union all
  select cliente_id, date_creation, 'objectif', 'Objectif : '||titre, id
         from public.objectifs;

-- ============================================================================
-- 13) ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Modèle : la coach (is_coach()) a TOUS les droits partout.
--          la cliente n'a que du SELECT sur SON dossier (my_cliente_id()).
-- ============================================================================

-- Active RLS sur toutes les tables
alter table public.profiles        enable row level security;
alter table public.clientes        enable row level security;
alter table public.accompagnements enable row level security;
alter table public.seances         enable row level security;
alter table public.bilans          enable row level security;
alter table public.mensurations    enable row level security;
alter table public.photos          enable row level security;
alter table public.objectifs       enable row level security;
alter table public.programmes      enable row level security;
alter table public.notes_privees   enable row level security;

-- ---- PROFILES ----
drop policy if exists profiles_self_read  on public.profiles;
drop policy if exists profiles_coach_all  on public.profiles;
create policy profiles_self_read on public.profiles
  for select using (id = auth.uid());
create policy profiles_coach_all on public.profiles
  for all using (is_coach()) with check (is_coach());

-- ---- CLIENTES ----
drop policy if exists clientes_coach_all   on public.clientes;
drop policy if exists clientes_self_read   on public.clientes;
create policy clientes_coach_all on public.clientes
  for all using (is_coach()) with check (is_coach());
create policy clientes_self_read on public.clientes
  for select using (profile_id = auth.uid());

-- ---- Macro : coach = ALL, cliente = SELECT du dossier ----
-- (répété par table car Postgres n'a pas de "policy template")
do $$
declare t text;
begin
  foreach t in array array[
    'accompagnements','seances','bilans','mensurations',
    'objectifs','programmes'
  ] loop
    execute format('drop policy if exists %I_coach_all on public.%I;', t, t);
    execute format('drop policy if exists %I_cliente_read on public.%I;', t, t);
    execute format(
      'create policy %I_coach_all on public.%I for all using (is_coach()) with check (is_coach());',
      t, t);
    execute format(
      'create policy %I_cliente_read on public.%I for select using (cliente_id = my_cliente_id());',
      t, t);
  end loop;
end $$;

-- ---- PHOTOS : cliente ne voit QUE les photos visibilite='cliente' ----
drop policy if exists photos_coach_all    on public.photos;
drop policy if exists photos_cliente_read on public.photos;
create policy photos_coach_all on public.photos
  for all using (is_coach()) with check (is_coach());
create policy photos_cliente_read on public.photos
  for select using (cliente_id = my_cliente_id() and visibilite = 'cliente');

-- ---- NOTES PRIVÉES : coach uniquement, AUCUNE policy cliente ----
drop policy if exists notes_coach_all on public.notes_privees;
create policy notes_coach_all on public.notes_privees
  for all using (is_coach()) with check (is_coach());

-- ---- PAIEMENTS : coach uniquement (sensible), AUCUNE policy cliente ----
alter table public.paiements enable row level security;
drop policy if exists paiements_coach_all on public.paiements;
create policy paiements_coach_all on public.paiements
  for all using (is_coach()) with check (is_coach());

-- ============================================================================
-- 14) STORAGE  (bucket privé pour les photos)
-- ----------------------------------------------------------------------------
-- Chemin des fichiers : '<cliente_id>/<visibilite>/<uuid>.jpg'
--   → la cliente ne peut lire QUE le sous-dossier 'cliente' de SON dossier.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists photos_storage_coach   on storage.objects;
drop policy if exists photos_storage_cliente on storage.objects;
create policy photos_storage_coach on storage.objects
  for all using (bucket_id = 'photos' and is_coach())
  with check (bucket_id = 'photos' and is_coach());
create policy photos_storage_cliente on storage.objects
  for select using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = my_cliente_id()::text
    and (storage.foldername(name))[2] = 'cliente'
  );

-- ============================================================================
-- 15) BOOTSTRAP DE LA COACH  (à faire UNE FOIS)
-- ----------------------------------------------------------------------------
-- 1. Dashboard → Authentication → Users → "Add user" : crée ton compte
--    (email = ton email, mot de passe au choix). Coche "Auto Confirm User".
-- 2. Reviens ici et exécute la ligne ci-dessous avec TON email :
--
--    update public.profiles set role = 'coach' where email = 'TON_EMAIL_ICI';
--
-- 3. Vérifie :  select id, email, role from public.profiles;
-- ============================================================================
