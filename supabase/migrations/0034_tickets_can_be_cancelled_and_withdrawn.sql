-- Three gaps in the ticket lifecycle, all reported from real use.
--
-- 1. A technician who opened a ticket could not undo it. He taps New Ticket expecting to
--    start logging, the job is called off, and the ticket sits in his list forever with
--    no way to close it honestly — it was never done, so "Job Done" would be a lie.
--
-- 2. The office could not close a job the technician left open. A phone dies, a man goes
--    on leave, and the ticket is stranded where only he can move it.
--
-- 3. Nothing could be withdrawn. A ticket raised against the wrong customer, or a
--    duplicate, stayed in the record as though it were real work.
--
-- Withdrawing is a soft delete, deliberately. A hard delete would take the audit trail
-- with it, and the one thing everybody needs to see about a removed ticket is who removed
-- it and why — the creator most of all. The row stays, stops appearing in the working
-- lists, and can be restored. That also answers the ticket-number question: a number on a
-- withdrawn ticket is still spoken for until somebody restores or reassigns it, rather
-- than silently becoming free while a client holds paper carrying it.
alter table public.tickets
  drop constraint if exists tickets_status_check;
alter table public.tickets
  add constraint tickets_status_check
  check (status = any (array['logging'::text, 'done'::text, 'approved'::text, 'cancelled'::text]));

alter table public.tickets
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists cancel_reason text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists delete_reason text;

comment on column public.tickets.cancelled_at is
  'Set when a job was called off before any work was logged. Distinct from deleted_at: a cancelled ticket is a real event in the record, a deleted one is a mistake being withdrawn.';
comment on column public.tickets.deleted_at is
  'Soft delete. The row and its audit trail stay so the creator can see who withdrew it and why; the working lists filter it out.';

-- Extended rather than replaced by a second trigger: two BEFORE UPDATE triggers on one
-- table fire in alphabetical name order, which is not a thing anybody should have to know
-- to read this file.
create or replace function public.enforce_ticket_update_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_staff boolean := public.is_staff();
begin
  -- A withdrawn ticket is frozen. The only edit it accepts is being brought back, and
  -- only the office can do that — otherwise "deleted" would be a suggestion.
  if old.deleted_at is not null then
    if new.deleted_at is null then
      if not v_staff then
        raise exception 'Only Ops Manager or Admin can restore a withdrawn ticket.';
      end if;
    else
      raise exception 'This ticket has been withdrawn. Restore it before editing.';
    end if;
  end if;

  -- Withdrawing is the office's alone, in both directions.
  if new.deleted_at is distinct from old.deleted_at and not v_staff then
    raise exception 'Only Ops Manager or Admin can withdraw a ticket.';
  end if;

  if public.current_role() = 'technician' then
    if old.status = 'approved' then
      raise exception 'Ticket already approved and can no longer be edited.';
    end if;
    -- Cancelling your own untouched ticket is allowed, and is the one status change a
    -- technician may make besides closing. It is confined to a job that never started:
    -- once it is done or approved it is the office's to unwind, not his.
    if new.status = 'cancelled' then
      if old.status <> 'logging' then
        raise exception 'Only a job that has not been closed can be cancelled.';
      end if;
      if auth.uid() is distinct from old.holder_id and auth.uid() is distinct from old.technician_id then
        raise exception 'Only the technician holding this ticket can cancel it.';
      end if;
    end if;
    if old.status = 'cancelled' and new.status is distinct from old.status then
      raise exception 'A cancelled ticket can only be reopened by Ops Manager or Admin.';
    end if;
    if old.end_job_at is not null and (
      new.arrival_at is distinct from old.arrival_at or
      new.start_job_at is distinct from old.start_job_at or
      new.end_job_at is distinct from old.end_job_at
    ) then
      raise exception 'Arrival/Start/End stamps can only be corrected by Ops Manager or Admin after Job Done.';
    end if;
    if new.ticket_number is distinct from old.ticket_number
      or new.client_id is distinct from old.client_id
      or new.job_type_id is distinct from old.job_type_id
      or new.mileage_one_way is distinct from old.mileage_one_way
      or new.approved_by is distinct from old.approved_by
      or new.approved_at is distinct from old.approved_at
      or new.status = 'approved' then
      raise exception 'Only Ops Manager or Admin can assign ticket number, mileage, job type or approve.';
    end if;
  end if;
  new.updated_at = now();
  -- Whatever the client sent for version is ignored. The guard is the WHERE clause on the
  -- update, not the value in the row — a client that could set its own version could
  -- overwrite anything by claiming to be current.
  new.version = old.version + 1;
  return new;
end;
$function$;
