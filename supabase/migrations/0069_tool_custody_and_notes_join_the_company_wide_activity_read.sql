-- 2026-09-09, owner's request: technicians and Observers should read the same operational
-- history everywhere in the app — ticket openings, log-lines, status changes, handovers,
-- notes, tools allocated, downloaded/uploaded sheets — for EVERY ticket, not only their
-- own; they may act on almost none of it (a technician may still only edit/note/attach to
-- a ticket they hold; the Observer may only add notes). Migration 0064 already opened
-- tickets/ticket_lines/audit_log(lifecycle) company-wide for technicians, but deliberately
-- left ticket_items, ticket_assets and ticket_notes crew-scoped ("pricing, charged lines,
-- private notes"). This migration narrows that list to just ticket_items (pricing stays
-- office business, exactly as before — the owner's list of what should be visible never
-- mentions cost) and brings ticket_assets ("tools allocated") and ticket_notes ("notes")
-- into the same company-wide read tickets/ticket_lines/audit_log already have.
--
-- Three more gaps found and closed in the same pass, verified live against
-- igutjfezxkdncrcpvnqx before this migration:
--
--   1. ticket_assets_select_crew's EXISTS clause compared `c.ticket_id = c.ticket_id` — a
--      column to itself, never to the outer ticket_assets row. That is trivially true for
--      any row in ticket_crew, so the policy actually granted every crew member of ANY
--      ticket read access to ticket_assets rows on EVERY ticket, not just their own — a
--      real cross-ticket leak, just not yet exploitable: `select count(*) from
--      ticket_assets` returns 0 live (nobody has completed the closing-questions flow
--      yet). Fixed by correlating to ticket_assets.ticket_id, same shape as its sibling
--      policies.
--   2. tickets_select_founder only matched status IN ('approved', 'logging' with synced) —
--      so a ticket the Observer could see while it was `approved` became invisible the
--      moment it advanced to `sent_client`/`sent_finance`, and was never visible at all
--      while `done`-but-unsynced or `cancelled`. That contradicts the point of Observer
--      oversight (a ticket does not stop existing once it moves) and directly contradicts
--      the new instruction ("they can see all tickets"). Widened to unconditional, matching
--      ticket_lines_select_founder and ticket_notes_select_founder, which were already
--      unconditional — this was the one table lagging behind its own siblings.
--   3. can_see_ticket() (gates ticket_attachments — the signed sheets that come back after
--      approval) never had a technician branch, so a technician reading a colleague's
--      ticket via the widened Activity view still could not see whether the signed
--      paperwork had come back. Added, matching the technician branch every other table's
--      policy already carries.
--
-- ticket_items (pricing) and its write policies are untouched — still crew/staff/
-- founder-when-approved only. So is every WRITE policy: ticket_notes_insert_viewer and
-- can_attach_to_ticket() still require being on the ticket's crew (staff and the Observer
-- excepted, per their own existing rules) — "read everywhere, write only on your own
-- ticket" is a SELECT-only change throughout this migration.

alter policy ticket_assets_select_crew on public.ticket_assets
  using (
    exists (
      select 1 from public.ticket_crew c
      where c.ticket_id = ticket_assets.ticket_id and c.profile_id = auth.uid()
    )
    or "current_role"() = 'technician'
  );

create policy ticket_assets_select_founder on public.ticket_assets for select
  using ("current_role"() = 'founder');

alter policy ticket_notes_select_crew on public.ticket_notes
  using (
    exists (
      select 1 from public.ticket_crew c
      where c.ticket_id = ticket_notes.ticket_id and c.profile_id = ( select auth.uid() )
    )
    or "current_role"() = 'technician'
  );

alter policy tickets_select_founder on public.tickets
  using ("current_role"() = 'founder');

create or replace function public.can_see_ticket(p_ticket uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    (select public.is_staff())
    or (select public.current_role()) in ('founder', 'technician')
    or exists (select 1 from public.ticket_crew c
               where c.ticket_id = p_ticket
                 and c.profile_id = (select auth.uid()));
$function$;
