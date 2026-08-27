-- The ten Waha rows parked on 2026-08-20 come back into the live list.
--
-- Why they were parked: their codes read MKN100-7xx, which normalise onto the live
-- MKN-100-7xx range — and that range is already Waha's liner hangers, at 59,800 to
-- 80,000 USD each. Letting them merge would have put "cellar cleaning" and an
-- eighty-thousand-dollar liner hanger on one item number, so a technician charging
-- the first could have billed the second. Parking was correct.
--
-- Why they come back now: nine of the ten are civil works that already live in the
-- Zueitina list (MKN-0840..MKN-0848) at identical prices, so the work is real and the
-- price is known; only the Waha code was ever in doubt. The tenth, DEFOAMER - POWDER
-- at 57.00/LBS, exists nowhere live under any client.
--
-- The instruction (user, 2026-08-27): restore them under their parked code with '-1'
-- appended, so they cannot collide with the liner hangers and so the suffix itself
-- marks them as not yet validated. Admin and Ops will walk the price lists item by
-- item from the Admin page and settle the real codes; until then the suffix is the
-- flag. No code invented, no price averaged, no row dropped.
--
-- Note on has_valid_code: it is a generated column and only asserts that the code
-- contains a letter and a digit, so it reads true for these too. It is not a
-- validation flag and must not be read as one — the '-1' suffix is the marker.
insert into public.price_list_items
  (client_id, item_number, description, uom, unit_cost, unit_cost_additional,
   currency, source_sheet)
select
  c.client_id,
  c.item_number || '-1',
  c.description,
  c.uom,
  c.unit_cost,
  c.unit_cost_additional,
  c.currency,
  c.source_sheet
from backup.price_list_conflicts_20260820 c
where not exists (
  select 1 from public.price_list_items p
  where p.client_id = c.client_id
    and p.item_number = c.item_number || '-1'
);
