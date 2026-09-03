-- ticket_lines had no INSERT path for staff at all — one policy, holder-while-logging
-- only. Every sibling child table (ticket_items, ticket_assets, ticket_crew) already
-- carries a `for all ... is_staff()` policy that covers this; ticket_lines was the one
-- table in the family that never got it.
--
-- The client sends every job-log line through upsert() — INSERT ... ON CONFLICT DO
-- UPDATE — so editing an EXISTING line still has to pass the INSERT policy, not just the
-- UPDATE one. ticket_lines_update_staff already lets staff update; nothing let them
-- insert, which upsert always attempts first. hasPermission('ticket.edit_closed') already
-- tells the client staff may correct a settled ticket's log (app/index.html:9205,
-- readOnly = !ticket.log && !ticket.edit_closed) — the database just never learned the
-- rule the client already enforces.
--
-- Reproduced live before this migration: Lateri, admin, editing a line on ticket 1800
-- (status 'approved', not 'logging') was refused by ticket_lines_insert_holder with
-- exactly this shape — reported to the error log as MK-SYNC-RLS, first seen 2 Sep,
-- recurring every drain since because the op can never succeed and was pre-dating this
-- session's terminal-refusal work.
drop policy if exists ticket_lines_insert_holder on public.ticket_lines;

create policy ticket_lines_insert_holder_or_staff
  on public.ticket_lines
  for insert
  to authenticated
  with check (
    (exists (
      select 1 from public.tickets t
      where t.id = ticket_lines.ticket_id
        and t.holder_id = auth.uid()
        and t.status = 'logging'
    ))
    or is_staff()
  );
