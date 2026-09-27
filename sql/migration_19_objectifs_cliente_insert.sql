-- migration_19 — Objectif de la cliente remonté depuis le questionnaire de démarrage.
-- La cliente peut INSÉRER un objectif dans SON dossier uniquement (borné par my_cliente_id()).
-- Elle ne peut ni modifier ni supprimer les objectifs (pas d'update/delete côté cliente).
-- La LECTURE cliente existe déjà (policy objectifs_cliente_read générée dans schema.sql),
-- et la coach lit/écrit déjà les objectifs → l'objectif apparaît des deux côtés.

drop policy if exists objectifs_cliente_insert on public.objectifs;
create policy objectifs_cliente_insert on public.objectifs
  for insert with check (cliente_id = my_cliente_id());
