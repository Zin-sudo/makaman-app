-- Found live, 2026-09-05, tracing why a hand-over's crew update was STILL refused after
-- 0059/0060 fixed the header and added the missing DELETE policy.
--
-- ticket_crew_insert_holder (0008) and ticket_crew_delete_holder (0060) both check
-- `exists (select 1 from tickets t where t.id = ... and t.holder_id = auth.uid() and
-- t.status = 'logging')` — a plain subquery, run as the caller, so it is itself subject to
-- tickets' own RLS. tickets_select_crew reads: crew membership (via ticket_crew) OR
-- technician_id = auth.uid(). For the ticket's ORIGINAL technician that second clause
-- always saves them. For anyone who received the job through a hand-over — holder_id, not
-- technician_id — their ONLY route to seeing the ticket at all is their own row in
-- ticket_crew. The moment that row is deleted (exactly what a crew replace's first half
-- does, same transaction), tickets_select_crew can no longer see the ticket for them —
-- not because they stopped holding it, but because the visibility check that answers "can
-- I even read this row" now has nothing to stand on. And once `tickets` is invisible to
-- them, the ticket_crew policies that need to read it to confirm holder_id/status fail
-- too — a circular dependency, not a permissions gap.
--
-- Proven directly: signed in as the real holder of a real ticket whose technician_id is
-- someone else (an already-handed-over job), the plain boolean
-- `exists (select 1 from tickets where id=X and holder_id=auth.uid() and status='logging')`
-- read true on its own — and the SAME expression, as an INSERT's WITH CHECK one statement
-- later in the same transaction, failed, the instant that account's own ticket_crew row
-- had been deleted first.
--
-- The fix already exists in this schema for exactly this shape: can_attach_to_ticket() and
-- can_see_ticket() are SECURITY DEFINER, so they answer from the FUNCTION OWNER's view of
-- the tables, not the caller's RLS-filtered one — breaking the circularity instead of
-- routing through it. ticket_crew's own insert/delete gates get the same treatment.
create or replace function public.is_holder_of_logging_ticket(p_ticket uuid)
returns boolean
language sql stable security definer
set search_path = public
as $function$
  select exists (
    select 1 from public.tickets t
    where t.id = p_ticket and t.holder_id = auth.uid() and t.status = 'logging'
  );
$function$;

revoke execute on function public.is_holder_of_logging_ticket(uuid) from public, anon;
grant execute on function public.is_holder_of_logging_ticket(uuid) to authenticated;

drop policy if exists ticket_crew_insert_holder on public.ticket_crew;
create policy ticket_crew_insert_holder on public.ticket_crew
  for insert
  with check (public.is_holder_of_logging_ticket(ticket_id));

drop policy if exists ticket_crew_delete_holder on public.ticket_crew;
create policy ticket_crew_delete_holder on public.ticket_crew
  for delete
  using (public.is_holder_of_logging_ticket(ticket_id));
