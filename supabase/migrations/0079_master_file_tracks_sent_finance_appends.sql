-- 2026-09-11, owner's request: the "Master file" feature (Reports tile, Rebuild/Download,
-- the master-export Edge Function, the per-minute scheduler) already existed, but built a
-- generic 21-column "Approved Jobs" flat report — a placeholder from before the owner's
-- real company workbook (Special Tools / Fishing / Drilling, three real Excel Tables with
-- formulas) was available. Replacing what it builds, not adding a second "master file":
-- the real workbook gets APPENDED to (never rebuilt from scratch — finance's own hand
-- entries in columns Q onward must survive every future run untouched), one new row per
-- ticket the moment it reaches 'sent_finance', not 'approved'.
--
-- An append-only design needs its own idempotency record — "has this ticket already been
-- written to the workbook" cannot be answered by re-deriving it from the tickets table,
-- since the whole point is that old rows are never touched or rebuilt. This is that record.
create table public.master_export_log (
  ticket_id uuid primary key references public.tickets(id) on delete cascade,
  sheet text not null,
  row_number integer not null,
  appended_at timestamptz not null default now()
);

alter table public.master_export_log enable row level security;

-- Same read audience as export_runs itself (migration that introduced it) — staff, plus
-- the Observer per CLAUDE.md's activity-visibility rule. No insert/update/delete policy at
-- all: only the master-export Edge Function's service-role key may ever write this table,
-- the same reasoning purge_confirmation_codes already uses for a table nothing client-side
-- should be able to touch directly.
create policy master_export_log_select_staff on public.master_export_log for select
  using (is_staff() or public."current_role"() = 'founder');

-- master_export_due() (created for the old "approved" export) now asks the question the
-- real workbook actually cares about: is there a sent_finance ticket this log has never
-- recorded? Compares against master_export_log directly rather than a timestamp, since an
-- append-only design has no "everything since the last run" shortcut — every ticket either
-- has a row already or it does not.
create or replace function public.master_export_due()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.tickets t
    where t.status = 'sent_finance'
      and not exists (select 1 from public.master_export_log l where l.ticket_id = t.id)
  );
$$;
