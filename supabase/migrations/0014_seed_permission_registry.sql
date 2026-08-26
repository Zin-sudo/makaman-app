-- Seeded from the role gates that already exist in app/index.html, so the registry
-- describes the app rather than proposing a second, different answer to the same
-- question. Where the app has no gate today the row still says what the intended
-- default is, and the code will be brought to it — but nothing here invents a
-- capability the product does not have.

insert into public.permissions
  (permission_id, permission_name, permission_level, category, description, default_roles)
values
  -- ── Field work ─────────────────────────────────────────────────────────────
  ('ticket.create', 'Open a job ticket', 1, 'Tickets',
   'Start a new ticket and fill the header.', array['technician','ops_manager','admin']),
  ('ticket.log', 'Write the job log', 1, 'Tickets',
   'Add and edit job-log lines while the ticket is in progress.', array['technician','ops_manager','admin']),
  ('ticket.close', 'Close a job', 1, 'Tickets',
   'Answer the closing questions and mark the job done.', array['technician','ops_manager','admin']),
  ('ticket.sync', 'Upload closed tickets', 1, 'Tickets',
   'Send closed tickets to the office when signal returns.', array['technician','ops_manager','admin']),
  ('ticket.print_own', 'Print your own approved sheets', 1, 'Tickets',
   'Generate and sign the sheets for a job you worked on.', array['technician','ops_manager','admin']),

  -- ── The office ─────────────────────────────────────────────────────────────
  ('ticket.view_all', 'See every ticket', 2, 'Tickets',
   'Read tickets beyond the ones you worked on.', array['ops_manager','admin','founder']),
  ('ticket.edit_closed', 'Edit a closed ticket', 2, 'Tickets',
   'Change a ticket after the technician has closed it.', array['ops_manager','admin']),
  ('ticket.charge_items', 'Add charged items', 2, 'Tickets',
   'Put priced items on a ticket and set quantities.', array['ops_manager','admin']),
  ('ticket.reorder_items', 'Reorder charged items', 2, 'Tickets',
   'Drag items out of the default category order for an exceptional case.', array['ops_manager','admin']),
  ('ticket.assign_number', 'Assign a ticket number', 2, 'Numbering',
   'Give a closed ticket its number from a series.', array['ops_manager','admin']),
  ('ticket.approve', 'Approve a ticket', 2, 'Tickets',
   'Settle a ticket and freeze its prices.', array['ops_manager','admin']),

  -- ── Acting for someone else ────────────────────────────────────────────────
  ('ticket.force_number', 'Force a number onto a job in progress', 3, 'Numbering',
   'Number a ticket the technician has not closed. Shows a forced-action notice and tells them.', array['ops_manager','admin']),
  ('ticket.approve_on_behalf', 'Approve for an absent technician', 3, 'Tickets',
   'Close and approve on behalf of someone who cannot reach their device. Recorded against your name.', array['ops_manager','admin']),
  ('ticket.reopen', 'Reopen an approved ticket', 3, 'Tickets',
   'Unseal a settled ticket. A reason is mandatory and written to the audit trail.', array['ops_manager','admin']),

  -- ── The numbering claim ────────────────────────────────────────────────────
  ('numbering.hold', 'Hold the numbering claim', 2, 'Numbering',
   'Be the person who numbers every job raised from the date the claim was received.', array['ops_manager','admin']),
  ('numbering.transfer', 'Hand over the numbering claim', 2, 'Numbering',
   'Pass the claim to another ops manager or admin.', array['ops_manager','admin']),
  ('numbering.override', 'Move the claim without the holder', 3, 'Numbering',
   'Reassign the claim when the person holding it is unavailable.', array['admin']),
  ('numbering.manage_series', 'Manage numbering series', 3, 'Numbering',
   'Create and edit the prefixes and ranges numbers come from.', array['admin']),

  -- ── People ─────────────────────────────────────────────────────────────────
  ('user.approve_signup', 'Approve a pending sign-up', 2, 'People',
   'Let someone who has signed up actually log in.', array['ops_manager','admin']),
  ('user.create', 'Create an account', 2, 'People',
   'Make an account directly, without waiting for a sign-up.', array['ops_manager','admin']),
  ('user.change_role', 'Change someone''s role', 3, 'People',
   'Promote or demote a user. Enforced inside the admin-actions function, not only here.', array['admin']),
  ('user.delete', 'Delete an account', 3, 'People',
   'Remove a user permanently. The seeded master admin can never be deleted.', array['admin']),
  ('user.manage_permissions', 'Grant and revoke permissions', 3, 'People',
   'Change what any individual may do, overriding their role.', array['admin']),

  -- ── Reference data ─────────────────────────────────────────────────────────
  ('pricelist.view', 'See price lists', 2, 'Data',
   'Read a customer''s agreed prices.', array['ops_manager','admin']),
  ('pricelist.edit', 'Edit price lists', 3, 'Data',
   'Import, change or delete priced items.', array['admin']),
  ('client.manage', 'Manage customers', 2, 'Data',
   'Add and edit customers and their currency.', array['ops_manager','admin']),
  ('jobtype.manage', 'Manage job types and questions', 3, 'Data',
   'Edit the job-type list and the closing questions.', array['admin']),

  -- ── Oversight ──────────────────────────────────────────────────────────────
  ('report.generate', 'Generate reports', 1, 'Reporting',
   'Produce sheets and exports for jobs you may see.', array['technician','ops_manager','admin','founder']),
  ('report.all_technicians', 'Report across everyone', 2, 'Reporting',
   'Run reports covering every technician rather than only yourself.', array['ops_manager','admin','founder']),
  ('activity.view_all', 'See the full activity feed', 2, 'Reporting',
   'Read every recorded event, not only your own tickets.', array['ops_manager','admin','founder']),
  ('location.view_team', 'See where the team is', 2, 'Reporting',
   'Read the last known coordinates of field devices.', array['ops_manager','admin','founder'])
on conflict (permission_id) do update set
  permission_name  = excluded.permission_name,
  permission_level = excluded.permission_level,
  category         = excluded.category,
  description      = excluded.description,
  default_roles    = excluded.default_roles;
