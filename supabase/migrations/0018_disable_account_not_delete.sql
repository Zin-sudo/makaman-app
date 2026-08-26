-- Taking someone's access away, without taking their work with it.
--
-- The obvious implementation — delete the profile row — is wrong here, and the schema
-- already says so. `tickets.technician_id`, `holder_id`, `closed_by`, `approved_by` and
-- `audit_log.changed_by` are all ON DELETE NO ACTION, so Postgres refuses to delete
-- anybody who has ever touched a ticket: which is every real user. And where a delete
-- *would* succeed, `ticket_crew.profile_id` is ON DELETE CASCADE — it would quietly erase
-- who was on a job, from a trail CLAUD.md records as legally required.
--
-- So access is withdrawn by status, and the row stays. This is also what the app's own
-- confirmation dialog has always promised: "they will no longer be able to log in, and
-- their name stays on any tickets they already touched."

alter table public.profiles drop constraint if exists profiles_status_known;
alter table public.profiles add constraint profiles_status_known
  check (status in ('pending', 'active', 'disabled'));

comment on column public.profiles.status is
  'pending = signed up, not yet let in. active = may sign in. disabled = access withdrawn, '
  'record kept. Accounts are never deleted: ticket and audit FKs are NO ACTION and would '
  'refuse, and ticket_crew is CASCADE and would erase who worked the job.';

-- The capability, named for what it does. `user.delete` promised something the database
-- will not do, and a key that lies about its own effect is worse than no key.
insert into public.permissions
  (permission_id, permission_name, permission_level, category, description, default_roles)
values
  ('user.disable', 'Disable an account', 3, 'People',
   'Withdraw someone''s access. They can no longer sign in; their name stays on every ticket and audit entry they touched, and the account can be re-enabled. Accounts are never deleted.',
   array['admin'])
on conflict (permission_id) do update set
  permission_name  = excluded.permission_name,
  permission_level = excluded.permission_level,
  category         = excluded.category,
  description      = excluded.description,
  default_roles    = excluded.default_roles;

delete from public.user_permissions where permission_id = 'user.delete';
delete from public.permissions      where permission_id = 'user.delete';
