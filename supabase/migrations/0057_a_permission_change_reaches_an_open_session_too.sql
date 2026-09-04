-- Reported live, 2026-09-04: an admin granted an ops manager the paperwork-email
-- permission and it took a full relaunch of his app to appear — the same gap 0056 closed
-- for tickets, one table over. Postgres Changes filters by the subscriber's own SELECT
-- policy exactly as an ordinary read already does (see 0056's comment for why that is
-- not new exposure), and user_permissions_select_own already restricts a non-staff
-- subscriber to rows where user_id = auth.uid() — so this adds no new exposure either: a
-- signed-in person hears about their OWN permission changing, and staff hear about
-- everyone's, exactly as a refresh() already would tell them.
alter publication supabase_realtime add table public.user_permissions;
