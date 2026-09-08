-- Companion to 0059. The client syncs ticket_crew wholesale — delete every row for the
-- ticket, then insert the current list (see CHILD_TABLES/diffOps in app/index.html) —
-- and ticket_crew_insert_holder let the holder of a 'logging' ticket add rows but nothing
-- let them delete any, ever. A handover's crew update is exactly a delete-then-insert, so
-- the delete step silently touched zero rows (RLS hides the existing rows from a DELETE
-- with no policy for them — not an error PostgREST reports, just nothing removed) and the
-- ticket was left carrying whatever crew rows happened to survive, never the corrected
-- list. Proven directly against this database: signed in as the real holder of a real
-- 'logging' ticket, `delete from ticket_crew where ticket_id = <that ticket>` — the
-- statement raised no error and the true row count (read back with RLS bypassed)
-- was unchanged.
create policy ticket_crew_delete_holder on public.ticket_crew
  for delete
  using (
    exists (
      select 1 from public.tickets t
      where t.id = ticket_crew.ticket_id and t.holder_id = auth.uid() and t.status = 'logging'
    )
  );
