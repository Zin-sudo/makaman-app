-- 2026-09-11, owner's request: "For the team list from Account tab allow the ops to adopt
-- the disable / reset password same as the admin."
--
-- user.disable already gates all three Team-screen controls on the client (canDisable,
-- canSetPassword, and — until this migration — canDelete too), but its default_roles was
-- ['admin'] only, and the admin-actions Edge Function independently hardcoded
-- `role === 'admin'` for set_user_status and set_password regardless of what this table
-- said — CLAUDE.md's own standing warning made concrete twice over: "hiding a button is
-- not a check," and a permission the database does not actually grant reads as false (or
-- here, is simply never consulted) no matter what the client shows.
--
-- Delete is deliberately NOT widened here — the owner asked for disable and reset
-- password, not delete, and delete is the one irreversible action of the three. The
-- client decouples canDelete from user.disable in the same commit (a direct role check,
-- unchanged real behavior); this migration only widens the two capabilities that were
-- actually asked for.
update public.permissions
  set default_roles = array['ops_manager','admin'],
      permission_name = 'Disable an account or reset its password',
      description = 'Withdraw someone''s access, restore it, or set a new password for them. Their name stays on every ticket and audit entry they touched, and the account can be re-enabled. Accounts are never deleted from here.'
  where permission_id = 'user.disable';
