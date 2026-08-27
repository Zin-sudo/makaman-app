-- 0036 left `tg_ticket_number_not_purged()` executable by anon and authenticated, which
-- means PostgREST exposed a trigger function at /rest/v1/rpc/. Calling it outside a
-- trigger errors rather than doing damage, but a SECURITY DEFINER function reachable by
-- a signed-out stranger is not something to leave lying around because today's version
-- happens to be harmless.
--
-- A BEFORE trigger does not need the *invoking* user to hold EXECUTE — the trigger runs
-- regardless — which is why `enforce_ticket_update_rules()` already carries exactly this
-- ACL and has always worked. This makes the new one match its neighbour.
revoke all on function public.tg_ticket_number_not_purged() from public, anon, authenticated;
