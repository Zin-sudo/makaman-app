-- The office may raise a ticket for a technician.
--
-- The reported fault: "Ticket created by Lateri and assigned to Tech1 didn't reach other
-- roles — not the observer, not Tech1, not Awhida." It did not reach them because it never
-- reached the database. The insert policy read:
--
--     with check (technician_id = auth.uid()
--                 and current_role() = any (array['technician','admin']))
--
-- which says: you may create a ticket, and the technician on it must be YOU. An admin
-- raising a job for somebody else fails the first half; an Ops Manager fails the second
-- half and could not raise one at all. Both were refused by RLS, and both are things the
-- app has a whole screen for — "Raise ticket", createMgrTicket, the technician dropdown
-- on it. The client wrote the row locally, queued it, and the queue was told no.
--
-- The rule that was meant is about who may CREATE work, not about whose name goes on it:
--
--   · a technician raises his own job, and only his own;
--   · the office raises a job for whoever is going to run it.
--
-- Reading it stays as it was. A technician still sees only what he is on (tickets_select_crew),
-- the office sees everything (tickets_select_staff), and the Observer sees approved jobs and
-- live ones (tickets_select_founder) — so a ticket raised for Tech1 now appears for Tech1
-- because he is its technician, for Awhida because he is staff, and for the Observer once it
-- is live or approved. Nothing here widens who can read anything.
--
-- Verified by impersonation after applying, all five cases:
--   admin raises for a technician    ALLOWED
--   ops manager raises for one       ALLOWED
--   technician raises for himself    ALLOWED
--   technician raises in another name REFUSED
--   observer raises                  REFUSED

drop policy if exists tickets_insert_own on public.tickets;

create policy tickets_insert_own on public.tickets
  for insert to authenticated
  with check (
    -- The technician raising his own job. Unchanged, and still the only thing a
    -- technician may do: he cannot create work in somebody else's name.
    (technician_id = (select auth.uid()) and public."current_role"() = 'technician')
    -- Or the office, raising one for whoever will run it. Admin was already allowed to
    -- insert and simply could not name anyone else; Ops Manager was not allowed at all,
    -- which is the role that raises most of these.
    or public.is_staff()
  );
