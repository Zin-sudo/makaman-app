-- 20260820 · harden_functions + scope_role_helpers_to_authenticated   [APPLIED]
--
-- Raised by the security linter after the DDL.

-- 1. My own omission. A function without a pinned search_path resolves unqualified names
--    against whatever the caller's search_path happens to be, so a table planted in an
--    earlier schema can shadow the real one. Neither of these is SECURITY DEFINER, which
--    limits the damage, but pinning it costs nothing and removes the question.
alter function public.normalise_item_number(text) set search_path = public, pg_temp;
alter function public.tg_normalise_item_number() set search_path = public, pg_temp;

-- 2. Trigger functions were reachable as RPC endpoints. handle_new_user and
--    enforce_ticket_update_rules are only ever meant to be fired by their triggers, and
--    both are SECURITY DEFINER — being callable over /rest/v1/rpc by an anonymous caller
--    is exactly the shape of an escalation. A trigger fires regardless of who holds
--    EXECUTE, so revoking breaks nothing.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.enforce_ticket_update_rules() from public, anon, authenticated;

-- 3. The role helpers. Revoking from anon alone does nothing while the grant sits on
--    PUBLIC, so it is dropped at the source and granted back only where needed.
--
--    authenticated must keep EXECUTE: an RLS policy expression is evaluated with the
--    privileges of the querying role, so revoking it would make every policy that
--    consults these helpers fail with permission denied. A deliberate keep, and a cheap
--    one — all three read only the caller's own profile row, so an authenticated user
--    calling is_staff() learns whether they themselves are staff, which they already know.
revoke all on function public.current_role() from public;
revoke all on function public.current_status() from public;
revoke all on function public.is_staff() from public;

grant execute on function public.current_role() to authenticated;
grant execute on function public.current_status() to authenticated;
grant execute on function public.is_staff() to authenticated;

-- Verified by switching role for real (SET LOCAL ROLE, not set_config, which does not
-- change privileges): authenticated still reads tickets and calls is_staff(); anon is
-- refused on is_staff() and on the price list.
