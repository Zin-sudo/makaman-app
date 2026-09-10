-- 2026-09-11, owner's report, with a live example: a Chrome "mobile device simulator"
-- extension mirrored one technician's actions into four genuinely independent copies of
-- the app at once. Each copy ran the same "Start Logging" click on its own, in its own
-- memory, with its own generated id — so all four reached the server as four real ticket
-- rows: same customer, field, well and rig, one carrying the whole job log four times
-- over, one approved and three stranded in-progress (technician_id
-- 4b7958ce-a880-4d0c-a478-b1c585648b10, all four created within 2.3 seconds of each
-- other). "It should not be allowed to submit the same actions... from multiple
-- previews... this is a breach door and also a cause for spam and errors on the server."
--
-- The client now guards this on its own (claimTicketCreate, app/index.html) using this
-- account's own localStorage — but that guard cannot see a request that never went
-- through this app's own UI, whether a differently-partitioned copy the client-side guard
-- genuinely cannot reach, or a script replaying raw inserts. This is the backstop: the
-- database refuses the SECOND insert outright rather than accepting it and leaving the
-- office to notice and clean up four duplicate jobs after the fact.
--
-- Scoped narrowly on purpose. Only a fresh 'logging' ticket is checked — an office-raised
-- ticket, an approval, a status change, a bulk import, none of those go through
-- createTicket()'s own door, and none of them are what this bug looked like. The window is
-- three minutes, the same one the client-side guard uses: long enough to catch every
-- duplicate actually observed (all four landed inside it), short enough that a technician
-- who genuinely needs to open a second, unrelated job at the same well later the same hour
-- is never blocked by it.
create or replace function public.prevent_duplicate_ticket_open()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if new.status = 'logging' and new.technician_id is not null and exists (
    select 1 from public.tickets t
    where t.technician_id = new.technician_id
      and t.customer = new.customer
      and t.field_name = new.field_name
      and t.well_no = new.well_no
      and t.rig_name = new.rig_name
      and t.status = 'logging'
      and t.created_at > now() - interval '3 minutes'
  ) then
    raise exception 'An open ticket for this technician, customer, field, well and rig already exists — opened moments ago. Not creating a second one.'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_before_insert on public.tickets;
create trigger tickets_before_insert
  before insert on public.tickets
  for each row execute function public.prevent_duplicate_ticket_open();
