-- The price lists stop being an Admin-only screen.
--
-- The instruction (user, 2026-08-27) was that "the admin and ops manager will go through
-- the price lists one by one to validate using admin page". The screen was gated
-- `S.role === 'admin'`, so the Ops Manager could not open it at all — he could be sent a
-- list of corrections and had no way to make any of them.
--
-- Three capabilities rather than one, because the destructive action deserves its own
-- switch: an office that should correct a wrong price does not necessarily need to be
-- able to remove the line entirely, and separating them now means that decision can be
-- taken later without another migration.
--
-- This must be a migration and not only a constant in the client. `has_permission()` is
-- the authority and `hasPermission()` in the app treats a hydrated map as final: a key
-- the database has never heard of reads as false, not as "fall back to the role default".
-- A capability added only to the client works in the demo store, passes every behaviour
-- test, and is then invisible to every real signed-in user — the control simply does not
-- appear, with nothing on screen to explain why.
insert into public.permissions
  (permission_id, permission_name, permission_level, category, description, default_roles)
values
  ('pricelist.view', 'Open the price lists', 1, 'Price lists',
   'See a customer''s priced items. Reading only — no change is possible without pricelist.edit.',
   array['ops_manager', 'admin']),
  ('pricelist.edit', 'Correct a priced line', 2, 'Price lists',
   'Change an item number, description, unit or unit cost, and add a new line. Existing tickets are unaffected: a unit price is frozen onto the ticket when the job is approved, so a correction here reaches new ticket lines only.',
   array['ops_manager', 'admin']),
  ('pricelist.delete', 'Remove a priced line', 3, 'Price lists',
   'Delete an item from a customer''s price list. Asks for confirmation and records who did it, because the row itself is gone afterwards — unlike a ticket, a price line has no withdrawn state to come back from.',
   array['ops_manager', 'admin'])
on conflict (permission_id) do update
  set permission_name = excluded.permission_name,
      permission_level = excluded.permission_level,
      category = excluded.category,
      description = excluded.description,
      default_roles = excluded.default_roles;
