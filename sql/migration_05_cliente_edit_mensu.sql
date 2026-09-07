-- Autorise la cliente à CORRIGER (modifier / supprimer) ses propres mensurations,
-- depuis son espace, en cas d'erreur de saisie. Limité à SON dossier (my_cliente_id()).
-- Elle ne peut toujours pas toucher aux autres tables ni aux dossiers des autres.
-- Le coach n'est pas affecté (ses policies existantes restent prioritaires).

drop policy if exists mensurations_cliente_update on public.mensurations;
create policy mensurations_cliente_update on public.mensurations
  for update
  using      (cliente_id = my_cliente_id())
  with check (cliente_id = my_cliente_id());

drop policy if exists mensurations_cliente_delete on public.mensurations;
create policy mensurations_cliente_delete on public.mensurations
  for delete
  using (cliente_id = my_cliente_id());
