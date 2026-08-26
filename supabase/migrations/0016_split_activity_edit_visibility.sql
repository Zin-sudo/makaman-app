-- Converting the app's activity gates to the registry showed that `activity.view_all`
-- was two capabilities wearing one name.
--
-- The Observer does see every ticket's activity rather than only their own — they hold
-- `activity.view_all`, correctly. What they do not see is the edit-level detail: who
-- changed a field afterwards, the tool-custody answers, the Edits filter. That is an
-- internal matter between the office and the field, and the Observer reads the work
-- rather than how the kit was accounted for.
--
-- Seeding `activity.view_all` to include `founder` and using it for both meant the
-- conversion silently handed the Observer the edit trail. The observer suite caught it.
-- Splitting the key is the fix; widening the Observer's access is not.

insert into public.permissions
  (permission_id, permission_name, permission_level, category, description, default_roles)
values
  ('activity.view_edits', 'See edit-level activity', 2, 'Reporting',
   'Read who changed what after the fact, the tool-custody answers, and the Edits filter. Distinct from seeing every ticket''s job stages.',
   array['ops_manager','admin'])
on conflict (permission_id) do update set
  permission_name  = excluded.permission_name,
  permission_level = excluded.permission_level,
  category         = excluded.category,
  description      = excluded.description,
  default_roles    = excluded.default_roles;

comment on column public.permissions.default_roles is
  'Roles holding this without an override. Two capabilities that differ for any one role must be two rows — see activity.view_all vs activity.view_edits.';
