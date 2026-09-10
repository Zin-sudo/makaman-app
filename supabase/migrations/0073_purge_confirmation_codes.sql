-- 20260910 · 0073_purge_confirmation_codes   [Part 1 of the session's seven-part plan]
--
-- The purge tool this migration backs is destructive on purpose (wipe every ticket, so
-- the three dummy technician accounts can then be deleted through the existing, already-
-- safe delete_user action) and must not be a single tap somebody can hit by accident, or
-- one an unattended admin session left logged in could trigger. Owner's own words: "make
-- the purge a feature where the admin needs to input his password to activate it. And
-- input a verification code that arrives to his email as a must. To activate again if
-- necessary." This table holds only the emailed side of that step-up check — never the
-- code itself, only its hash, and only reachable by the admin-actions Edge Function's
-- service-role key. No client, at any permission level, can read or write it directly.

create table public.purge_confirmation_codes (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references public.profiles(id) on delete cascade,
  code_hash    text not null,          -- sha-256 of the 6-digit code, never the code itself
  requested_at timestamptz not null default now(),
  expires_at   timestamptz not null,   -- requested_at + 10 minutes
  used_at      timestamptz,
  -- One live code per admin — a fresh request replaces (upserts over) the old one, so a
  -- resend cannot leave two valid codes standing at once.
  constraint purge_codes_single_active unique (admin_id)
);

alter table public.purge_confirmation_codes enable row level security;

-- Deliberately no policy at all: not even the admin who requested a code may SELECT,
-- INSERT, UPDATE or DELETE this table directly. The Edge Function's service-role key
-- bypasses RLS entirely, which is the only path that is meant to touch this table — the
-- same reasoning ticket_numbering's own claim fields already rely on for their sensitive
-- half. Guarded live in supabase/checks/regression_guards.sql: this table carries no
-- client-reachable policy at any role.
