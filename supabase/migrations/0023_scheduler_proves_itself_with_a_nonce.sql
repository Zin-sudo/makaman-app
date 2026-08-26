-- The scheduler proves who it is without holding a copy of anything.
--
-- The first attempt had pg_cron present the service-role key and the function compare it
-- to its own env var by string equality. That failed with 401 for a reason worth keeping:
-- Supabase injects the *legacy* JWT into SUPABASE_SERVICE_ROLE_KEY, while the key pasted
-- into the vault was the newer `sb_secret_` format. Two spellings of the same authority,
-- and `===` cannot see that they are the same.
--
-- Rather than chase the matching spelling, remove the comparison. The database now mints
-- a single-use nonce, sends it, and the function checks the row exists and is fresh. Only
-- something that can write this table can produce one, and nothing but the service role
-- can write it. No shared secret, no copy of a credential to keep in step, and nothing
-- that breaks when Supabase rotates a key format again.

create table if not exists public.export_nonces (
  nonce      uuid        primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

comment on table public.export_nonces is
  'Single-use proof that a rebuild request came from the scheduler. Written by the '
  'database, consumed and deleted by the export function. Never readable or writable by '
  'any client: RLS is on and there are deliberately no policies.';

alter table public.export_nonces enable row level security;
-- No policies at all. The service role bypasses RLS; everyone else sees nothing, which is
-- exactly the intent — a nonce nobody can read is a nonce nobody can replay.

revoke all on public.export_nonces from anon, authenticated;

create or replace function public.rebuild_master_export(p_force boolean default false)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_nonce uuid;
  v_url   text;
begin
  if not p_force and not public.master_export_due() then
    return 'nothing to do';
  end if;

  -- Old nonces are litter, and an unbounded table of them is a slow leak. Anything past
  -- its usable life goes now rather than needing a second scheduled job to sweep.
  delete from public.export_nonces where created_at < now() - interval '10 minutes';

  insert into public.export_nonces default values returning nonce into v_nonce;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'project_url';
  v_url := coalesce(v_url, 'https://igutjfezxkdncrcpvnqx.supabase.co');

  perform net.http_post(
    url     := v_url || '/functions/v1/master-export',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-export-nonce', v_nonce::text),
    body    := '{}'::jsonb
  );
  return 'requested';
end;
$$;

revoke execute on function public.rebuild_master_export(boolean) from authenticated, anon, public;
