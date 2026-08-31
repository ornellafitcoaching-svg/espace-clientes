-- Bilan rempli par la cliente : colonne "qui a rempli" + droit d'insertion limité au dossier.
alter table public.bilans add column if not exists saisi_par text not null default 'coach';
drop policy if exists bilans_cliente_insert on public.bilans;
create policy bilans_cliente_insert on public.bilans
  for insert with check (cliente_id = my_cliente_id());
