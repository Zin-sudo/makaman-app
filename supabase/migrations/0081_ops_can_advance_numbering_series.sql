-- 2026-09-19, owner's request behind migration 0072 (numbering.override_floor):
-- "an admin option that can also be used by the ops to override this restriction for
-- special cases" — that migration granted ops_manager the CAPABILITY, and the client
-- correctly shows the override checkbox and the "Take next from series" buttons to
-- ops_manager. But ticket_numbering_write_admin (0001_init.sql) still restricted every
-- write on public.ticket_numbering to admin alone, so the moment an Ops Manager actually
-- used either control, the client's own advance-the-counter upsert was refused outright
-- by RLS — proven live, 2026-09-19 (awhida@makaman.ly, role ops_manager): "new row
-- violates row-level security policy for table ticket_numbering", MK-SYNC-RLS, on the
-- exact upsert app/index.html's outboxDiff pushes whenever `d.series` changes. The
-- capability existed; the write it depends on never did.
--
-- Split rather than simply widened: only UPDATE moves to is_staff(), because that is the
-- only operation the client ever performs on this table — advancing next_number/floor on
-- a series row that already exists. There is no control anywhere in the app for creating
-- a brand new series (a new prefix) or deleting one; both stay admin-only; INSERT/DELETE
-- were never reachable through ops_manager's own workflow and widening them would be
-- granting something nobody asked for.
drop policy if exists ticket_numbering_write_admin on public.ticket_numbering;

create policy ticket_numbering_update_staff on public.ticket_numbering for update
  using (public.is_staff()) with check (public.is_staff());

create policy ticket_numbering_insert_admin on public.ticket_numbering for insert
  with check (public.current_role() = 'admin');

create policy ticket_numbering_delete_admin on public.ticket_numbering for delete
  using (public.current_role() = 'admin');
