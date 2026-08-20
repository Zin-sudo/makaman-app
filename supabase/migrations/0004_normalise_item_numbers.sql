-- 20260820094333 · normalise_price_list_item_numbers
--
-- Item codes arrive from the client price-list workbooks with the separator between the
-- prefix and the group written four different ways: a space (MKN 100-001), nothing at all
-- (MKN100-020), a hyphen (MKN-100-36), and in a couple of rows an en-dash or a doubled
-- hyphen. Makaman's canonical form is hyphenated throughout: MKN-100-001.
--
-- This touches item_number and nothing else. Description, unit of measure, cost and
-- currency are stored exactly as exported from the workbook.
create or replace function public.normalise_item_number(raw text)
returns text
language sql
immutable
as $$
  select case
    -- A code carries at least one digit. Values that do not are not codes at all —
    -- "PER CUT" is a unit of measure that landed in the wrong column — and mangling
    -- them into "PER-CUT" would invent a code that no price list has ever contained.
    when raw is null or raw !~ '[0-9]' then raw
    else
      regexp_replace(                                   -- 5. never two hyphens in a row
        regexp_replace(                                 -- 4. MKN100-020 -> MKN-100-020
          regexp_replace(                               -- 3. remaining gaps become the separator
            regexp_replace(                             -- 2. no spaces hugging a hyphen
              replace(replace(btrim(raw), '–', '-'), '—', '-'),  -- 1. en/em dash -> hyphen
            '\s*-\s*', '-', 'g'),
          '\s+', '-', 'g'),
        '^([A-Za-z]+)([0-9])', '\1-\2'),
      '-{2,}', '-', 'g')
  end
$$;

comment on function public.normalise_item_number(text) is
  'Canonical form for price-list item codes: hyphen-separated, no stray whitespace, no en-dashes, no doubled hyphens. Values containing no digit are returned untouched — they are not codes. Applied automatically by trg_price_list_items_normalise on every insert and update, so re-imports cannot reintroduce the problem.';

-- Enforced at the table, not in whichever script happens to do the next import.
create or replace function public.tg_normalise_item_number()
returns trigger language plpgsql as $$
begin
  new.item_number := public.normalise_item_number(new.item_number);
  return new;
end $$;

drop trigger if exists trg_price_list_items_normalise on public.price_list_items;
create trigger trg_price_list_items_normalise
  before insert or update of item_number on public.price_list_items
  for each row execute function public.tg_normalise_item_number();

-- A code needs both a letter and a digit to be usable on an invoice. Generated, so it
-- cannot drift out of step with the value it describes.
alter table public.price_list_items
  drop column if exists has_valid_code;
alter table public.price_list_items
  add column has_valid_code boolean
  generated always as (item_number ~ '[A-Za-z]' and item_number ~ '[0-9]') stored;

comment on column public.price_list_items.has_valid_code is
  'False where the item-number cell holds something that is not a code — a column that slipped during import. The item is still real and priced; the code needs confirming against the signed price list before it reaches a client invoice.';

-- Backfill the 2,274 rows already loaded.
update public.price_list_items
   set item_number = public.normalise_item_number(item_number)
 where public.normalise_item_number(item_number) is distinct from item_number;
