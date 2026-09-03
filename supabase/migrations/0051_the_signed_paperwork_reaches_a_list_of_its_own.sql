-- The signed service ticket and job log, emailed with both attached the moment the second
-- one lands — to a distribution list the admin account manages, not a hardcoded one.
-- (owner's request, 2026-09-03)
--
-- Three pieces, same shape as the master-export scheduler (0021/0023): a trigger that asks
-- a cheap question on every insert, an Edge Function that does the real work under the
-- service-role key, and a Vault secret (`resend_api_key`, already placed) the function
-- reads at send time — never in this file, never in the client bundle.
--
-- The trigger does NOT decide completeness or claim the send; it only fires the function,
-- unconditionally, on every ticket_attachments insert for a ticket not yet emailed. Both
-- of those live in the Edge Function instead, because only it can do them atomically: it
-- claims the send with `update tickets set paperwork_emailed_at = now() where id = $1 and
-- paperwork_emailed_at is null returning id` before calling Resend, so two attachments
-- landing in the same second race for one claim rather than sending the email twice. A
-- failed send clears the claim it made, so the next insert (a re-attach) gets to try again.

alter table public.tickets
  add column if not exists paperwork_emailed_at timestamptz;

comment on column public.tickets.paperwork_emailed_at is
  'Set by the send-paperwork-email Edge Function once Resend has accepted the message — the claim that stops both attachments racing to send it twice, and the record of whether it ever went.';

alter table public.org_defaults
  add column if not exists paperwork_delete_after_email boolean not null default false;

comment on column public.org_defaults.paperwork_delete_after_email is
  'Off by default. When on, send-paperwork-email deletes the two Storage objects after Resend confirms delivery, freeing the bucket''s quota — the owner''s call to make once the email path has been watched hold up, not a default this migration assumes.';

-- ── Who may manage the list ─────────────────────────────────────────────────────────
insert into public.permissions (permission_id, permission_name, permission_level, category, description, default_roles)
values
  ('paperwork_email.manage', 'Manage the paperwork email distribution list', 2, 'System',
   'Add, remove and toggle who receives the signed service ticket and job log automatically once both arrive.',
   array['admin'])
on conflict (permission_id) do nothing;

-- ── The list itself ──────────────────────────────────────────────────────────────────
create table if not exists public.paperwork_email_recipients (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  enabled     boolean not null default false,
  added_by    uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

comment on table public.paperwork_email_recipients is
  'The fixed distribution list for signed paperwork. Enabled rows receive the email; a disabled row stays on the list without receiving anything — how the owner tests one address at a time before turning the rest on.';

create unique index if not exists paperwork_email_recipients_email_key
  on public.paperwork_email_recipients (lower(email));

alter table public.paperwork_email_recipients enable row level security;

-- Read and write both gated on the one capability — there is no reason to let someone see
-- the list without also being trusted to change it, and no third state worth a second
-- policy.
drop policy if exists paperwork_email_recipients_manage on public.paperwork_email_recipients;
create policy paperwork_email_recipients_manage on public.paperwork_email_recipients
  for all
  to authenticated
  using ((select public.has_permission((select auth.uid()), 'paperwork_email.manage')))
  with check ((select public.has_permission((select auth.uid()), 'paperwork_email.manage')));

-- Seeded with the owner's six. Lateri is the only one enabled — every other row starts
-- off, so the feature ships already in "test on me first" state; the admin panel is where
-- the rest get turned on once the owner trusts it.
insert into public.paperwork_email_recipients (email, enabled)
values
  ('lateri@makaman.ly', true),
  ('awhida@makaman.ly', false),
  ('ahmed@makaman.ly', false),
  ('mohaned@makaman.ly', false),
  ('ali@makaman.ly', false),
  ('makaman.libya@ymail.com', false)
on conflict (lower(email)) do nothing;

-- ── The trigger ──────────────────────────────────────────────────────────────────────
-- Fires on every insert, whichever document it is. `net.http_post` is fire-and-forget
-- from here — the function decides, atomically, whether this is the insert that completed
-- the pair.
create or replace function public.tg_maybe_send_paperwork_email()
returns trigger
language plpgsql security definer set search_path = public, extensions
as $function$
declare
  v_already_sent boolean;
  v_key text;
  v_url text;
begin
  select (t.paperwork_emailed_at is not null) into v_already_sent
  from public.tickets t where t.id = new.ticket_id;

  if coalesce(v_already_sent, true) then
    return new;
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'service_role_key';
  if v_key is null then
    return new; -- absent rather than wrong, same as rebuild_master_export
  end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'project_url';
  v_url := coalesce(v_url, 'https://igutjfezxkdncrcpvnqx.supabase.co');

  perform net.http_post(
    url     := v_url || '/functions/v1/send-paperwork-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'),
    body    := jsonb_build_object('ticket_id', new.ticket_id)
  );
  return new;
end;
$function$;

drop trigger if exists ticket_attachments_maybe_send_paperwork on public.ticket_attachments;
create trigger ticket_attachments_maybe_send_paperwork
  after insert on public.ticket_attachments
  for each row execute function public.tg_maybe_send_paperwork_email();
