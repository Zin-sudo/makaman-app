-- "Sent to Client" retired as its own status — the owner's report, 2026-09-10, with a
-- screenshot: "SENT TO FINANCE & SENT TO CLIENT are creating confusion... SENT TO CLIENT
-- is not needed anymore, it is replaced by Collect Signature/Stamp... when the [documents]
-- are both uploaded the status becomes SENT TO FINANCE."
--
-- The status never actually meant what its label implied. It was set the moment someone
-- downloaded the blank sheets (exportTicketZip, app/index.html) — an action, not a fact
-- about whether the client had received or returned anything — while Sent to Finance was
-- set on the FIRST signed document uploaded, not both. The two could race: a ticket could
-- reach "Sent to Finance" while still missing one document, or sit at "Sent to Client"
-- long after both signed documents were already back, because nothing re-checked once the
-- second one landed.
--
-- That second case is not hypothetical — it is the live ticket this migration finds and
-- fixes: #1883 (Waha Oil Company) has carried both its signed Service Ticket and Job Log
-- since 2026-09-04, but was pushed to sent_client on 2026-09-08 by a sheet download and has
-- sat there since, never re-evaluated. It is exactly the confusion in the report.
--
-- Going forward (client-side change, same commit): downloading the sheets is logged as an
-- action but no longer moves status at all. Uploading a signed document only advances the
-- ticket to sent_finance once BOTH are present — never on the first one alone. This
-- migration does the matching database-side work: moves every ticket currently sitting at
-- sent_client to whichever status is now actually true of it (sent_finance if both signed
-- documents are already in; back to approved — "Collect Signature/Stamp" — if not), then
-- removes sent_client from the set of values a ticket can ever hold again, and simplifies
-- enforce_ticket_update_rules()'s settled-chain ranking from three steps to two. The
-- sent_client_at column is left in place, untouched — it is a real historical fact about
-- when this ticket's sheets went out, not something to erase.

do $$
declare
  r record;
  v_finance_at timestamptz;
begin
  for r in select id from public.tickets where status = 'sent_client'
  loop
    select greatest(
      (select max(a.uploaded_at) from public.ticket_attachments a where a.ticket_id = r.id and a.doc_kind = 'service_ticket'),
      (select max(a.uploaded_at) from public.ticket_attachments a where a.ticket_id = r.id and a.doc_kind = 'job_log')
    ) into v_finance_at;

    if exists (select 1 from public.ticket_attachments a where a.ticket_id = r.id and a.doc_kind = 'service_ticket')
       and exists (select 1 from public.ticket_attachments a where a.ticket_id = r.id and a.doc_kind = 'job_log')
    then
      -- Both signed documents are already back — this ticket was always really
      -- sent_finance, just never re-checked once the second document landed.
      update public.tickets
        set status = 'sent_finance', sent_finance_at = coalesce(sent_finance_at, v_finance_at)
        where id = r.id;
    else
      -- Sheets went out, nothing (or only one document) has come back — under the new
      -- model this is just an approved ticket still under Collect Signature/Stamp, the
      -- same as one nobody has downloaded sheets for yet.
      update public.tickets set status = 'approved' where id = r.id;
    end if;
  end loop;
end $$;

alter table public.tickets drop constraint if exists tickets_status_check;
alter table public.tickets add constraint tickets_status_check
  check (status = any (array['logging','done','approved','sent_finance','cancelled']));

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
      -- moving until both signed copies are back (sent_finance) — pinning this to
      -- 'approved' alone would refuse the very upload that gets it there.
      and t.status in ('approved', 'sent_finance')
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

  -- The settled chain, now two steps rather than three — sent_client retired 2026-09-10
  -- (migration 0074): it never tracked anything the client actually did, only that
  -- someone had downloaded the blank sheets, and could fall behind or race against
  -- sent_finance depending on upload order.
  v_old_rank := case old.status when 'approved' then 1 when 'sent_finance' then 2 else 0 end;
  v_new_rank := case new.status when 'approved' then 1 when 'sent_finance' then 2 else 0 end;

  -- Nobody but the office walks it back. A phone that was offline while the signed sheets
  -- went to finance should not be able to push a row that un-sends them.
  if v_old_rank > 0 and v_new_rank > 0 and v_new_rank < v_old_rank and not v_staff then
    raise exception 'A ticket that has gone to finance cannot be moved back.';
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
    -- The carve-out: the one move he is meant to make (approved -> sent_finance, by
    -- sending back a signed document), on a job he actually worked.
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
  -- phone's, and so it cannot be set without the status actually changing. sent_client_at
  -- is no longer written (the status it tracked is retired) but the column and its
  -- existing values stay — real history, not to be erased.
  if new.status = 'sent_finance' and old.status is distinct from 'sent_finance' and new.sent_finance_at is null then
    new.sent_finance_at := now();
  end if;

  new.updated_at = now();
  new.version = old.version + 1;
  return new;
end;
$function$;
