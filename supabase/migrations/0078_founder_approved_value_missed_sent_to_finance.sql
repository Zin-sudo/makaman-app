-- 2026-09-11, owner's report, with numbers: the Observer (Ali) sees "Approved value" as
-- $8,000 / 0 LYD; ops_manager (Awhida), on the same data, sees $11,253.00 / 12,500.000
-- LYD. Same client code computes both totals — app/index.html's totalByCurrency(approved)
-- is one function, called with the same `approved = LIVE.filter(x => settled(x))` list for
-- mgrStats and founderStats alike (settled() = status in ['approved', 'sent_finance']) —
-- so the gap could only be the rows actually reaching each account's device.
--
-- ticket_items_select_founder (migration 0001) was written back when the founder could
-- only ever look at an 'approved' ticket at all, and it gates SELECT on exactly that:
--   current_role() = 'founder' and exists (... t.status = 'approved')
-- Once a ticket moves on to 'sent_finance' its line items simply stop being visible to
-- founder — is_staff() has no such limit, so ops_manager/admin keep seeing them. The
-- "Approved value" stat sums both statuses (settled(), not status === 'approved'), so
-- every ticket that had already progressed to Sent to Finance silently dropped out of the
-- founder's own total while staying in everyone else's — LYD 12,500 here was one such
-- ticket's entire contribution, gone to 0.
--
-- This is the same class of already-live-three-times bug CLAUDE.md tracks: an RLS
-- boundary that quietly stopped matching the app's own notion of "settled" once founder's
-- reach was widened elsewhere (migrations 0064/0069) without this policy being revisited.
--
-- Fix: widen the status check to both SETTLED_STATES values, no further. This is
-- deliberately NOT a blanket "founder reads all ticket_items" grant — CLAUDE.md's own
-- activity-visibility rule keeps pricing office-only beyond this one already-established
-- carve-out for the Approved-value total; a ticket still in 'logging', 'done', 'cancelled'
-- etc. stays invisible to founder here, exactly as before.
drop policy if exists ticket_items_select_founder on public.ticket_items;
create policy ticket_items_select_founder on public.ticket_items for select
  using (
    public.current_role() = 'founder'
    and exists (
      select 1 from public.tickets t
      where t.id = ticket_id and t.status in ('approved', 'sent_finance')
    )
  );
