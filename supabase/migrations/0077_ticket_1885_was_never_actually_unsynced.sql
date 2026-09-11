-- 2026-09-11, owner's report: ticket 1885 (approved, Waha Oil Company / WELL-11) was
-- invisible under the Ticket Inbox's own "Approved" filter — visible only through the
-- Collect Signature/Stamp tile's separate query, which never checked this at all. Root
-- cause: this row's own synced/synced_at columns were stuck false/null — a straggler
-- from the four-way duplicate-ticket incident this session already fixed the client-side
-- and database-level cause of (migration 0075, claimTicketCreate). The app's own
-- everReached() check (app/index.html) trusted synced/synced_at as proof a ticket had
-- ever reached the server, and this row disproved that trust: it obviously HAD reached
-- the server — it is sitting here approved, which cannot happen without a successful,
-- accepted write — the two columns were simply never flipped back afterward.
--
-- app/index.html's own fix (the same commit) stops trusting a stale sync bit once a
-- ticket has moved past 'logging' at all. This is the one-time data repair for the
-- specific row that prompted it: nothing will ever resend this header now, so nothing
-- will ever correct these columns on its own. synced_at is backfilled from the row's own
-- last update — the closest honest record of when this ticket was actually last touched
-- — the same reasoning migration 0074 already used to backfill sent_finance_at for
-- ticket 1883's own stuck-status incident.
--
-- Confirmed live, before this migration: exactly one row in the whole table matches this
-- shape (synced = false, synced_at is null, status <> 'logging') — this ticket alone.
update public.tickets
  set synced = true,
      synced_at = updated_at
  where id = '3cb1bdfb-6d23-4584-bb3a-8cce7cca09eb'
    and synced = false
    and synced_at is null
    and status <> 'logging';
