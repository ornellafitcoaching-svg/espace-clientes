-- ============================================================================
-- MIGRATION 10 — Suivi des connexions cliente (privé, dans ta base)
-- ----------------------------------------------------------------------------
-- Note la dernière connexion + le nb de visites de chaque cliente, pour que la
-- coach voie qui consulte son espace. Pas de tracker tiers : juste un horodatage.
-- La cliente appelle touch_connexion() à l'ouverture ; la fonction (SECURITY
-- DEFINER) ne met à jour QUE sa propre ligne (profile_id = auth.uid()).
-- À exécuter dans Supabase → SQL Editor. Idempotent.
-- ============================================================================

alter table public.clientes
  add column if not exists derniere_connexion timestamptz,
  add column if not exists nb_connexions integer not null default 0;

create or replace function public.touch_connexion()
returns void
language sql
security definer
set search_path = public
as $$
  update public.clientes
  set derniere_connexion = now(),
      nb_connexions = coalesce(nb_connexions, 0) + 1
  where profile_id = auth.uid();
$$;

grant execute on function public.touch_connexion() to authenticated;
