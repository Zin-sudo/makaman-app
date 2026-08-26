-- [APPLIED] as `0030_ticket_attachments` (20260826221011)
-- Attachments: the signed sheet coming back, a photo of the wellhead, a third-party
-- invoice. The digital archive W7 asks for, and the thing that turns an approved ticket
-- into a settled one.

-- Private, and it stays private. CONSTRAINTS B-12.4: files are served through signed URLs
-- with an expiry, never a permanent public link. A public bucket would put every client's
-- signed paperwork behind a guessable URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 15728640,
        array['application/pdf','image/png','image/jpeg','image/webp','image/heic'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Whether the caller may see a given ticket. One definition, used by the three storage
-- policies below and by the attachments table — three inlined copies of the same
-- expression is three chances for them to drift apart.
--
-- SECURITY DEFINER because it reads ticket_crew, and the caller's own RLS on that table
-- would otherwise decide the answer. It is narrow in the way the Supabase guidance asks
-- for: the identity is taken from auth.uid() inside the body and never passed in, so
-- there is nothing to point at somebody else, and all it can ever reveal is a boolean
-- about the caller's own access.
create or replace function public.can_see_ticket(p_ticket uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    (select public.is_staff())
    or (select public.current_role()) = 'founder'
    or exists (select 1 from public.ticket_crew c
               where c.ticket_id = p_ticket
                 and c.profile_id = (select auth.uid()));
$$;

revoke execute on function public.can_see_ticket(uuid) from anon, public;
grant  execute on function public.can_see_ticket(uuid) to authenticated;

create table if not exists public.ticket_attachments (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references public.tickets(id) on delete cascade,
  -- Where the bytes are, inside the private bucket: <ticket_id>/<uuid>.<ext>
  path         text not null unique,
  filename     text not null,
  mime         text not null,
  bytes        bigint not null,
  -- NO ACTION, like every other person reference: whoever attached the signed sheet
  -- stays named on it.
  uploaded_by  uuid not null references public.profiles(id),
  uploaded_at  timestamptz not null default now(),
  constraint ticket_attachments_bytes_sane check (bytes > 0 and bytes <= 15728640),
  constraint ticket_attachments_filename_not_blank check (length(btrim(filename)) > 0)
);

comment on table public.ticket_attachments is
  'What is attached to a ticket, and where it lives in the private attachments bucket. The bytes are never served directly — only through a signed URL with an expiry.';

create index if not exists ticket_attachments_ticket_id_idx
  on public.ticket_attachments (ticket_id, uploaded_at desc);

alter table public.ticket_attachments enable row level security;

create policy ticket_attachments_select_visible on public.ticket_attachments for select
  using ((select public.can_see_ticket(ticket_id)));

create policy ticket_attachments_insert_visible on public.ticket_attachments for insert
  with check (uploaded_by = (select auth.uid())
              and (select public.can_see_ticket(ticket_id)));

-- Removing an attachment is the office's call. Deliberately no UPDATE policy: an
-- attachment is not edited, it is added or withdrawn.
create policy ticket_attachments_delete_staff on public.ticket_attachments for delete
  using ((select public.is_staff()));

-- ── The bytes themselves ────────────────────────────────────────────────────────────
-- storage.objects had no policies at all, because the only bucket so far is written by
-- the Edge Function under the service role. These are the first client-facing ones, so
-- they are scoped to this bucket alone and leave `exports` exactly as it was.
--
-- The first path segment is the ticket id, which is what ties a file to the same
-- visibility rule as the ticket it belongs to.
create policy attachments_read on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and (select public.can_see_ticket(((storage.foldername(name))[1])::uuid))
  );

create policy attachments_write on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and owner = (select auth.uid())
    and (select public.can_see_ticket(((storage.foldername(name))[1])::uuid))
  );

create policy attachments_remove on storage.objects for delete
  to authenticated
  using (bucket_id = 'attachments' and (select public.is_staff()));

insert into public.permissions (permission_id, permission_name, permission_level, category, description, default_roles)
values
  ('attachment.add', 'Attach a file to a ticket', 1, 'Tickets',
   'Add a signed sheet, a photo or a third-party invoice to a job.',
   array['technician','ops_manager','admin']),
  ('attachment.remove', 'Remove an attachment', 2, 'Tickets',
   'Withdraw a file from a job.',
   array['ops_manager','admin'])
on conflict (permission_id) do update
  set permission_name  = excluded.permission_name,
      permission_level = excluded.permission_level,
      category         = excluded.category,
      description      = excluded.description,
      default_roles    = excluded.default_roles;
