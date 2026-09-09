-- Field Devices only ever knew about real technician-role accounts. The owner asked for
-- more, twice: "Devices in field should also show admins, observers, ops whom are online
-- and which role they're using... if someone is using a technician account or a view of
-- the technician account they should show on the Field devices list as well. and show as
-- inactive if they jump back to their administrative role view." The existing "Work as
-- Technician" swap deliberately never left this device (app/index.html's own comment on
-- activeTechnicians(): "Making it visible everywhere would mean a privileged write to a
-- profile on every swap, which is a much larger promise than this feature needs" — noted,
-- not fixed, until now).
--
-- A dedicated table rather than a new profiles column, on purpose: profiles is locked
-- down tight (SELECT only for a signed-in user; every write goes through admin-actions
-- with the service-role key) and this is a much lower-stakes fact than a role or a status
-- — the last thing this project needs is a reason to loosen that table's own RLS. One row
-- per account, writable only by that account, for exactly one fact: which view they are
-- currently showing.
create table if not exists public.presence (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  -- 'tech' while swapped into Work as Technician; null the moment they swap back or sign
  -- out. Constrained rather than free text — this table exists to answer one question,
  -- not to become a general presence/status board later without a fresh decision.
  active_view text check (active_view is null or active_view = 'tech'),
  updated_at timestamptz not null default now()
);

alter table public.presence enable row level security;

-- Read: anyone signed in. This is "which screen is that account currently using," not a
-- location or a role change — the same visibility Field Devices itself already has for
-- staff and, since this session's earlier migration, for technicians too.
create policy presence_select_authenticated on public.presence
  for select using (auth.uid() is not null);

-- Write: only your own row, and only to the one thing this table tracks. Nobody, not even
-- an admin, sets another account's presence.
create policy presence_upsert_own on public.presence
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
