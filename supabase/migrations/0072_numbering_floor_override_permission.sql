-- 20260910 · 0072_numbering_floor_override_permission   [Part 2 of the session's
-- seven-part plan]
--
-- hasPermission() treats a hydrated map as final — a capability key with no migration
-- behind it reads as false for everyone, silently (CLAUDE.md's own standing warning,
-- already cost this project real time twice). numbering.override_floor is the escape
-- hatch for the new numbering-floor refusal (app/index.html's numberIssue()): a
-- deliberate, per-ticket, audited exception for ops_manager/admin only — "an admin
-- option that can also be used by the ops to override this restriction for special
-- cases," in the owner's own words — never a standing mode.

insert into public.permissions (permission_id, permission_name, permission_level, category, description, default_roles)
values
  ('numbering.override_floor', 'Override the numbering floor', 3, 'Numbering',
   'Enter a ticket number at or below a series'' declared floor for a single ticket, as a declared exception — recorded to the audit trail every time.',
   array['ops_manager','admin'])
on conflict (permission_id) do update
  set permission_name  = excluded.permission_name,
      permission_level = excluded.permission_level,
      category         = excluded.category,
      description      = excluded.description,
      default_roles    = excluded.default_roles;
