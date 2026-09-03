-- There is no tool in this project's toolchain that can set an Edge Function's own secrets
-- the way SUPABASE_SERVICE_ROLE_KEY is auto-injected, and the `vault` schema is not exposed
-- through PostgREST, so send-paperwork-email cannot read `resend_api_key` out of
-- vault.decrypted_secrets the way its own service-role client reaches every other table.
--
-- The bridge is the same shape RLS already leans on everywhere else in this project: a
-- SECURITY DEFINER function that can see the Vault, with execute revoked from everyone
-- except the service role. The Edge Function's own service-role client calls it via
-- db.rpc(...) — the key still never appears in source, never reaches the browser, and this
-- is the only door open to it.

create or replace function public.get_paperwork_resend_key()
returns text
language sql security definer set search_path = public, vault
as $function$
  select decrypted_secret from vault.decrypted_secrets where name = 'resend_api_key';
$function$;

revoke execute on function public.get_paperwork_resend_key() from public, anon, authenticated;
grant execute on function public.get_paperwork_resend_key() to service_role;
