-- Reported live, 2026-09-05, found while auditing the reliability of every user-triggered
-- action in the PWA: a technician's "Hand over this job?" has been completely unsendable
-- since tickets_update_holder was created (0008, 2026-08-20) — not a retry or timing bug,
-- a first-attempt, unconditional, permanent RLS refusal, on every single attempt, for
-- every technician, ever since. Proven directly against this database, not guessed:
-- signed in as the real holder of a real 'logging' ticket, `update tickets set holder_id =
-- <someone else> where id = <ticket> and holder_id = auth.uid()` — the row is plainly
-- visible (USING passes; the caller is the holder) — and Postgres still raised
-- "new row violates row-level security policy for table tickets".
--
-- The cause: tickets_update_holder's WITH CHECK re-tested `holder_id = auth.uid()` against
-- the RESULTING row, not the existing one. USING already restricts which rows a
-- technician may touch at all (the one they hold, or an unclaimed one they opened) — that
-- is the actual security boundary, and it is unaffected by this change. WITH CHECK's own
-- copy of the same clause meant the one column this policy exists to let a holder change
-- — who holds it — was the one column it could never actually become anything else.
--
-- Safe to drop: enforce_ticket_update_rules() (0039) already gates everything a technician
-- may change on a 'logging' ticket at the trigger level — ticket_number, mileage,
-- client_id, job_type_id, approved_by/approved_at, and status itself are all indepen-
-- dently blocked there for a non-staff caller, regardless of what RLS allows. Nothing in
-- that trigger objects to holder_id changing on an in-progress ticket; the RLS policy was
-- the only place forbidding the one thing this feature is for.
drop policy if exists tickets_update_holder on public.tickets;
create policy tickets_update_holder on public.tickets
  for update
  using (holder_id = auth.uid() or (holder_id is null and technician_id = auth.uid()))
  with check (true);
