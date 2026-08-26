-- 20260826 · 0026_notifications_derived_from_the_audit_trail   [APPLIED]
--
-- Superseded in part by 0027 and 0028 the same day — see those files. What survives from
-- this migration is the decision NOT to build a notifications table, and the index.
--
-- The plan called for a notifications table fanned out by a trigger. audit_log is already
-- the event stream: every lifecycle change carries the ticket, the actor and the time, and
-- its RLS already decides who may see what. A second table would be a copy of a truth that
-- already exists, kept in step by a trigger — and this project has been bitten repeatedly
-- by two records of one fact drifting apart in silence.
--
-- The unread query filters and orders on changed_at, which had no index; audit_log only
-- carried one on ticket_id.
create index if not exists audit_log_changed_at_idx
  on public.audit_log (changed_at desc);

-- The read marker and its writer were created here on profiles, and moved to
-- user_settings by 0028. Recorded for the history; do not re-apply.
