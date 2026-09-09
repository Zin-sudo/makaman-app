-- 2026-09-10, owner's request: replace the six client price lists with the cleaned,
-- reviewed batches supplied in Cleaned_Price_List_Batches_for_PWA.zip. Before touching
-- any data, this adds the two columns the cleaned dataset's own Review Flags sheet needs
-- somewhere to land — additive only, nothing existing changes shape.
--
-- has_valid_code already exists and already means one specific thing: the CODE column
-- is unreadable (not a code at all — a stray unit of measure or blank cell that ended up
-- in the item-number column). That is not reused here. The cleaned batches carry a
-- second, more common condition: the code is perfectly readable, but the SOURCE PRICE
-- could not be safely split into initial/additional (a multi-tier day/redress table, a
-- percentage-of-another-price note, etc.) — roughly 200 of the ~2,608 rows. Conflating
-- the two would make existing has_valid_code = false logic mean something new by
-- accident, so this is deliberately a separate pair of columns:
--
--   review_flags     — the workbook's own plain-language reason, e.g. "Initial charge
--                       not directly available/mappable" or "Duplicate item code in
--                       source price list". Null for the ~2,394 rows with nothing to flag.
--   pricing_details  — the raw multi-column source data preserved verbatim as JSON where
--                       the cleaning pass found more than one price column and declined
--                       to guess which was initial vs additional (e.g. {"Per Day (US$)":
--                       190, "Redress Charge (US$)": 1950}) — so the real numbers are not
--                       lost, only left for a human (the Ops Manager or Admin) to read
--                       and enter correctly through the app's own price-list editor.
alter table public.price_list_items
  add column if not exists review_flags text,
  add column if not exists pricing_details jsonb;
