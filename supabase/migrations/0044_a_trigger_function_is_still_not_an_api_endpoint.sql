-- A trigger function is still not an API endpoint.
--
-- Migration 0037 made this point for every other trigger function in the schema, and 0040
-- tried to make it for this one and missed: it wrote
--
--     revoke execute on function public.tg_profile_base_follows_role() from anon, authenticated;
--
-- which is not enough. Postgres grants EXECUTE to PUBLIC by default, and revoking from two
-- roles that inherit it leaves the PUBLIC grant untouched. The ACL still read `=X/postgres`
-- — the leading `=` with no role name is PUBLIC — so the function was reachable at
-- /rest/v1/rpc/tg_profile_base_follows_role by anyone at all, signed in or not.
--
-- It is the only function in the schema with that hole; every other trigger function
-- (handle_new_user, enforce_ticket_update_rules, purge_withdrawn_tickets,
-- rebuild_master_export, master_export_due, tg_ticket_number_not_purged) is correctly
-- postgres | service_role and nothing else. Checked one by one rather than assumed.
--
-- Calling it outside a trigger would fail on tg_op rather than do damage, so this is a
-- door left open rather than a room worth entering. It is still a door.
--
-- Verified after applying, straight off pg_proc.proacl:
--   tg_profile_base_follows_role   {postgres=X/postgres,service_role=X/postgres}
--   handle_new_user                {postgres=X/postgres,service_role=X/postgres}
-- No PUBLIC entry, no anon, no authenticated.

revoke execute on function public.tg_profile_base_follows_role() from public;
revoke execute on function public.tg_profile_base_follows_role() from anon;
revoke execute on function public.tg_profile_base_follows_role() from authenticated;
