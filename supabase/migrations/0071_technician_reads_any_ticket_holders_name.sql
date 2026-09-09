-- 20260910 · 0071_technician_reads_any_ticket_holders_name   [Part 5 of the session's
-- seven-part plan]
--
-- Owner's live report: viewing ticket 1882 as a technician (techtest2), the "someone else
-- holds this job" banner named nobody — "has this job now" instead of "Abobaker Awhida has
-- this job now."
--
-- Root cause, confirmed live: ticket 1882's technician_id/holder_id is Abobaker Awhida, who
-- opened and held it while swapped into "Work as Technician" — her real profiles.role is
-- ops_manager. Migration 0068's profiles_select_technician_team policy grants a technician
-- read access to another profile only where that profile's role = 'technician' — literally
-- true of the account, not "acting as one." Awhida's row (role = 'ops_manager') never
-- came back for techtest2's hydrate() pull of `profiles`, so nameById had nothing for her
-- id and t.holder/t.tech both resolved to '' client-side.
--
-- The owner's own standing instruction (this session): "don't treat work as technician
-- differently... all rules that apply to real technicians should also be applied to office
-- members when they use the Work as Technician feature." A technician reading the name of
-- whoever holds a ticket they can already see is exactly such a rule, and it must not
-- depend on that person's real role column.
--
-- Widened rather than replaced: a technician still may not read a staff/founder profile
-- through any OTHER path (the plain "other technicians" grant from 0068 stays), only
-- through a ticket they can already see — mirrors exactly how 0064/0069 scoped every other
-- ticket-adjacent read (ticket_lines, ticket_notes, ticket_assets), narrower than opening
-- `profiles` to every role outright.

drop policy profiles_select_technician_team on public.profiles;

create policy profiles_select_technician_team on public.profiles
  for select using (
    (public.current_role() = 'technician' and role = 'technician')
    or exists (
      select 1 from public.tickets t
      where t.technician_id = profiles.id or t.holder_id = profiles.id
    )
  );
