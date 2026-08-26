-- 20260817 · 0002_price_list_two_tier_and_currency   [APPLIED]
--
-- Recovered 2026-08-26 from supabase_migrations.schema_migrations, verbatim. This file
-- was applied to the database on 2026-08-17 and had been missing from the repository
-- ever since — HANDOFF carried the warning "do not rebuild the schema from files alone"
-- because of it. Registered as S6; recovering it is what closes that.
--
-- The statements below are exactly what ran. Nothing has been reconstructed or inferred.

-- Real price lists (imported from the company's Service Ticket workbook, see
-- HANDOFF.md Part B) sometimes charge a different rate for the first day vs.
-- each additional day on the same item — capture that instead of collapsing
-- it into a single unit_cost. Also capture currency, since Sirte Oil Company
-- (SOC) is priced in LYD while the rest are USD.

alter table public.price_list_items
  add column unit_cost_additional numeric,
  add column currency text not null default 'USD';

comment on column public.price_list_items.unit_cost is 'Standard rate, or the first-day rate when unit_cost_additional is set.';
comment on column public.price_list_items.unit_cost_additional is 'Rate for each additional day/period beyond the first, when the item is priced that way. Null for flat-rate items.';

alter table public.clients add column currency text not null default 'USD';
