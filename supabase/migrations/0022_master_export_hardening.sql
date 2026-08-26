-- Two things the linter was right about.
--
-- 1. A view runs as its creator unless told otherwise, so `master_export_rows` handed any
--    signed-in technician the totals of every approved job in the company — straight past
--    the RLS on `tickets` that exists to prevent exactly that. security_invoker makes the
--    view read with the caller's own permissions. The export function is unaffected: it
--    uses the service role, which was never subject to RLS.
alter view public.master_export_rows set (security_invoker = on);

-- 2. Functions in `public` are executable by `authenticated` by default, so every signed-in
--    user could ask for a rebuild. Revoking from PUBLIC does not remove that grant.
--    Nobody but the scheduler and the service role has any business calling these.
revoke execute on function public.rebuild_master_export(boolean) from authenticated, anon, public;
revoke execute on function public.master_export_due()           from authenticated, anon, public;

-- The linter also flags pg_net as living in `public`. It does not support SET SCHEMA, and
-- dropping and recreating it would disturb the request queue the scheduler runs on, for a
-- warning about where a name is registered — its functions are in `net.*` either way.
-- Left deliberately, and recorded here so it is a decision rather than an oversight.
