-- Approval stopped being the end of the story.
--
-- The rule (user, 2026-08-28): when the technician or the ops manager downloads the final
-- four sheets, the ticket is Sent to Client. When either of them uploads the signed and
-- stamped Service Ticket or Job Log, it is Sent to Finance (Digital). Both are
-- consequences of an action somebody already takes, not new buttons to remember.
--
-- Three things had to change together, and the second one is why this is a migration
-- rather than a client change.
--
--   1. The CHECK constraint knew four statuses. Two more.
--
--   2. `can_attach_to_ticket()` required status = 'approved' exactly. So the moment a
--      ticket moved to sent_client — which is what downloading the sheets does — the
--      database would have refused the signed paperwork, and the upload that is supposed
--      to advance it to sent_finance could never happen. The feature would have broken
--      itself on the second step.
--
--   3. `enforce_ticket_update_rules()` refuses any technician edit to an approved ticket:
--      "Ticket already approved and can no longer be edited." That is right for
--      everything except the two moves above, which the technician is explicitly meant to
--      make. So he gets a carve-out narrow enough to be safe: he may move the status
--      forward along this one chain, on a ticket he is on the crew of, and only if he is
--      changing nothing else in the same update.
--
-- Forward only, for everybody but the office. A ticket that has reached finance does not
-- quietly become un-sent because a stale phone pushed an older row.

alter table public.tickets drop constraint if exists tickets_status_check;
alter table public.tickets add constraint tickets_status_check
  check (status = any (array['logging','done','approved','sent_client','sent_finance','cancelled']));

-- When each step happened, recorded rather than inferred from the audit prose.
alter table public.tickets add column if not exists sent_client_at   timestamptz;
alter table public.tickets add column if not exists sent_finance_at  timestamptz;

create or replace function public.can_attach_to_ticket(p_ticket uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.tickets t
    where t.id = p_ticket
      -- Before approval there is nothing signed to send. After it, the ticket keeps
      -- moving — sheets out to the client, signed copies back — and the whole point of
      -- the later states is that this is when the paperwork arrives. Pinning this to
      -- 'approved' alone would refuse the upload that creates the next state.
      and t.status in ('approved', 'sent_client', 'sent_finance')
      and (
        (select public.is_staff())
        or exists (
          select 1 from public.ticket_crew c
          where c.ticket_id = t.id and c.profile_id = (select auth.uid())
        )
      )
  );
$function$;

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
