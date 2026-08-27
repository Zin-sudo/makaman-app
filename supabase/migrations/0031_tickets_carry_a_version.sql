-- [APPLIED] as `0031_tickets_carry_a_version`
-- S11 / B8. Flag a sync conflict instead of overwriting.
--
-- Until now the last device to reach the server won. A technician editing a job offline
-- while the office edited the same job would upload his whole header on top of theirs,
-- and nothing anywhere would say a change had been lost. The settled-ticket case was
-- closed earlier (a closed or approved job can no longer be overwritten from the field);
-- this is the general case, for a job both sides are still working on.
--
-- The mechanism is a counter on the row. A client sends the version its edit was made
-- against, the update is conditioned on that version still being current, and an edit
-- made against a version somebody has since replaced simply matches no row. Nothing is
-- overwritten and nothing is silently dropped: the client can tell the difference between
-- "taken" and "somebody got there first", which is the whole point.
alter table public.tickets add column if not exists version integer not null default 1;

comment on column public.tickets.version is
  'Bumped on every update. A client sends the version it read; an update conditioned on a version that is no longer current matches no row, which is how a sync conflict is detected rather than resolved by overwriting.';

-- Bumped inside the rule trigger that already exists rather than by a second BEFORE UPDATE
-- trigger. Two triggers on one event fire in alphabetical order of their names, which is a
-- decision nobody makes on purpose and one that a rename would silently change.
--
-- The body below is the existing function verbatim, with the two stamping lines at the end.
create or replace function public.enforce_ticket_update_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if public.current_role() = 'technician' then
    if old.status = 'approved' then
      raise exception 'Ticket already approved and can no longer be edited.';
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
