-- A deliberate widening, not a bug fix. Verified live before this migration: a
-- technician's browser today never receives another technician's ticket at all unless
-- they are on its crew (tickets_select_crew) — RLS already enforces "cannot access a
-- colleague's ticket" at the database. The owner's separate request — "a technician is
-- allowed to read the stage changes of other technicians but not enter the tickets of
-- their colleagues... they can access and see an open job-log of a fellow worker from
-- the activity tab but they cannot touch anything on it" — is a narrow, intentional
-- widening on top of that, not a reversal of it: company-wide SELECT on tickets,
-- ticket_lines and audit_log (lifecycle entries only) for any technician, while
-- ticket_items, ticket_assets and ticket_notes (pricing, charged lines, private notes)
-- stay exactly as crew-scoped as they already were. A technician opening a colleague's
-- job from Activity sees the header, the job log and its lifecycle trail — never the
-- priced items — and the client's own isHolder gate (app/index.html) greys out every
-- input on a ticket that isn't theirs to hold, so the read access this migration grants
-- is display-only in practice, not just in intent: every write path (tickets_update_holder,
-- ticket_lines_update_holder, enforce_ticket_update_rules) still requires holder_id =
-- auth.uid(), untouched by this migration.
alter policy tickets_select_crew on public.tickets
  using (
    exists (
      select 1 from public.ticket_crew c
      where c.ticket_id = tickets.id and c.profile_id = auth.uid()
    )
    or technician_id = auth.uid()
    or "current_role"() = 'technician'
  );

alter policy ticket_lines_select_crew on public.ticket_lines
  using (
    exists (
      select 1 from public.ticket_crew c
      where c.ticket_id = ticket_lines.ticket_id and c.profile_id = auth.uid()
    )
    or "current_role"() = 'technician'
  );

-- Unchanged: still lifecycle-only. A technician reading a colleague's stage changes
-- does not also get the deeper edit trail — the same narrowing reviewlog.test.js already
-- proves for the Observer ("THE EDIT IS WITHHELD") applies here for the same reason: a
-- price override or a manual correction is office business, not a stage a bystander
-- watches happen.
alter policy audit_log_select_crew on public.audit_log
  using (
    kind = 'lifecycle'
    and (
      exists (
        select 1 from public.ticket_crew c
        where c.ticket_id = audit_log.ticket_id and c.profile_id = auth.uid()
      )
      or "current_role"() = 'technician'
    )
  );
