-- Owner's report, 2026-09-09: "For the technicians role (Devices in field) only shows
-- their own device i want them to be able to see the other technicians too and who's
-- online and who's not."
--
-- The client-side code for this was already correct and already shipped —
-- fieldDeviceAccounts() (app/index.html) has computed "every active technician, plus
-- anyone else currently swapped into Work as Technician" since the earlier Field Devices
-- work this session, and the exact same binding already renders it on both the office's
-- Field Devices screen and the technician's own Sync tab (see techfielddevices.test.js,
-- passing). The bug was never in that derivation — it is that a technician's hydrate()
-- pull of `profiles` was silently starved at the database before any of that code ever
-- ran: profiles carried exactly two SELECT policies, "your own row" and "any staff
-- member, every row" — nothing let one technician's session read a SECOND technician's
-- row at all. hydrate()'s plain `select * from profiles` (app/index.html, unfiltered,
-- deliberately relying on RLS alone) came back with one row for a technician: themselves.
-- fieldDeviceAccounts() never had anyone else to show — not a rendering bug, a data
-- feed that was empty by construction, the same shape as the ticket_assets and
-- presence.id gaps found and fixed earlier this session.
--
-- Live proof before this migration: querying profiles as postgres shows four roles
-- (technician, ops_manager, admin, founder); profiles_select_own/profiles_select_staff
-- are the only two SELECT policies on the table, and neither's USING clause can ever be
-- satisfied by one technician reading another technician's row.
--
-- Scoped narrowly to match exactly what was asked — "the other technicians" — not a
-- blanket opening of the table: a technician gains read access to other TECHNICIAN
-- profiles only, not to admin/ops/observer rows they are not otherwise staff enough to
-- see. current_role() is already SECURITY DEFINER and already used this same way inside
-- is_staff() itself, so there is no new circularity here.
create policy profiles_select_technician_team on public.profiles
  for select using (
    public.current_role() = 'technician' and role = 'technician'
  );
