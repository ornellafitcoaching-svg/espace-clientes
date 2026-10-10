-- ============================================================================
-- Migration 21 — Photos de suivi : notification cliente + badge « Nouveau »
-- ----------------------------------------------------------------------------
--  • visible_depuis   : quand la photo est devenue visible par la cliente
--                       (ajout « visible cliente » ou passage privé → visible).
--  • notif_envoyee_at : null = email pas encore envoyé (géré par notif-photos).
--  • vue_cliente_at   : null = pas encore vue → badge « Nouveau » dans son espace.
--  Les photos « privé (coach) » ne déclenchent rien.
--  Les photos déjà visibles AVANT cette migration sont marquées notifiées + vues
--  (aucun email ni badge rétroactif).
-- ============================================================================
alter table public.photos
  add column if not exists visible_depuis   timestamptz,
  add column if not exists notif_envoyee_at timestamptz,
  add column if not exists vue_cliente_at   timestamptz;

update public.photos
   set visible_depuis   = coalesce(visible_depuis, created_at),
       notif_envoyee_at = coalesce(notif_envoyee_at, now()),
       vue_cliente_at   = coalesce(vue_cliente_at, now())
 where visibilite = 'cliente';

-- Chaque fois qu'une photo DEVIENT visible cliente → nouvelle notif + nouveau badge.
create or replace function public.photos_suivi_visibilite()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.visibilite = 'cliente' and (tg_op = 'INSERT' or old.visibilite is distinct from 'cliente') then
    new.visible_depuis   := now();
    new.notif_envoyee_at := null;
    new.vue_cliente_at   := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_photos_suivi_visibilite on public.photos;
create trigger trg_photos_suivi_visibilite
  before insert or update of visibilite on public.photos
  for each row execute function public.photos_suivi_visibilite();

-- La cliente n'a que le droit de LIRE ses photos : cette fonction (et elle seule)
-- lui permet de marquer SES photos visibles comme vues.
create or replace function public.marquer_photos_vues()
returns void language sql security definer set search_path = public as $$
  update public.photos
     set vue_cliente_at = now()
   where cliente_id = public.my_cliente_id()
     and visibilite = 'cliente'
     and vue_cliente_at is null;
$$;
revoke all on function public.marquer_photos_vues() from public, anon;
grant execute on function public.marquer_photos_vues() to authenticated;

-- Passage toutes les 5 min (regroupement 10 min géré dans la fonction).
select cron.unschedule('notif-photos-5min') where exists (select 1 from cron.job where jobname = 'notif-photos-5min');
select cron.schedule('notif-photos-5min', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://xvetwfqzkkcfchxxifuu.supabase.co/functions/v1/notif-photos',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from private.config where key='cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000);
$cron$);
