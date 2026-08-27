-- The four capabilities 0034's rules are about, registered so the app can ask for them.
--
-- This has to be a migration and not only a constant in the client. `has_permission()` is
-- the authority, and `hasPermission()` in the app treats a hydrated map as final: a key
-- the database has never heard of reads as false, not as "fall back to the role default".
-- So a capability added only to the client would work in the demo store, pass every
-- behaviour test, and then be invisible to every real signed-in user — the control simply
-- would not appear, with nothing to explain why.
insert into public.permissions
  (permission_id, permission_name, permission_level, category, description, default_roles)
values
  ('ticket.cancel_own', 'Cancel a job you opened', 1, 'Tickets',
   'Call off a ticket you raised that was never worked. Only while it is still open, and only your own.',
   array['technician', 'ops_manager', 'admin']),
  ('ticket.close_any', 'Close somebody else''s open job', 2, 'Tickets',
   'Close a job the technician left open — a dead phone, a man on leave — so it stops being stranded where only he can move it.',
   array['ops_manager', 'admin']),
  ('ticket.withdraw', 'Withdraw a ticket', 3, 'Tickets',
   'Remove a ticket raised in error from the working lists. The row and its trail stay, and it can be restored.',
   array['ops_manager', 'admin']),
  ('ticket.restore', 'Restore a withdrawn ticket', 3, 'Tickets',
   'Bring back a ticket that was withdrawn.',
   array['ops_manager', 'admin'])
on conflict (permission_id) do update
  set permission_name = excluded.permission_name,
      permission_level = excluded.permission_level,
      category = excluded.category,
      description = excluded.description,
      default_roles = excluded.default_roles;
