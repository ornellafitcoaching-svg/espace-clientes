-- Autorise la cliente à AJOUTER ses propres mensurations depuis son espace.
-- Insert limité à SON dossier (my_cliente_id()) ; elle ne peut ni modifier ni supprimer,
-- ni toucher aux autres tables. Coach non affecté.
drop policy if exists mensurations_cliente_insert on public.mensurations;
create policy mensurations_cliente_insert on public.mensurations
  for insert with check (cliente_id = my_cliente_id());
