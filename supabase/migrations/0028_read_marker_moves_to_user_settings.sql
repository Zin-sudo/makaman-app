-- 20260826 · 0028_read_marker_moves_to_user_settings   [APPLIED]
--
-- Moves the notification read marker from profiles to user_settings, and retires the
-- function that existed only to write it.
--
-- 0026 put it on profiles, which has SELECT policies and no UPDATE policy by design — so
-- it needed a SECURITY DEFINER function to write, and that was the only new definer in the
-- schema. Wiring the client showed the whole arrangement was unnecessary.
--
-- user_settings is already written on every preference change, through a path that works:
-- the outbox's upsert_settings op, owner-scoped, no elevated privilege. The read marker is
-- a per-person preference in every meaningful sense, so it belongs beside theme and time
-- format rather than in a corner of its own with a definer function guarding it.
--
-- This also removes a real hazard. The app keeps preferences in `settings`, and diffOps
-- writes that object to user_settings wholesale. A field added to `settings` without a
-- matching column is a refused write, and a refused write jams the head of the outbox —
-- which is exactly how signup approval broke earlier in this project.
alter table public.user_settings
  add column if not exists notifications_read_at timestamptz;

comment on column public.user_settings.notifications_read_at is
  'How far this person has read their notifications. Unread = audit entries they can see, made by someone else, after this moment. Null means everything is unread.';

drop function if exists public.mark_notifications_read();

alter table public.profiles
  drop column if exists notifications_read_at;
