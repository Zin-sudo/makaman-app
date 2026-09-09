-- Every technician's answer to an allocated-asset question has been refused by RLS on
-- first attempt, permanently, since this table was created — proven live, 2026-09-09:
-- select count(*) from ticket_assets returns 0 against 7 real tickets and a live
-- asset_questions row. The three existing policies (ticket_assets_write_staff ALL,
-- ticket_assets_select_crew, ticket_assets_select_staff) leave no INSERT/UPDATE/DELETE
-- policy a technician can ever satisfy — the delete-then-insert `replace` outboxSend
-- sends (app/index.html) deletes nothing (RLS hides rows it has no policy for, which is
-- not an error) and then the insert is refused outright, every time, for every
-- technician, on every ticket that has asset questions answered. Same shape as 0060
-- (ticket_crew's missing holder DELETE): the holder of a still-logging ticket gets a
-- real write path.
create policy ticket_assets_write_holder on public.ticket_assets for all
  using (exists (
    select 1 from public.tickets t
    where t.id = ticket_assets.ticket_id
      and t.holder_id = auth.uid()
      and t.status = 'logging'
  ))
  with check (exists (
    select 1 from public.tickets t
    where t.id = ticket_assets.ticket_id
      and t.holder_id = auth.uid()
      and t.status = 'logging'
  ));
