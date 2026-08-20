-- 20260820 · ticket_visibility_follows_the_crew   [PENDING — not yet applied]
--
-- Visibility was keyed to technician_id, which predates co-op. A job handed on would
-- vanish from the opener's list even though their name still prints on the sheet, and
-- the person who took it over could not see it at all. Crew membership decides instead.
drop policy if exists tickets_select_own on public.tickets;
drop policy if exists tickets_select_crew on public.tickets;
create policy tickets_select_crew on public.tickets for select
  using (exists (
    select 1 from public.ticket_crew c where c.ticket_id = id and c.profile_id = auth.uid()
  ) or technician_id = auth.uid());

-- The Observer also reads jobs running in the field — that is what the live panel and
-- the emergency coordinates are — not only finished ones. Still read-only: there is no
-- insert or update policy for this role anywhere.
drop policy if exists tickets_select_founder on public.tickets;
create policy tickets_select_founder on public.tickets for select
  using (public.current_role() = 'founder' and (status = 'approved' or (status = 'logging' and synced)));

-- Writing is the holder's, not the whole crew's: one pen at a time is the whole point of
-- handing a job over.
drop policy if exists tickets_update_own on public.tickets;
drop policy if exists tickets_update_holder on public.tickets;
create policy tickets_update_holder on public.tickets for update
  using (holder_id = auth.uid() or (holder_id is null and technician_id = auth.uid()))
  with check (holder_id = auth.uid() or (holder_id is null and technician_id = auth.uid()));

-- Job-log lines follow the same rule.
drop policy if exists ticket_lines_select_own on public.ticket_lines;
drop policy if exists ticket_lines_select_crew on public.ticket_lines;
create policy ticket_lines_select_crew on public.ticket_lines for select
  using (exists (
    select 1 from public.ticket_crew c where c.ticket_id = ticket_lines.ticket_id and c.profile_id = auth.uid()
  ));
drop policy if exists ticket_lines_select_founder on public.ticket_lines;
create policy ticket_lines_select_founder on public.ticket_lines for select
  using (public.current_role() = 'founder');

drop policy if exists ticket_lines_insert_own on public.ticket_lines;
drop policy if exists ticket_lines_insert_holder on public.ticket_lines;
create policy ticket_lines_insert_holder on public.ticket_lines for insert
  with check (exists (
    select 1 from public.tickets t
    where t.id = ticket_id and t.holder_id = auth.uid() and t.status = 'logging'
  ));

drop policy if exists ticket_lines_update_own on public.ticket_lines;
drop policy if exists ticket_lines_update_holder on public.ticket_lines;
create policy ticket_lines_update_holder on public.ticket_lines for update
  using (exists (
    select 1 from public.tickets t
    where t.id = ticket_id and t.holder_id = auth.uid() and t.status = 'logging'
  ));

-- Charged items and the audit trail are readable by the crew.
drop policy if exists ticket_items_select_own on public.ticket_items;
drop policy if exists ticket_items_select_crew on public.ticket_items;
create policy ticket_items_select_crew on public.ticket_items for select
  using (exists (
    select 1 from public.ticket_crew c where c.ticket_id = ticket_items.ticket_id and c.profile_id = auth.uid()
  ));

drop policy if exists audit_log_select_own on public.audit_log;
drop policy if exists audit_log_select_crew on public.audit_log;
create policy audit_log_select_crew on public.audit_log for select
  using (kind = 'lifecycle' and exists (
    select 1 from public.ticket_crew c where c.ticket_id = audit_log.ticket_id and c.profile_id = auth.uid()
  ));

-- The Observer reads job stages company-wide, and nothing else. Enforced here as well as
-- in the UI: a filter that only exists in the client is a preference, not a rule.
drop policy if exists audit_log_select_founder on public.audit_log;
create policy audit_log_select_founder on public.audit_log for select
  using (public.current_role() = 'founder' and kind = 'lifecycle');
