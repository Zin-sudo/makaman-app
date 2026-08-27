# Migrations — what is applied, and which file records it

**This directory is a curated history, not a mirror.** One file may record two applied
migrations, and transient scaffolding that was created and dropped in the same session is
deliberately not kept. That is a reasonable choice, but it makes "is the repo complete?"
impossible to answer by counting — 31 applied against 26 files looks alarming and is not.

So the mapping is written down. Check against it rather than re-deriving it.

## The authority

```sql
select version, name from supabase_migrations.schema_migrations order by version;
```
Supabase keeps the full SQL of every applied migration in `statements`. Nothing here has to
be reconstructed from memory — if a file is missing, recover it verbatim:
```sql
select statements[1] from supabase_migrations.schema_migrations where version = '…';
```

## Map — 31 applied, 2026-08-26

| # | Applied migration | Recorded in |
|---|---|---|
| 1 | `0001_init` | `0001_init.sql` |
| 2 | `0002_price_list_two_tier_and_currency` | `0002_price_list_two_tier_and_currency.sql` — **recovered 2026-08-26** |
| 3 | `snapshot_price_lists_before_item_number_normalise` | `0003_snapshot_price_lists.sql` |
| 4 | `normalise_price_list_item_numbers` | `0004_normalise_item_numbers.sql` |
| 5 | `merge_waha_sheets_into_one_customer` | `0005_merge_waha_sheets.sql` |
| 6 | `snapshot_tickets_before_model_catchup` | `0005a_snapshot_tickets_before_catchup.sql` — **recovered 2026-08-26** |
| 7 | `bring_schema_up_to_app_model` | `0006_app_model_catchup.sql` |
| 8 | `rls_for_new_tables` | `0007_rls_new_tables.sql` |
| 9 | `ticket_visibility_follows_the_crew` | `0008_crew_visibility.sql` |
| 10 | `seed_reference_rows` | `0009_seed_reference.sql` |
| 11 | `complete_numbering_series` | `0010_complete_numbering_series.sql` |
| 12 | `harden_functions` | `0011_harden_functions.sql` |
| 13 | `scope_role_helpers_to_authenticated` | `0011_harden_functions.sql` — *same file, both named in its header* |
| 14 | `price_list_reimport_staging` | `0012_price_list_reimport.sql` — *staging, dropped at #18* |
| 15 | `drop_price_list_staging` | — *transient, nets to nothing* |
| 16 | `price_list_reimport_staging_v2` | — *transient* |
| 17 | `price_list_allow_quoted_separately` | `0012_price_list_reimport.sql` — *the `unit_cost` nullable change* |
| 18 | `drop_price_list_staging_after_reimport` | — *transient* |
| 19–31 | `0013…0025` | one file each, same names |
| 32–34 | `0026…0028` | one file each. 0026 is partly superseded by 0027 and 0028 the same day — read all three together. |
| 35 | `0029_ticket_notes_and_follow_ups` | one file, same name |
| 36 | `0030_ticket_attachments` | one file, same name. First client-facing `storage.objects` policies — scoped to the `attachments` bucket alone, `exports` untouched. |
| 37 | `0031_tickets_carry_a_version` | one file, same name. Extends the existing `enforce_ticket_update_rules()` rather than adding a second BEFORE UPDATE trigger — two on one event fire in alphabetical name order. |

The row data loaded by #14–#18 is **not** in this directory. It lives in
`supabase/makaman_price_lists_final.sql`, which is the runnable copy of exactly what was
loaded — 2,610 rows. `0012` records the schema decisions, which are the part that has to
replay in order.

## Rules

1. **Never rebuild the database from these files alone** without checking this map first.
   Transient scaffolding is missing on purpose; a replay that assumes otherwise will not
   reach the same schema.
2. A new migration gets a file **in the same commit that applies it**. Applying without
   recording is what produced the two recoveries above (CONSTRAINTS §21).
3. A file records the applied migration's real name in its first line, with `[APPLIED]`.
   Where one file covers two, name both — `0011` is the pattern.
4. Numbering is order-of-application, not a sequence to keep gapless. `0005a` sits where it
   ran.
