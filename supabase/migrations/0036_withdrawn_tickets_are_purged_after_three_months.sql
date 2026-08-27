-- Withdrawn tickets are removed for good three months after they were withdrawn
-- (user's instruction, 2026-08-27). Until now nothing was ever purged, which was right
-- while the record was young and wrong for a company running for years.
--
-- Two things have to survive the purge, and they are the reason this is not one line of
-- delete in a cron job.
--
-- 1. THE NUMBER. `tickets_ticket_number_key` is what stops one number reaching two
--    clients, so deleting a row hands its number back — and a client may be holding a
--    signed sheet carrying it. Paper does not expire after three months. The tombstone
--    below keeps every purged number and a trigger refuses to reissue one, so the purge
--    frees storage without freeing numbers.
--
-- 2. THE FACT THAT IT EXISTED. Everything about a ticket cascades off it — job log,
--    audit trail, items, attachments — so a purge is total. What is kept is the short
--    account somebody would need years later: the number, the customer, who withdrew it,
--    why, and when. Small enough to keep for ever, and enough to answer a question.
create table if not exists public.purged_tickets (
  ticket_id       uuid primary key,
  ticket_number   text,
  customer        text,
  technician_name text,
  status_when_withdrawn text,
  withdrawn_by    text,
  withdrawn_at    timestamptz,
  delete_reason   text,
  purged_at       timestamptz not null default now()
);

comment on table public.purged_tickets is
  'Tombstones for withdrawn tickets removed by the three-month retention rule. Names are kept as text rather than as references: the point is to stay readable years after the ticket, and after the people, are gone.';

create unique index if not exists purged_tickets_number_key
  on public.purged_tickets (ticket_number)
  where ticket_number is not null;

alter table public.purged_tickets enable row level security;

-- Read-only, and only for the office. Nothing writes to this but the purge itself, which
-- runs as the owner.
drop policy if exists purged_tickets_read on public.purged_tickets;
create policy purged_tickets_read on public.purged_tickets
  for select to authenticated
  using ((select public.is_staff()));

-- A number that has been used once is used for ever. Raises rather than modifying the
-- row, so it does not matter which order this fires in relative to the update rules —
-- the alphabetical-ordering trap only bites triggers that write to NEW.
create or replace function public.tg_ticket_number_not_purged()
returns trigger language plpgsql security definer set search_path = public as $function$
begin
  if new.ticket_number is not null
     and exists (select 1 from public.purged_tickets p where p.ticket_number = new.ticket_number) then
    raise exception 'Ticket number % belonged to a ticket that has since been purged, and cannot be reused.', new.ticket_number;
  end if;
  return new;
end;
$function$;

drop trigger if exists tickets_number_not_purged on public.tickets;
create trigger tickets_number_not_purged
  before insert or update of ticket_number on public.tickets
  for each row execute function public.tg_ticket_number_not_purged();

-- The purge itself. Returns how many it took, so a run that does nothing is
-- distinguishable from a run that did not happen.
create or replace function public.purge_withdrawn_tickets(p_months int default 3)
returns integer language plpgsql security definer set search_path = public as $function$
declare
  n integer := 0;
begin
  with due as (
    select * from public.tickets
    where deleted_at is not null
      and deleted_at < now() - make_interval(months => p_months)
  ), stone as (
    insert into public.purged_tickets
      (ticket_id, ticket_number, customer, technician_name, status_when_withdrawn,
       withdrawn_by, withdrawn_at, delete_reason)
    select d.id, d.ticket_number, d.customer,
           (select pr.full_name from public.profiles pr where pr.id = d.technician_id),
           d.status,
           (select pr.full_name from public.profiles pr where pr.id = d.deleted_by),
           d.deleted_at, d.delete_reason
    from due d
    on conflict (ticket_id) do nothing
    returning ticket_id
  )
  select count(*) into n from stone;

  delete from public.tickets t
  where t.deleted_at is not null
    and t.deleted_at < now() - make_interval(months => p_months);

  return n;
end;
$function$;

revoke all on function public.purge_withdrawn_tickets(int) from public, anon, authenticated;

-- Daily, not every minute. Nothing here is urgent: a ticket that becomes due at noon and
-- goes at 02:00 the next morning is still purged after three months by any reading that
-- matters, and a nightly job is one a person can reason about.
select cron.schedule(
  'purge-withdrawn-tickets',
  '0 2 * * *',
  $cron$select public.purge_withdrawn_tickets(3);$cron$
);
