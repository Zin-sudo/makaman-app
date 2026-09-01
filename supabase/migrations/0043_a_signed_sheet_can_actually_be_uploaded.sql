-- A signed sheet can actually be uploaded.
--
-- Reported: approve a ticket, try to attach the signed and stamped copy, get "new row
-- violates row-level security policy". Reproduced by impersonation, and it is one clause:
--
--     with check (bucket_id = 'attachments'
--                 and owner = (select auth.uid())            <-- this
--                 and can_attach_to_ticket(...))
--
-- `owner` is the LEGACY ownership column on storage.objects. Supabase Storage moved to
-- `owner_id` (text) and the current API leaves `owner` (uuid) null — the one object in
-- this project written through the API has null in BOTH columns. `null = auth.uid()` is
-- null, which is not true, so the row was refused. Proved both ways: the same insert with
-- `owner` populated passes the policy, and with it null gets exactly the reported error.
--
-- The clause is removed rather than rewritten against owner_id, because it was never
-- where the authority came from and its only observable effect was this bug:
--
--   · can_attach_to_ticket() is the real rule. It says the ticket is approved or further
--     along, and that the caller is either the office or crew on that job. Nobody can
--     write into a ticket's folder without passing it.
--   · The first path segment IS the ticket id, so the folder cannot be forged into
--     somebody else's job without failing that same check.
--   · Ownership here is metadata the Storage API stamps, not a permission. Requiring it
--     only ever asked "did the platform fill in a column it has stopped filling in".
--
-- Reading and deleting are untouched.
--
-- Verified after applying, with owner and owner_id both null as the API writes them:
--   admin attaches to an approved ticket        ALLOWED
--   ops manager attaches to it                  ALLOWED
--   anyone attaches to a ticket that is not real REFUSED

drop policy if exists attachments_write on storage.objects;

create policy attachments_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (select public.can_attach_to_ticket(((storage.foldername(name))[1])::uuid))
  );
