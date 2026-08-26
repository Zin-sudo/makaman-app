-- 20260820 · snapshot_tickets_before_model_catchup   [APPLIED]
--
-- Recovered 2026-08-26 from supabase_migrations.schema_migrations, verbatim. Recorded
-- here for the same reason 0003 records the price-list snapshot: a backup table whose
-- provenance is not written down is a table nobody dares drop and nobody trusts.
--
-- Numbered 0005a because it ran between 0005 (merge_waha) and 0006 (app model catchup),
-- and the file order in this directory is the order things were applied.

-- Same discipline as the price-list normalise: a full copy before the schema moves.
create table if not exists backup.tickets_20260820 as select * from public.tickets;
create table if not exists backup.ticket_lines_20260820 as select * from public.ticket_lines;
create table if not exists backup.ticket_items_20260820 as select * from public.ticket_items;
create table if not exists backup.audit_log_20260820 as select * from public.audit_log;

comment on table backup.tickets_20260820 is
  'Snapshot of public.tickets taken 2026-08-20 before the schema was brought up to the app model (crew, geo, currency, assets, office closure).';
