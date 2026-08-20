-- 20260820093854 · snapshot_price_lists_before_item_number_normalise
-- Point-in-time copy taken immediately before the item-number normaliser runs.
-- Full row copies, not just the changed column, so a restore needs no reconstruction.
create schema if not exists backup;

create table if not exists backup.price_list_items_20260820 as
  select * from price_list_items;

create table if not exists backup.clients_20260820 as
  select * from clients;

comment on table backup.price_list_items_20260820 is
  'Snapshot of public.price_list_items taken 2026-08-20 before normalising item_number. Raw values exactly as imported from the client price-list workbooks.';
comment on table backup.clients_20260820 is
  'Snapshot of public.clients taken 2026-08-20 alongside the price_list_items snapshot.';
