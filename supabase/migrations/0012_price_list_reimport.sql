-- Price-list re-import from the cleaned source (2,610 rows), and the two schema
-- changes it forced. Applied 2026-08-20.
--
-- The row data itself is not repeated here -- it lives in
-- supabase/makaman_price_lists_final.sql, which is the runnable copy of exactly what
-- was loaded. This file records the schema decisions, which are the part that has to
-- be replayable in order.

-- 1. unit_cost becomes nullable.
--
-- 110 rows carry no fixed unit cost: "Inspection charge for all tools as per third
-- party company invoice", "All grapples and controls ... charged 50% from", and the
-- like. They are quoted per job, not free.
--
-- unit_cost was NOT NULL, so any import either dropped those rows or flattened them to
-- zero. Zero is the dangerous reading -- it prints 0.00 on a client sheet for work that
-- is chargeable. NULL says "no fixed price" and is the only honest value, so the
-- constraint goes rather than the data.
alter table public.price_list_items alter column unit_cost drop not null;

-- 2. A home for code collisions.
--
-- Ten Waha codes name two different items each: a Liner-hanger block and a wellhead
-- civil-works block were both numbered from MKN100-710, and MKN100-406 is used for both
-- a defoamer and an insulated box. The prices differ by orders of magnitude.
--
-- price_list_items has a unique (client_id, item_number), and it is right to: an
-- ambiguous code is an ambiguous price on a client invoice. Item numbers are not
-- something to invent, so the second occurrence of each collision is parked here for a
-- human to renumber rather than dropped. Draining this table is a data task, not a
-- migration -- it is empty on a fresh database and that is correct.
create schema if not exists backup;

create table if not exists backup.price_list_conflicts_20260820 (
  like public.price_list_items including defaults,
  rn bigint
);
