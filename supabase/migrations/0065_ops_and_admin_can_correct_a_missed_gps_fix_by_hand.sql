-- The capability app/index.html's PERMISSION_DEFAULTS just grew, registered so a real
-- signed-in user actually gets it. hasPermission() treats a hydrated map as final — a key
-- the database has never heard of reads as false for everyone, however the client-side
-- constant reads (same reasoning as migration 0035).
--
-- Owner's request, 2026-09-09: "ops and admin should have the ability to manually
-- modify, remove, add the coordinates of the well site if the arrival GPS ping didn't
-- capture automatically from the technician's device."
insert into public.permissions
  (permission_id, permission_name, permission_level, category, description, default_roles)
values
  ('location.edit', 'Correct a ticket''s GPS coordinates by hand', 2, 'Reporting',
   'Manually set, correct, or remove the well-location and latest-position fixes on a ticket, for when the device never captured one on its own.',
   array['ops_manager', 'admin'])
on conflict (permission_id) do update
  set permission_name = excluded.permission_name,
      permission_level = excluded.permission_level,
      category = excluded.category,
      description = excluded.description,
      default_roles = excluded.default_roles;
