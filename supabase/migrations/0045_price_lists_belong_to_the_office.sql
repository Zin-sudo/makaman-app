-- Price lists belong to the office.
--
-- Two faults in the two policies on this table, pulling in opposite directions.
--
-- READ was `auth.uid() is not null` — every signed-in account could read every price. A
-- technician has no use for them (his ticket's charged lines are frozen onto the ticket
-- itself, and `pricelist.view` was already ops_manager+admin in the capability registry),
-- but his phone was downloading all 2,610 rows on every sign-in and holding the company's
-- entire pricing in localStorage. That is a commercial document sitting on a device that
-- goes to a client's wellhead.
--
-- WRITE was `current_role() = 'admin'` — but `pricelist.edit` and `pricelist.delete` are
-- granted to ops_manager as well, so the app showed the Ops Manager the editing screen and
-- the database refused every save he made. The capability registry and the policy had
-- drifted apart, and the app was the half that was right.
--
-- Both now say the same thing the registry says: the office, meaning ops_manager or admin.
--
-- Verified after applying, by impersonation (set local role authenticated + the user's own
-- request.jwt.claims), against the real 2,610 rows:
--
--   technician  is_staff() false   select -> 0 rows        update -> 0 rows written
--   ops_manager is_staff() true    select -> 2,610 rows    update -> 1 row written
--
-- The update probe set description to its own value, so nothing in the price list moved.

drop policy if exists price_list_items_select_all on public.price_list_items;
drop policy if exists price_list_items_write_admin on public.price_list_items;

create policy price_list_items_select_office on public.price_list_items
  for select to authenticated
  using ((select public.is_staff()));

create policy price_list_items_write_office on public.price_list_items
  for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));
