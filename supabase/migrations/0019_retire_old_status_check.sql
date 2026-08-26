-- 0018 added `profiles_status_known` without noticing that migration 0001 had already
-- constrained the same column as `profiles_status_check`, to pending/active only. Two
-- CHECKs on one column both apply, so the stricter one won and 'disabled' was refused —
-- the new constraint did nothing except look like it worked.
--
-- Retiring the original rather than keeping both: one column, one statement of what may
-- go in it. Leaving a redundant pair is how the next person changes the wrong one.

alter table public.profiles drop constraint if exists profiles_status_check;
