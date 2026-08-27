-- [APPLIED] as `0032_attachments_are_the_signed_paperwork_coming_back`
-- What attachments are actually FOR.
--
-- 0030 built a general attachment box: any file, on any ticket, by anyone who could see
-- it. That is not the job. The job is collecting the two documents the client signs and
-- stamps and sends back — the Service Ticket and the Job Log — and it only begins once the
-- office has approved the ticket. Until those two are in, that ticket number is pending.
--
-- Three things follow, and none of them were true before:
--   1. A file has to say WHICH of the two documents it is, or "pending" cannot be computed.
--   2. Nothing can be attached before approval. There is no signed paperwork yet.
--   3. Only the technician who did the job, or the office, may send it. Another
--      technician who can merely see the ticket is not part of this.

-- Which document. Deliberately only the two: a free "other" slot would quietly turn this
-- back into the general box, and the pending list depends on knowing which is which.
alter table public.ticket_attachments
  add column if not exists doc_kind text not null default 'service_ticket';

alter table public.ticket_attachments
  drop constraint if exists ticket_attachments_doc_kind_known;
alter table public.ticket_attachments
  add constraint ticket_attachments_doc_kind_known
  check (doc_kind in ('service_ticket', 'job_log'));

-- The default exists only so the column could be added NOT NULL; every caller states the
-- kind, and leaving a default in place would let one that forgot look deliberate.
alter table public.ticket_attachments alter column doc_kind drop default;

comment on column public.ticket_attachments.doc_kind is
  'Which of the two returned documents this is: the signed Service Ticket or the signed Job Log. A ticket is pending until at least one of each has arrived.';

-- Who may send the signed paperwork back, and when.
--
-- Separate from can_see_ticket on purpose. Seeing a job and being answerable for its
-- paperwork are different questions, and answering both with one function is how the
-- second one silently becomes the first: can_see_ticket lets in the Observer and every
-- member of staff regardless of status, which is right for reading and wrong for this.
create or replace function public.can_attach_to_ticket(p_ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tickets t
    where t.id = p_ticket
      -- Before approval there is nothing signed to send.
      and t.status = 'approved'
      and (
        -- The office.
        (select public.is_staff())
        -- Or the technician who did the job. Crew, not "a technician": a job that passed
        -- through two hands leaves both answerable for it, and nobody else.
        or exists (
          select 1 from public.ticket_crew c
          where c.ticket_id = t.id and c.profile_id = (select auth.uid())
        )
      )
  );
$$;

revoke execute on function public.can_attach_to_ticket(uuid) from anon, public;
grant  execute on function public.can_attach_to_ticket(uuid) to authenticated;

-- Reading stays as it was: anyone who can see the job can see what has come back for it.
-- Writing narrows to the rule above.
drop policy if exists ticket_attachments_insert_visible on public.ticket_attachments;
create policy ticket_attachments_insert_signed_docs on public.ticket_attachments for insert
  with check (uploaded_by = (select auth.uid())
              and (select public.can_attach_to_ticket(ticket_id)));

-- The bytes follow the same rule. Left as it was, a technician refused the row could still
-- put the file in the bucket — an object nobody can list and nobody can delete.
drop policy if exists attachments_write on storage.objects;
create policy attachments_write on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and owner = (select auth.uid())
    and (select public.can_attach_to_ticket(((storage.foldername(name))[1])::uuid))
  );

-- Removal is unchanged and stays the office's alone. These are signed client documents:
-- a technician who sends the wrong file asks the office to withdraw it, which leaves both
-- the sending and the withdrawal in the audit trail.

update public.permissions
   set permission_name = 'Send back signed paperwork',
       description     = 'Attach the client-signed Service Ticket or Job Log to a job the office has approved. Limited to the technician who did the job and to the office.'
 where permission_id = 'attachment.add';

update public.permissions
   set description = 'Withdraw a signed document from a job — for a wrong or unreadable scan.'
 where permission_id = 'attachment.remove';
