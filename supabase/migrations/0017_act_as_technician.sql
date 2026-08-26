-- Working as a technician for a while, then going back.
--
-- The office sometimes has to raise and run a job themselves — cover for someone whose
-- phone has failed, or work a site in person. Today that means either using somebody
-- else's login, which destroys the audit trail, or not doing it.
--
-- This is a capability rather than a role change: nothing is written to `profiles`, the
-- person keeps their own name on everything they touch, and swapping back is always
-- available because the control is keyed on being swapped, not on holding the permission.

insert into public.permissions
  (permission_id, permission_name, permission_level, category, description, default_roles)
values
  ('user.act_as_technician', 'Work as a technician', 2, 'People',
   'Swap into the technician''s app to raise and run a job in person, and swap back. Your own name stays on everything you do, and you appear among the technicians for assignment while swapped.',
   array['ops_manager','admin'])
on conflict (permission_id) do update set
  permission_name  = excluded.permission_name,
  permission_level = excluded.permission_level,
  category         = excluded.category,
  description      = excluded.description,
  default_roles    = excluded.default_roles;
