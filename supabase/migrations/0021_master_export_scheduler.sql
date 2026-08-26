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

-- ── SUPERSEDED BY 0023 ──────────────────────────────────────────────────────
-- This migration originally ended with an instruction to place the service-role key in
-- the vault, and posted it as a bearer token. That failed with 401: the function compared
-- it to SUPABASE_SERVICE_ROLE_KEY, which the platform fills with the *legacy* JWT, while
-- the key placed in the vault was the newer `sb_secret_` format. 0023 replaces the whole
-- arrangement with a single-use nonce, and no credential is needed here at all.
