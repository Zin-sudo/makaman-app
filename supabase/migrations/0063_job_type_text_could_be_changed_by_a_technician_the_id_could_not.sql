-- enforce_ticket_update_rules() has refused a technician's write to job_type_id since
-- migration 0039 — but 0054 added job_type_text as the actual source of truth for what a
-- job type reads as ("what was actually typed, stored and read back verbatim, no catalog
-- membership required") and never taught this trigger about it. The refusal list, and the
-- forward-only carve-out above it, both still check only job_type_id. A technician's own
-- write to job_type_text was never blocked, on any ticket, at any status — the exact
-- loophole the owner asked about (2026-09-09: "if any of the technicians have permissions
-- they shouldn't have... if that is causing issues on the RLS, please suggest the fix"),
-- and it undoes the point of moving the job objective to ops/admin (this same session's
-- migration-adjacent client change) unless it is closed here too: a UI gate is a courtesy,
-- the trigger is the actual boundary.
--
-- Two additions, same shape as every other office-owned field already on this list:
--   1. job_type_text joins job_type_id in the forward-only carve-out's untouched-fields
--      check, so a technician moving a ticket along the approved -> sent_client ->
--      sent_finance chain cannot smuggle a job-type change through alongside it.
--   2. job_type_text joins job_type_id in the unconditional refusal for a technician's
--      ordinary (non-forward-only) update, on a ticket at any status.
create or replace function public.enforce_ticket_update_rules()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_staff boolean := public.is_staff();
  v_old_rank int;
  v_new_rank int;
  v_forward_only boolean;
begin
  if old.deleted_at is not null then
    if new.deleted_at is null then
      if not v_staff then
        raise exception 'Only Ops Manager or Admin can restore a withdrawn ticket.';
      end if;
    else
      raise exception 'This ticket has been withdrawn. Restore it before editing.';
    end if;
  end if;

  if new.deleted_at is distinct from old.deleted_at and not v_staff then
    raise exception 'Only Ops Manager or Admin can withdraw a ticket.';
  end if;

  -- The settled chain, ranked so that "forward" means something.
  v_old_rank := case old.status when 'approved' then 1 when 'sent_client' then 2 when 'sent_finance' then 3 else 0 end;
  v_new_rank := case new.status when 'approved' then 1 when 'sent_client' then 2 when 'sent_finance' then 3 else 0 end;

  -- Nobody but the office walks it back. A phone that was offline while the sheets went
  -- out should not be able to push a row that un-sends them.
  if v_old_rank > 0 and v_new_rank > 0 and v_new_rank < v_old_rank and not v_staff then
    raise exception 'A ticket that has gone to the client cannot be moved back.';
  end if;

  -- Is this update nothing but a step forward along that chain? Every field the office
  -- owns has to be untouched for this to be true, which is what makes it safe to let a
  -- technician through a door that is otherwise shut to him.
  v_forward_only :=
        v_old_rank > 0 and v_new_rank > v_old_rank
    and new.ticket_number    is not distinct from old.ticket_number
    and new.client_id        is not distinct from old.client_id
    and new.job_type_id      is not distinct from old.job_type_id
    and new.job_type_text    is not distinct from old.job_type_text
    and new.mileage_one_way  is not distinct from old.mileage_one_way
    and new.approved_by      is not distinct from old.approved_by
    and new.approved_at      is not distinct from old.approved_at
    and new.arrival_at       is not distinct from old.arrival_at
    and new.start_job_at     is not distinct from old.start_job_at
    and new.end_job_at       is not distinct from old.end_job_at
    and new.technician_id    is not distinct from old.technician_id
    and new.holder_id        is not distinct from old.holder_id;

  if public.current_role() = 'technician' then
    -- The carve-out: the two moves he is meant to make, on a job he actually worked.
    if v_forward_only and exists (
      select 1 from public.ticket_crew c
      where c.ticket_id = old.id and c.profile_id = (select auth.uid())
    ) then
      null;  -- allowed; falls through to the stamps below
    else
      if v_old_rank > 0 then
        raise exception 'Ticket already approved and can no longer be edited.';
      end if;
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
        or new.job_type_text is distinct from old.job_type_text
        or new.mileage_one_way is distinct from old.mileage_one_way
        or new.approved_by is distinct from old.approved_by
        or new.approved_at is distinct from old.approved_at
        or new.status = 'approved' then
        raise exception 'Only Ops Manager or Admin can assign ticket number, mileage, job type or approve.';
      end if;
    end if;
  end if;

  -- Stamped here rather than by the client, so the time is the database's and not a
  -- phone's, and so it cannot be set without the status actually changing.
  if new.status = 'sent_client'  and old.status is distinct from 'sent_client'  and new.sent_client_at is null then
    new.sent_client_at := now();
  end if;
  if new.status = 'sent_finance' and old.status is distinct from 'sent_finance' and new.sent_finance_at is null then
    new.sent_finance_at := now();
  end if;

  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$function$;
