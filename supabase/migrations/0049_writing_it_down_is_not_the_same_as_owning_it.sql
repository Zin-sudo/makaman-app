-- audit_log's insert policy had an AND where the design needs an OR, and it was refusing
-- most of what actually happens in this app.
--
-- The only insert policy on public.audit_log read:
--
--   with check (is_staff() AND changed_by = auth.uid())
--
-- That passes exactly one case: staff writing an entry attributed to themselves. Two other
-- cases this app relies on constantly were both refused:
--
--   · a technician recording their OWN action (changed_by = auth.uid(), is_staff() false)
--     — every job-log line, every note, every status change a technician makes;
--   · staff recording an entry attributed to someone ELSE — "Approved on behalf of…",
--     "Closed in the office by…", the whole officeClose/officeClosed flow — where
--     changed_by is the technician's id, not the signed-in staff member's.
--
-- Confirmed live on 2 Sep against the trial's real error log (7 MK-SYNC-RLS occurrences)
-- and matches the "N changes refused by the server" banner reported the same day.
--
-- Fix: anyone may record their own action; staff may additionally record one attributed to
-- someone else. Writing something down is not the same privilege as acting AS someone else
-- — that stays gated by is_staff() alone, which is unchanged here.
drop policy if exists audit_log_insert_staff on public.audit_log;

create policy audit_log_insert_own_or_staff
  on public.audit_log
  for insert
  to authenticated
  with check (changed_by = auth.uid() OR is_staff());
