-- 0051's trigger copied the ORIGINAL master-export credential pattern (0021: hand the
-- function a service-role bearer token pulled from vault.decrypted_secrets). That pattern
-- was already superseded before this migration was written — 0023 replaced it with a
-- single-use nonce, precisely because 'service_role_key' was never a vault entry that
-- stayed valid, and checking live just now confirms the vault holds nothing but
-- 'resend_api_key' today. Every firing of 0051's trigger would have found v_key null and
-- silently returned without ever calling the function — the email would never have sent,
-- and nothing would have said why.
--
-- Same fix as 0023, for the same reason: prove the request came from this database
-- without holding a copy of any credential to keep in step.

create table if not exists public.paperwork_email_nonces (
  nonce      uuid        primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

comment on table public.paperwork_email_nonces is
  'Single-use proof that a send-paperwork-email request came from this database''s own '
  'trigger. Written by the database, consumed and deleted by the function. RLS is on and '
  'there are deliberately no policies — the service role bypasses RLS, everyone else sees '
  'nothing, so a nonce nobody else can read is a nonce nobody else can replay.';

alter table public.paperwork_email_nonces enable row level security;
revoke all on public.paperwork_email_nonces from anon, authenticated;

create or replace function public.tg_maybe_send_paperwork_email()
returns trigger
language plpgsql security definer set search_path = public, extensions
as $function$
declare
  v_already_sent boolean;
  v_nonce uuid;
  v_url text;
begin
  select (t.paperwork_emailed_at is not null) into v_already_sent
  from public.tickets t where t.id = new.ticket_id;

  if coalesce(v_already_sent, true) then
    return new;
  end if;

  delete from public.paperwork_email_nonces where created_at < now() - interval '10 minutes';
  insert into public.paperwork_email_nonces default values returning nonce into v_nonce;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'project_url';
  v_url := coalesce(v_url, 'https://igutjfezxkdncrcpvnqx.supabase.co');

  perform net.http_post(
    url     := v_url || '/functions/v1/send-paperwork-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-paperwork-nonce', v_nonce::text),
    body    := jsonb_build_object('ticket_id', new.ticket_id)
  );
  return new;
end;
$function$;
