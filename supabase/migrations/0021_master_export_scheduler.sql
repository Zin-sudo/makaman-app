-- Rebuilding the master file without anybody having the app open.
--
-- Not a trigger firing an HTTP call on every approval. Approving ten tickets in a row
-- would start ten rebuilds of the same object, racing each other to overwrite one file,
-- and the tenth would win by accident rather than by being last. Instead the schedule
-- asks a cheap question often: has anything approved changed since the last good build?
-- If not it does nothing at all, so the usual cost of this is one index lookup a minute.
--
-- The effect an office sees is the same as "on approval" — nobody has to open anything,
-- and the file follows the work — with a lag of at most the interval below.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Where the scheduler's credential lives. It is not in this migration and never will be:
-- see the note at the bottom for the one statement that puts it there.
create or replace function public.master_export_due()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.tickets t
    where t.status = 'approved'
      and t.updated_at > coalesce(
        (select max(r.started_at) from public.export_runs r
          where r.kind = 'master' and r.status = 'ok'),
        '-infinity'::timestamptz)
  );
$$;

comment on function public.master_export_due is
  'Has an approved ticket changed since the last successful build? Reads updated_at, so a '
  'reopened and re-approved ticket counts, and a corrected price counts.';

create or replace function public.rebuild_master_export(p_force boolean default false)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_key text;
  v_url text;
begin
  if not p_force and not public.master_export_due() then
    return 'nothing to do';
  end if;

  -- Absent rather than wrong: if the key has not been placed yet, say so once per run
  -- instead of posting an unauthorised request every minute and filling export_runs with
  -- failures that all mean the same thing.
  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then
    return 'no service_role_key in vault — scheduler idle';
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'project_url';
  v_url := coalesce(v_url, 'https://igutjfezxkdncrcpvnqx.supabase.co');

  perform net.http_post(
    url     := v_url || '/functions/v1/master-export',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  return 'requested';
end;
$$;

revoke execute on function public.rebuild_master_export(boolean) from anon, public;
revoke execute on function public.master_export_due() from anon, public;

-- Every minute, but the cheap check means it almost always returns immediately. A busy
-- afternoon of approvals produces one rebuild a minute at worst, not one per approval.
select cron.schedule(
  'master-export-refresh',
  '* * * * *',
  $$select public.rebuild_master_export();$$
);

-- ── The one thing that cannot live in a migration ────────────────────────────
-- The scheduler needs a credential, and a service-role key does not belong in a file in
-- a repository. Run this once, in the SQL editor, with the key from
-- Settings → API → service_role:
--
--   select vault.create_secret('<service_role_key>', 'service_role_key');
--
-- Until then `rebuild_master_export()` returns 'no service_role_key in vault — scheduler
-- idle' and does nothing. The office's manual Refresh button works without it, because
-- that path authorises with the signed-in person's own token instead.
