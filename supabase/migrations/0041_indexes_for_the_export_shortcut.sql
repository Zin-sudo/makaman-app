-- Two indexes, for the two queries that decide whether the master export has to be
-- rebuilt at all.
--
-- The scheduled export now asks "is the newest approval older than the last successful
-- run?" and skips the rebuild when it is. That question runs on every scheduled fire,
-- so it should not be a sequential scan the day this database is not almost empty.
--
-- Deliberately NOT added, though a review suggested them: profiles(email) and
-- profiles(role, status). That table holds five rows and is read whole on every sign-in.
-- An index on it would never be chosen by the planner and would cost a write on every
-- profile update to earn nothing.

-- master-export reads the newest SUCCESSFUL run and looks at finished_at. The existing
-- export_runs_kind_started_idx is on started_at, which is a different column and cannot
-- serve this ordering.
create index if not exists export_runs_kind_status_finished_idx
  on public.export_runs (kind, status, finished_at desc);

-- The newest approval. Partial, because rows with no approved_at are the majority and
-- are never what this query wants — the index stays the size of the approved set rather
-- than the size of the table.
create index if not exists tickets_approved_at_idx
  on public.tickets (approved_at desc)
  where approved_at is not null;
