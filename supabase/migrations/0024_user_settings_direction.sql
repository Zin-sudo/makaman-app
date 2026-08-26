-- Applied and then reversed the same day by 0025. Kept so the migration history matches
-- the database: the interface is staying English (HANDOFF §2i), so a stored reading
-- direction is a preference with no control behind it.
alter table public.user_settings
  add column if not exists dir text not null default 'ltr';

alter table public.user_settings
  drop constraint if exists user_settings_dir_check;

alter table public.user_settings
  add constraint user_settings_dir_check check (dir in ('ltr', 'rtl'));
