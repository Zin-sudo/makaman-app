-- Reverses 0024. The interface is staying English, so a stored reading direction is a
-- preference with no control behind it — the same thing the accent-swatch removal ran
-- into. A column nothing sets and nothing reads is drift.
alter table public.user_settings
  drop constraint if exists user_settings_dir_check;

alter table public.user_settings
  drop column if exists dir;
