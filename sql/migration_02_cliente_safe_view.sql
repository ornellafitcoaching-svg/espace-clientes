-- ============================================================================
-- MIGRATION 02 — Durcissement RLS côté CLIENTE (santé jamais lisible)
-- ----------------------------------------------------------------------------
-- Problème : la policy clientes_self_read laissait la cliente LIRE sa ligne
-- complète (dont sante, allergies, telephone, email_perso, access_code) via
-- l'API, même si l'UI ne les affiche pas. Le cahier des charges impose que la
-- cliente ne voie JAMAIS la santé sensible → on coupe l'accès brut à la table
-- et on expose une VUE ne contenant que les champs non-sensibles.
--
-- À exécuter UNE FOIS dans Supabase → SQL Editor. Idempotent.
-- ============================================================================

-- 1) Vue "ma_fiche" : SA fiche, colonnes non-sensibles uniquement.
--    security_invoker = false (définisseur) → contourne la RLS de clientes et
--    ne renvoie que les colonnes listées, filtrées sur profile_id = auth.uid().
--    (Sont volontairement EXCLUS : sante, allergies, telephone, email_perso,
--     access_code, profile_id.)
create or replace view public.ma_fiche
with (security_invoker = false) as
  select
    id, prenom, nom, type, statut,
    objectif_principal, objectifs_secondaires,
    niveau, disponibilites, taille_cm, date_naissance,
    created_at
  from public.clientes
  where profile_id = auth.uid();

grant select on public.ma_fiche to authenticated;

-- 2) On retire l'accès BRUT de la cliente à la table clientes.
--    (La coach garde tous ses droits via clientes_coach_all.)
--    Les policies des autres tables utilisent my_cliente_id() qui est
--    SECURITY DEFINER : elles continuent de fonctionner sans cette policy.
drop policy if exists clientes_self_read on public.clientes;

-- 3) Idem pour l'accompagnement : la cliente pouvait lire "prix". On la laisse
--    lire l'accompagnement (dates, formule, nutrition) mais SANS le prix, via
--    une vue dédiée, et on retire sa lecture brute de la table.
create or replace view public.mon_accompagnement
with (security_invoker = false) as
  select
    a.id, a.cliente_id,
    a.date_debut, a.date_fin, a.nb_mois, a.formule,
    a.freq_prevue, a.seances_prevues,
    a.nutrition_active, a.nut_date_debut, a.nut_date_fin, a.nut_nb_mois,
    a.created_at
  from public.accompagnements a
  join public.clientes c on c.id = a.cliente_id
  where c.profile_id = auth.uid();

grant select on public.mon_accompagnement to authenticated;

drop policy if exists accompagnements_cliente_read on public.accompagnements;

-- ============================================================================
-- Vérifs (facultatif) :
--   select * from public.ma_fiche;           -- en session cliente : sa fiche safe
--   select * from public.mon_accompagnement;  -- en session cliente : sans prix
--   -- la coach n'est pas affectée (policies *_coach_all inchangées).
-- ============================================================================
