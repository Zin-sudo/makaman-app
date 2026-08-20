-- 20260820095212 · merge_waha_sheets_into_one_customer
--
-- Waha arrived as two customer records because the price list arrived as two workbook
-- sheets. They share no item code at all, which is what two halves of one list look
-- like — two competing agreements would price the same tools differently. One customer
-- per company is also what stops the Ops Manager having to know which sheet a tool sits
-- on before picking the customer.
--
-- The sheet each item came from is kept, so this stays reversible and the source is
-- still traceable back to the workbook.
alter table public.price_list_items
  add column if not exists source_sheet text;

comment on column public.price_list_items.source_sheet is
  'Which workbook sheet this row was imported from. Set where a client price list arrived split across sheets; null otherwise.';

update public.price_list_items p
   set source_sheet = c.name
  from public.clients c
 where c.id = p.client_id
   and c.name in ('Waha (Sheet 1)', 'Waha (Sheet 2)')
   and p.source_sheet is null;

update public.price_list_items
   set client_id = (select id from public.clients where name = 'Waha (Sheet 1)')
 where client_id = (select id from public.clients where name = 'Waha (Sheet 2)');

delete from public.clients where name = 'Waha (Sheet 2)';

update public.clients
   set name = 'Waha Oil Company'
 where name = 'Waha (Sheet 1)';
