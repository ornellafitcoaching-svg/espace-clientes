-- ============================================================================
-- MIGRATION 20 — Le questionnaire de démarrage renseigne le profil (pour TOUTES)
-- ----------------------------------------------------------------------------
-- Quand une cliente remplit son questionnaire, son objectif principal et sa
-- taille doivent apparaître automatiquement en haut de sa fiche côté coach
-- (et sur son accueil / son IMC). La cliente ne peut pas écrire la table
-- `clientes` (RLS) → fonction SECURITY DEFINER qui ne touche QUE son dossier
-- et n'écrase JAMAIS ce que la coach a déjà saisi.
-- + BACKFILL des clientes qui ont déjà rempli leur questionnaire (ex. Anne).
-- À exécuter dans Supabase → SQL Editor. Idempotent.
-- ============================================================================

-- 1) RPC appelée par la cliente à l'envoi du questionnaire.
create or replace function public.apply_questionnaire_profile(p_objectif text, p_taille numeric)
returns void
language sql
security definer
set search_path = public
as $$
  update public.clientes
  set objectif_principal = case
        when coalesce(btrim(p_objectif), '') <> '' and coalesce(objectif_principal, '') = ''
        then btrim(p_objectif) else objectif_principal end,
      taille_cm = case
        when p_taille is not null and p_taille > 0 and taille_cm is null
        then p_taille else taille_cm end
  where profile_id = auth.uid();
$$;
grant execute on function public.apply_questionnaire_profile(text, numeric) to authenticated;

-- 2) BACKFILL — objectif principal depuis le dernier questionnaire (sans écraser l'existant).
update public.clientes c
set objectif_principal = q.obj
from (
  select distinct on (cliente_id) cliente_id, nullif(btrim(reponses->>'objectifs'), '') as obj
  from public.questionnaire_initial
  order by cliente_id, date desc
) q
where c.id = q.cliente_id and q.obj is not null and coalesce(c.objectif_principal, '') = '';

-- 3) BACKFILL — taille (hauteur) depuis le dernier questionnaire (si non renseignée).
update public.clientes c
set taille_cm = replace(q.t, ',', '.')::numeric
from (
  select distinct on (cliente_id) cliente_id, nullif(btrim(reponses->>'taille'), '') as t
  from public.questionnaire_initial
  order by cliente_id, date desc
) q
where c.id = q.cliente_id and c.taille_cm is null
  and q.t ~ '^[0-9]+([.,][0-9]+)?$';

-- 4) BACKFILL — 1 objectif dans la section « Objectifs » si la cliente n'en a aucun.
insert into public.objectifs (cliente_id, titre, description, statut, date_creation)
select q.cliente_id, q.obj, q.pourquoi, 'en_cours', q.d
from (
  select distinct on (cliente_id) cliente_id,
    nullif(btrim(reponses->>'objectifs'), '') as obj,
    nullif(btrim(reponses->>'objectifs_pourquoi'), '') as pourquoi,
    date as d
  from public.questionnaire_initial
  order by cliente_id, date desc
) q
where q.obj is not null
  and not exists (select 1 from public.objectifs o where o.cliente_id = q.cliente_id);

-- 5) BACKFILL — poids de départ en mensuration si aucune mensuration 'poids' n'existe.
insert into public.mensurations (cliente_id, date, type, valeur, unite, saisi_par)
select q.cliente_id, q.d, 'poids', replace(q.p, ',', '.')::numeric, 'kg', 'cliente'
from (
  select distinct on (cliente_id) cliente_id, nullif(btrim(reponses->>'poids'), '') as p, date as d
  from public.questionnaire_initial
  order by cliente_id, date desc
) q
where q.p ~ '^[0-9]+([.,][0-9]+)?$'
  and not exists (select 1 from public.mensurations m where m.cliente_id = q.cliente_id and m.type = 'poids');
