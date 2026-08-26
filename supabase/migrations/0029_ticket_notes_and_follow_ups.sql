-- 20260826 · 0029_ticket_notes_and_follow_ups   [APPLIED]
--
-- Notes: someone wants attention on a ticket.
--
-- This one IS a table, where notifications (0026) deliberately were not. A notification is
-- a projection of the audit trail — an entry you have not read — so storing it would have
-- been a second copy of something already recorded. A note is not a projection of
-- anything. It carries its own words, and state the trail cannot express: raised, then
-- answered, by whom, when.
--
-- Raising and answering still write audit entries, so the trail stays complete — and
-- because notifications derive from that trail, a note notifies the people who can see
-- the ticket without any extra wiring.

create table if not exists public.ticket_notes (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.tickets(id) on delete cascade,
  body        text not null,
  -- NO ACTION on both people, matching ticket_lines.edited_by. Postgres will refuse to
  -- remove anybody who has raised or answered a note, which is correct: §2g settled that
  -- people are disabled, not deleted.
  raised_by   uuid not null references public.profiles(id),
  raised_at   timestamptz not null default now(),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  constraint ticket_notes_resolution_is_whole
    check ((resolved_by is null) = (resolved_at is null)),
  constraint ticket_notes_body_not_blank
    check (length(btrim(body)) > 0)
);

comment on table public.ticket_notes is
  'Follow-ups raised against a ticket — the Observer flagging something for the office, a technician recording a dispute. Raised by anyone who can see the ticket; answered by the office.';

create index if not exists ticket_notes_ticket_id_idx
  on public.ticket_notes (ticket_id);
-- Partial: answered notes are the majority over time and none belong in the open list.
create index if not exists ticket_notes_open_idx
  on public.ticket_notes (ticket_id, raised_at desc)
  where resolved_at is null;

alter table public.ticket_notes enable row level security;

-- Reading mirrors ticket_lines exactly. auth.uid() is wrapped in a select so it is
-- evaluated once per query rather than once per row.
create policy ticket_notes_select_crew on public.ticket_notes for select
  using (exists (select 1 from public.ticket_crew c
                 where c.ticket_id = ticket_notes.ticket_id
                   and c.profile_id = (select auth.uid())));
create policy ticket_notes_select_founder on public.ticket_notes for select
  using ((select public.current_role()) = 'founder');
create policy ticket_notes_select_staff on public.ticket_notes for select
  using ((select public.is_staff()));

-- Anyone who can see a ticket may raise a note against it. The row must be attributed to
-- the person writing it — which is also why notes cannot use the `replace` sync path the
-- other ticket children use: that re-inserts everybody's rows.
create policy ticket_notes_insert_viewer on public.ticket_notes for insert
  with check (
    raised_by = (select auth.uid())
    and (
      (select public.is_staff())
      or (select public.current_role()) = 'founder'
      or exists (select 1 from public.ticket_crew c
                 where c.ticket_id = ticket_notes.ticket_id
                   and c.profile_id = (select auth.uid()))
    )
  );

-- Answering is the office's job. Deliberately no DELETE policy: a note that was raised
-- stays raised, and an inconvenient one cannot be made to disappear.
create policy ticket_notes_update_staff on public.ticket_notes for update
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

insert into public.permissions (permission_id, permission_name, permission_level, category, description, default_roles)
values
  ('note.add', 'Raise a note on a ticket', 1, 'Tickets',
   'Flag something on a job for the office to look at.',
   array['technician','ops_manager','admin','founder']),
  ('note.resolve', 'Answer a note', 2, 'Tickets',
   'Mark a raised note as dealt with.',
   array['ops_manager','admin'])
on conflict (permission_id) do update
  set permission_name  = excluded.permission_name,
      permission_level = excluded.permission_level,
      category         = excluded.category,
      description      = excluded.description,
      default_roles    = excluded.default_roles;
