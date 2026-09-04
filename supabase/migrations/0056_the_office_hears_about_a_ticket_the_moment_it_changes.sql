-- Reported live: the Ops Manager's Save-to-Home-Screen app did not show a technician's
-- "Job Done" until the app was relaunched. AUTO_SYNC_INTERVAL_MS is fifteen minutes, and
-- nothing else pulled in between. The client now opens a channel on public.tickets and
-- treats any change as "refresh now" rather than "in fifteen minutes" — but a channel has
-- nothing to receive until this table is added to the realtime publication. Postgres
-- Changes are filtered server-side by this table's own SELECT policies, exactly as an
-- ordinary read already is, so a technician's channel receives events for the same rows
-- their own refresh() would have pulled anyway — this adds no new exposure on its own.
alter publication supabase_realtime add table public.tickets;
