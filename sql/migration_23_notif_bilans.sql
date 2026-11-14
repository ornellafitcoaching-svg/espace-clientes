-- ============================================================================
-- Migration 23 — Notification coach : email à Ornella dès qu'une cliente envoie
-- un bilan, des mensurations, un bilan de démarrage ou un questionnaire.
-- ----------------------------------------------------------------------------
--  • notif_coach_at : null = pas encore signalé à Ornella (géré par notif-bilans).
--  • Tout ce qui existe AVANT cette migration est marqué comme déjà signalé
--    (aucun email rétroactif).
--  • Seules les lignes saisi_par = 'cliente' déclenchent un email.
-- ============================================================================
alter table public.bilans                  add column if not exists notif_coach_at timestamptz;
alter table public.mensurations            add column if not exists notif_coach_at timestamptz;
alter table public.bilans_demarrage        add column if not exists notif_coach_at timestamptz;
alter table public.questionnaire_initial   add column if not exists notif_coach_at timestamptz;
alter table public.questionnaire_nutrition add column if not exists notif_coach_at timestamptz;

update public.bilans                  set notif_coach_at = now() where notif_coach_at is null;
update public.mensurations            set notif_coach_at = now() where notif_coach_at is null;
update public.bilans_demarrage        set notif_coach_at = now() where notif_coach_at is null;
update public.questionnaire_initial   set notif_coach_at = now() where notif_coach_at is null;
update public.questionnaire_nutrition set notif_coach_at = now() where notif_coach_at is null;

-- Passage toutes les 2 min (regroupement 2 min géré dans la fonction).
select cron.unschedule('notif-bilans-2min') where exists (select 1 from cron.job where jobname = 'notif-bilans-2min');
select cron.schedule('notif-bilans-2min', '*/2 * * * *', $cron$
  select net.http_post(
    url := 'https://xvetwfqzkkcfchxxifuu.supabase.co/functions/v1/notif-bilans',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from private.config where key='cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000);
$cron$);
