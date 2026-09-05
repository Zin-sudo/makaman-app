-- Push notifications: approvals, a job sent back for changes, a job ready for review,
-- and a note raised or answered on a job someone is on. Everything else stays an
-- in-app toast — this is deliberately a small, high-signal set, not a mirror of the
-- activity feed.
--
-- Same shape as send-paperwork-email (0051-0053): a single-use nonce this database mints
-- for itself proves the call to send-push came from here, not a copy of any credential
-- to keep in step. The VAPID private key follows the identical path as the Resend key —
-- Vault, read out through a service-role-only RPC, never in source or in the client. The
-- public key is NOT a secret (that is the point of the pair) and lives in app/config.js.

create table public.push_subscriptions (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  endpoint   text        not null unique,
  p256dh     text        not null,
  auth       text        not null,
  created_at timestamptz not null default now()
);

comment on table public.push_subscriptions is
  'One row per browser/device that has turned push notifications on. A person may hold '
  'more than one (a phone and a desktop); the endpoint is unique so re-subscribing the '
  'same device updates its own row rather than piling up duplicates.';

alter table public.push_subscriptions enable row level security;

-- A person manages only their own subscriptions. The service role (send-push) bypasses
-- RLS entirely, the same way every other server-side sender in this project does.
create policy push_subscriptions_own on public.push_subscriptions
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table public.push_notification_nonces (
  nonce      uuid        primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

comment on table public.push_notification_nonces is
  'Single-use proof that a send-push request came from this database''s own trigger. '
  'Written by the database, consumed and deleted by the function. RLS is on and there '
  'are deliberately no policies — the service role bypasses RLS, everyone else sees '
  'nothing, so a nonce nobody else can read is a nonce nobody else can replay.';

alter table public.push_notification_nonces enable row level security;
revoke all on public.push_notification_nonces from anon, authenticated;

create or replace function public.get_push_vapid_private_key()
returns text
language sql security definer set search_path = public, vault
as $function$
  select decrypted_secret from vault.decrypted_secrets where name = 'push_vapid_private_key';
$function$;

revoke execute on function public.get_push_vapid_private_key() from public, anon, authenticated;
grant execute on function public.get_push_vapid_private_key() to service_role;

-- One notify call, reused by every trigger below rather than repeating the nonce +
-- http_post boilerplate five times. Best-effort by construction: a push that never
-- arrives is not a lost record the way an unsent ticket write would be, so failures here
-- are not something a trigger should ever roll back real data over.
create or replace function public.notify_push(p_user_id uuid, p_title text, p_body text, p_url text)
returns void
language plpgsql security definer set search_path = public, extensions
as $function$
declare
  v_nonce uuid;
  v_url text;
begin
  if p_user_id is null then return; end if;

  delete from public.push_notification_nonces where created_at < now() - interval '10 minutes';
  insert into public.push_notification_nonces default values returning nonce into v_nonce;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'project_url';
  v_url := coalesce(v_url, 'https://igutjfezxkdncrcpvnqx.supabase.co');

  perform net.http_post(
    url     := v_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-nonce', v_nonce::text),
    body    := jsonb_build_object('user_id', p_user_id, 'title', p_title, 'body', p_body, 'url', p_url)
  );
end;
$function$;

revoke execute on function public.notify_push(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.notify_push(uuid, text, text, text) to service_role;

-- ── Ticket status: approved, sent back for changes, ready for review ────────────────
create or replace function public.tg_notify_ticket_status()
returns trigger
language plpgsql security definer set search_path = public, extensions
as $function$
declare
  v_label text := coalesce(new.ticket_number, 'unnumbered');
  v_crew  uuid;
begin
  -- Approved: everyone who has ever held this job hears about it, not only whoever
  -- currently holds it — a rotation means the job may already have moved on to someone
  -- else by the time the office approves what an earlier crew member logged.
  if new.status = 'approved' and old.status is distinct from 'approved' then
    for v_crew in select profile_id from public.ticket_crew where ticket_id = new.id loop
      perform public.notify_push(v_crew, 'Ticket #' || v_label || ' approved',
        'Approved by the office.', '/?ticket=' || new.id);
    end loop;

  -- Sent back for changes: a reopen, from either reviewed state back to logging.
  elsif new.status = 'logging' and old.status in ('done', 'approved') then
    for v_crew in select profile_id from public.ticket_crew where ticket_id = new.id loop
      perform public.notify_push(v_crew, 'Ticket #' || v_label || ' sent back',
        'The office sent this job back for changes.', '/?ticket=' || new.id);
    end loop;

  -- Ready for review: job done AND uploaded — the two together are what the app's own
  -- UI already calls "Awaiting review" rather than merely "Job done" (see the app's own
  -- statusLabel binding). Notified to every ops_manager/admin, not the raising
  -- technician, who already knows their own job is done.
  elsif new.status = 'done' and new.synced
        and not (old.status = 'done' and coalesce(old.synced, false)) then
    for v_crew in select id from public.profiles where role in ('ops_manager', 'admin') and status = 'active' loop
      perform public.notify_push(v_crew, 'Ticket #' || v_label || ' ready for review',
        (select customer from public.tickets where id = new.id) || ' — awaiting review.',
        '/?ticket=' || new.id);
    end loop;
  end if;
  return new;
end;
$function$;

drop trigger if exists notify_ticket_status on public.tickets;
create trigger notify_ticket_status
  after update on public.tickets
  for each row
  when (old.status is distinct from new.status or old.synced is distinct from new.synced)
  execute function public.tg_notify_ticket_status();

-- ── Notes: raised (everyone else on the crew) and answered (the person who raised it) ──
create or replace function public.tg_notify_ticket_note()
returns trigger
language plpgsql security definer set search_path = public, extensions
as $function$
declare
  v_label text;
  v_crew  uuid;
begin
  select coalesce(ticket_number, 'unnumbered') into v_label from public.tickets where id = new.ticket_id;

  if tg_op = 'INSERT' then
    for v_crew in select profile_id from public.ticket_crew
      where ticket_id = new.ticket_id and profile_id is distinct from new.raised_by
    loop
      perform public.notify_push(v_crew, 'Note on ticket #' || v_label,
        left(new.body, 120), '/?ticket=' || new.ticket_id);
    end loop;
  elsif tg_op = 'UPDATE' and old.resolved_by is null and new.resolved_by is not null then
    perform public.notify_push(new.raised_by, 'Your note on ticket #' || v_label || ' was answered',
      left(new.body, 120), '/?ticket=' || new.ticket_id);
  end if;
  return new;
end;
$function$;

drop trigger if exists notify_ticket_note on public.ticket_notes;
create trigger notify_ticket_note
  after insert or update on public.ticket_notes
  for each row
  execute function public.tg_notify_ticket_note();
