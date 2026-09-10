-- Regression guards for the live bugs found and fixed on 2026-09-09.
--
-- Every one of these was a real, live failure that the JS Playwright suite in app/*.test.js
-- structurally could not have caught — neither the offline demo seed nor cloudstub.js
-- enforce real RLS, real primary keys, or real function grants the way Postgres does. This
-- file is that missing layer: run it against the live project (igutjfezxkdncrcpvnqx) after
-- ANY migration that touches a table, policy, or function named below, and before shipping
-- one. It changes nothing that outlives the run — the whole file is one transaction, rolled
-- back at the end regardless of outcome (BEGIN at the top, ROLLBACK at the bottom), and each
-- check's own probe writes are caught by an exception handler rather than left to fail the
-- whole script, so it reports every failure it finds in one pass rather than stopping at the
-- first — a single broken guard does not hide the others.
--
-- Run it with mcp__Supabase__execute_sql against project igutjfezxkdncrcpvnqx, or
-- `psql ... -f supabase/checks/regression_guards.sql`. A clean run ends with a single
-- NOTICE: "ALL REGRESSION GUARDS PASSED". Anything else names exactly which guard failed
-- and why, in the same words the original incident was diagnosed in, so the next person
-- (human or Claude) does not have to re-derive the diagnosis from scratch.
--
-- Add a new guard here, in this same shape, every time a live bug like these ships a fix —
-- this file is the standing place for that, not a one-time list.
begin;

do $$
declare
  failures text := '';
  n_before int;
  n_after int;
  n_expected int;
  expected record;
  actual_cols text[];
  tech_id uuid := '56ca31ce-19b6-49e0-93dd-8d748108e014';   -- techtest2@makaman.ly
  tech_other uuid := '0de7e9f4-7a5d-4f77-8dcf-bae73eca6925'; -- tech3@makaman.ly
  founder_id uuid := 'c80de7fe-e187-47b6-bb4f-a1e99825f66c'; -- ahmed@makaman.ly, role=founder
  logging_ticket uuid := 'ac19bb92-b3a9-470b-a215-38c79f59da8a'; -- a real ticket, status='logging', held by tech_id
  n_check boolean;
begin
  -------------------------------------------------------------------------------------
  -- Guard 1 (2026-09-09, b31e739): pageAll()'s ORDER_KEY map in app/index.html must
  -- name every table whose real primary key is not a plain `id` column. Ordering by a
  -- column that does not exist fails the request outright and takes the whole hydrate
  -- down with it — this is exactly what happened when the `presence` table (profile_id)
  -- shipped without an entry: nine failures in three minutes on one technician's device,
  -- every single hydrate refused by Postgres before any RLS check even ran.
  --
  -- This list must be kept in step BY HAND with app/index.html's own ORDER_KEY constant
  -- and the table list hydrate() passes to all(...) — there is no way to read the JS
  -- source from inside Postgres. When either changes, this list changes with it.
  -------------------------------------------------------------------------------------
  begin
    for expected in
      select * from (values
        ('profiles', 'id'), ('clients', 'id'), ('job_types', 'id'),
        ('ticket_numbering', 'id'), ('org_defaults', 'id'), ('asset_questions', 'id'),
        ('numbering_claim', 'id'), ('user_settings', 'user_id'),
        ('tickets', 'id'), ('ticket_lines', 'id'), ('ticket_items', 'id'),
        ('ticket_assets', 'id'), ('ticket_crew', 'ticket_id'), ('audit_log', 'id'),
        ('ticket_notes', 'id'), ('ticket_attachments', 'id'),
        ('permissions', 'permission_id'), ('user_permissions', 'user_id'),
        ('presence', 'profile_id')
      ) as t(table_name, expected_col)
    loop
      select array_agg(kcu.column_name)
        into actual_cols
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
        where tc.constraint_type = 'PRIMARY KEY'
          and tc.table_schema = 'public'
          and tc.table_name = expected.table_name;

      if actual_cols is null then
        failures := failures || format(E'\n  [ORDER_KEY] %s: table not found — renamed or dropped? Update this guard and app/index.html''s ORDER_KEY together.', expected.table_name);
      elsif not (expected.expected_col = any(actual_cols)) then
        failures := failures || format(
          E'\n  [ORDER_KEY] %s: app/index.html assumes "%s" is (part of) the primary key for pageAll()''s ordering, but the real primary key is %s. This is the exact shape of the presence.id incident (2026-09-09, b31e739) — every hydrate() of this table will be refused outright by Postgres. Add/fix its entry in ORDER_KEY.',
          expected.table_name, expected.expected_col, actual_cols);
      end if;
    end loop;
  exception when others then
    failures := failures || format(E'\n  [ORDER_KEY] guard itself errored: %s', sqlerrm);
  end;

  -------------------------------------------------------------------------------------
  -- Guard 2 (2026-09-09, d52f9fb, migration 0068; widened 2026-09-10, migration 0071): a
  -- technician must be able to read OTHER technicians' profiles (Field Devices showing
  -- "the rest of the team"), and — since 0071 — the profile of anyone who is the
  -- technician_id/holder_id of a ticket the technician can already see, whatever that
  -- person's real role is (Work-as-Technician: an ops_manager/admin can open and hold a
  -- job, and a technician reading THAT ticket must be able to name who holds it — live
  -- incident, ticket 1882, Abobaker Awhida, 2026-09-10). Must NOT be able to read an
  -- admin/ops_manager/founder profile through any OTHER path — 0071 widened by ticket,
  -- not by role.
  --
  -- Before 0068, profiles had only "your own row" and "any staff member, every row" — a
  -- technician's hydrate() of `profiles` came back with exactly one row: themselves, and
  -- Field Devices had nobody else to show, silently, with no error anywhere. Before 0071,
  -- the same silent gap reopened one level up: a ticket a technician could already read
  -- rendered with a blank holder name whenever that holder's real role was not
  -- 'technician'.
  -------------------------------------------------------------------------------------
  begin
    -- Computed with full visibility, before switching role: every non-technician profile
    -- that actually holds or opened at least one ticket, in the whole table — the
    -- authoritative "who 0071 is supposed to expose," independent of the policy under test.
    select count(distinct p.id) into n_expected
    from public.profiles p
    where p.role <> 'technician'
      and exists (select 1 from public.tickets t where t.technician_id = p.id or t.holder_id = p.id);

    execute 'set local role authenticated';
    execute format('set local "request.jwt.claims" = %L', json_build_object('sub', tech_id, 'role', 'authenticated')::text);

    select count(*) into n_before from public.profiles where role = 'technician';
    if n_before < 2 then
      failures := failures || format(E'\n  [profiles RLS] a technician can see only %s technician row(s) — expected at least 2 (itself plus another). migration 0068''s profiles_select_technician_team policy may be missing or narrowed.', n_before);
    end if;

    select count(*) into n_after from public.profiles where role <> 'technician';
    if n_after <> n_expected then
      failures := failures || format(E'\n  [profiles RLS] a technician sees %s non-technician profile row(s), expected exactly %s (every profile that holds/opened a ticket, migration 0071 — no more, no fewer). Too few means a Work-as-Technician holder''s name goes blank again (ticket 1882''s own incident); too many means the read has widened past "a ticket this technician can see."', n_after, n_expected);
    end if;

    execute 'reset role';
  exception when others then
    execute 'reset role';
    failures := failures || format(E'\n  [profiles RLS] guard itself errored: %s', sqlerrm);
  end;

  -------------------------------------------------------------------------------------
  -- Guard 3 (2026-09-09, 0eb3a2c): current_role()/is_staff()/my_permissions()/
  -- has_permission() must stay grantless to `anon`. errorKind()'s NOSESSION
  -- classification in app/index.html depends on this being true — "permission denied for
  -- function X" is trusted as PROOF a request went out unauthenticated (dead session)
  -- specifically because anon can never legitimately reach these functions any other way.
  -- If anon ever gains EXECUTE here, NOSESSION starts misfiring on requests that are
  -- actually signed in.
  -------------------------------------------------------------------------------------
  begin
    execute 'set local role anon';
    begin
      perform public.current_role();
      failures := failures || E'\n  [function grants] anon can call current_role() without error — errorKind()''s NOSESSION classification (app/index.html) will no longer distinguish a dead session from an ordinary RLS refusal. Revoke EXECUTE on current_role() from anon.';
    exception when insufficient_privilege then
      null; -- expected: anon must be refused
    end;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    failures := failures || format(E'\n  [function grants] guard itself errored: %s', sqlerrm);
  end;

  -------------------------------------------------------------------------------------
  -- Guard 4 (P0-A, ticket_assets_write_holder): a technician holding a `logging` ticket
  -- must be able to write ticket_assets for it — the allocated-assets closing-questions
  -- feature depends on this, and it once had zero write policy at all for anyone but
  -- staff (proven live by ticket_assets having zero rows against seven real tickets).
  -- Uses a real ticket already in this state rather than staging one, since staging
  -- would itself be a write this guard should not depend on succeeding.
  -------------------------------------------------------------------------------------
  begin
    if not exists (select 1 from public.tickets where id = logging_ticket and holder_id = tech_id and status = 'logging') then
      failures := failures || format(E'\n  [ticket_assets RLS] guard fixture stale: ticket %s is no longer status=logging held by %s — pick a fresh real example and update this guard.', logging_ticket, tech_id);
    else
      execute 'set local role authenticated';
      execute format('set local "request.jwt.claims" = %L', json_build_object('sub', tech_id, 'role', 'authenticated')::text);

      begin
        insert into public.ticket_assets (id, ticket_id, item, qty, note, sort_order)
          values (gen_random_uuid(), logging_ticket, 'Regression guard probe', '0', '', 999);
      exception when insufficient_privilege or others then
        failures := failures || format(E'\n  [ticket_assets RLS] a technician holding a logging ticket cannot write ticket_assets for it (%s) — this is the P0-A gap: zero write policy for anyone but staff. Confirm ticket_assets_write_holder still exists and matches (holder_id = auth.uid() and status = ''logging'').', sqlerrm);
      end;
      execute 'reset role';
    end if;
  exception when others then
    execute 'reset role';
    failures := failures || format(E'\n  [ticket_assets RLS] guard itself errored: %s', sqlerrm);
  end;

  -------------------------------------------------------------------------------------
  -- Guard 5 (2026-09-09, 6f88ae7 + 0eb3a2c): the online/idle presence heartbeat depends
  -- on every signed-in account being able to READ every presence row (Field Devices shows
  -- everyone's badge) and WRITE only its own (the cross-device clobber fix — one account's
  -- device must never be able to overwrite another account's presence row).
  -------------------------------------------------------------------------------------
  begin
    execute 'set local role authenticated';
    execute format('set local "request.jwt.claims" = %L', json_build_object('sub', tech_id, 'role', 'authenticated')::text);

    select count(*) into n_before from public.presence;
    select count(*) into n_after from public.presence where profile_id = tech_id;
    -- Read-any: this account should see at least its own row among however many exist
    -- company-wide, i.e. it must not be silently filtered to only its own.
    if n_before < n_after then
      failures := failures || E'\n  [presence RLS] guard invariant broken (n_before < n_after) — cannot evaluate read-any.';
    end if;

    begin
      insert into public.presence (profile_id, active_view, updated_at)
        values (tech_other, null, now())
        on conflict (profile_id) do update set updated_at = excluded.updated_at;
      failures := failures || format(E'\n  [presence RLS] account %s can write ANOTHER account''s (%s) presence row — this is exactly the cross-device clobber shape (0eb3a2c): one signed-in device overwriting a fact only another device should state. presence_upsert_own must scope profile_id = auth.uid().', tech_id, tech_other);
    exception when insufficient_privilege or others then
      null; -- expected: writing someone else's row must be refused
    end;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    failures := failures || format(E'\n  [presence RLS] guard itself errored: %s', sqlerrm);
  end;

  -------------------------------------------------------------------------------------
  -- Guard 6 (2026-09-09, migration 0069): the company-wide Activity read the owner asked
  -- for — "technicians should see the same as observers... tools allocated... they can
  -- see all tickets" — depends on four live facts at once: ticket_assets is readable
  -- company-wide by any technician AND correctly correlated to the ticket it belongs to
  -- (not the `c.ticket_id = c.ticket_id` self-comparison bug this same migration fixed,
  -- which would have silently re-opened as a cross-ticket leak the moment anyone widened
  -- the policy again without noticing the bug); ticket_notes is readable company-wide by
  -- any technician; a founder/Observer can read a ticket regardless of its status, not
  -- only 'approved'; and — the one thing that must NOT have moved — ticket_items
  -- (pricing) stays invisible to a technician on a ticket they do not crew, exactly as
  -- it was before this migration. Uses two disposable tickets and their child rows
  -- rather than a real fixture, since the point is cross-ticket isolation, which no
  -- existing pair of real tickets can be relied on to demonstrate at any given moment.
  -------------------------------------------------------------------------------------
  begin
    insert into public.tickets (id, technician_id, holder_id, client_id, job_type_id, status) values
      ('aaaaaaaa-0000-4000-8000-00000000a001', tech_other, tech_other, (select id from public.clients limit 1), (select id from public.job_types limit 1), 'done'),
      ('bbbbbbbb-0000-4000-8000-00000000b001', tech_id, tech_id, (select id from public.clients limit 1), (select id from public.job_types limit 1), 'sent_finance');
    insert into public.ticket_crew (ticket_id, profile_id, position) values
      ('aaaaaaaa-0000-4000-8000-00000000a001', tech_other, 0),
      ('bbbbbbbb-0000-4000-8000-00000000b001', tech_id, 0);
    insert into public.ticket_assets (id, ticket_id, item, qty, note, sort_order) values
      (gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-00000000a001', 'GUARD6-ASSET-A', '1', '', 0);
    insert into public.ticket_notes (id, ticket_id, raised_by, body) values
      (gen_random_uuid(), 'bbbbbbbb-0000-4000-8000-00000000b001', tech_id, 'GUARD6-NOTE-B');
    insert into public.ticket_items (id, ticket_id, item_number, description, uom, qty, unit_cost) values
      (gen_random_uuid(), 'bbbbbbbb-0000-4000-8000-00000000b001', 'MKN-G6', 'GUARD6-ITEM-B', 'ea', '1', 1);

    execute 'set local role authenticated';
    execute format('set local "request.jwt.claims" = %L', json_build_object('sub', tech_other, 'role', 'authenticated')::text);
    select exists(select 1 from public.ticket_assets where item = 'GUARD6-ASSET-A') into n_check;
    if not n_check then
      failures := failures || E'\n  [ticket_assets RLS] a technician cannot read another technician''s ticket_assets row at all — company-wide read (migration 0069) is missing or has regressed.';
    end if;
    select exists(select 1 from public.ticket_notes where body = 'GUARD6-NOTE-B') into n_check;
    if not n_check then
      failures := failures || E'\n  [ticket_notes RLS] a technician cannot read another technician''s ticket_notes row — company-wide read (migration 0069) is missing or has regressed.';
    end if;
    select exists(select 1 from public.ticket_items where description = 'GUARD6-ITEM-B') into n_check;
    if n_check then
      failures := failures || E'\n  [ticket_items RLS] a technician on neither ticket''s crew can read ANOTHER technician''s priced items — pricing has leaked past crew-scoping. Migration 0069 deliberately left ticket_items untouched; this must stay false.';
    end if;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    failures := failures || format(E'\n  [migration 0069 · technician reads] guard itself errored: %s', sqlerrm);
  end;

  begin
    execute 'set local role authenticated';
    execute format('set local "request.jwt.claims" = %L', json_build_object('sub', founder_id, 'role', 'authenticated')::text);
    select exists(select 1 from public.tickets where id = 'aaaaaaaa-0000-4000-8000-00000000a001') into n_check;
    if not n_check then
      failures := failures || E'\n  [tickets RLS] the Observer (founder) cannot read a ''done''-status ticket — tickets_select_founder is still status-restricted; migration 0069 widened it to unconditional and this proves it stayed that way.';
    end if;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    failures := failures || format(E'\n  [migration 0069 · founder reads] guard itself errored: %s', sqlerrm);
  end;

  -- Confirm the exact shape of the fix, not just its effect: a policy that happens to
  -- pass the behavioural checks above by some OTHER route (e.g. is_staff() creeping in)
  -- would not actually prove the self-comparison bug is gone. Read the qual back.
  begin
    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'ticket_assets' and policyname = 'ticket_assets_select_crew'
        and qual not like '%ticket_assets.ticket_id%'
    ) then
      failures := failures || E'\n  [ticket_assets RLS] ticket_assets_select_crew no longer correlates to ticket_assets.ticket_id in its own text — the c.ticket_id = c.ticket_id self-comparison bug (fixed in migration 0069) may have come back.';
    end if;
  exception when others then
    failures := failures || format(E'\n  [ticket_assets RLS] qual-text guard itself errored: %s', sqlerrm);
  end;

  -------------------------------------------------------------------------------------
  -- Guard 7 (2026-09-10): the six client price lists (WAHA 1, WAHA 2, AGOCO, HOO, SOC,
  -- Zueitina — 2,608 items total) were fully replaced with the cleaned, reviewed batches
  -- supplied by the owner. This is exactly the class of fact cloudstub.js cannot check:
  -- there is no real price_list_items data behind the offline demo seed, so a Playwright
  -- test proves nothing about whether the live table actually holds 2,608 real rows
  -- split correctly across five real clients, not 2,610 stale ones or a partial import
  -- left over from an interrupted batch run.
  --
  -- Also confirms has_valid_code is still the GENERATED column it was found to be mid-
  -- migration (`(item_number ~ '[A-Za-z]') AND (item_number ~ '[0-9]')`) — a future
  -- migration that turns it into a plain writable column would silently stop enforcing
  -- "the CODE column itself is unreadable" and let a bad import set it to whatever it
  -- likes, which is exactly the ambiguity that caused the 428C9 insert failure this
  -- guard exists to remember.
  -------------------------------------------------------------------------------------
  begin
    select count(*) into n_before from public.price_list_items;
    if n_before is distinct from 2608 then
      failures := failures || format(E'\n  [price_list_items] expected exactly 2608 rows after the 2026-09-10 replacement, found %s — a batch may be missing or duplicated.', n_before);
    end if;
  exception when others then
    failures := failures || format(E'\n  [price_list_items] row-count guard itself errored: %s', sqlerrm);
  end;

  begin
    for expected in
      select * from (values
        ('Waha Oil Company', 681),
        ('AGOCO', 245),
        ('Harouge Oil Operations (HOO)', 424),
        ('Sirte Oil Company (SOC)', 372),
        ('Zueitina Oil Company', 886)
      ) as x(client_name, expected_count)
    loop
      select count(*) into n_before
      from public.price_list_items p join public.clients c on c.id = p.client_id
      where c.name = expected.client_name;
      if n_before is distinct from expected.expected_count then
        failures := failures || format(E'\n  [price_list_items] client "%s" should carry %s items after the 2026-09-10 replacement, found %s.', expected.client_name, expected.expected_count, n_before);
      end if;
    end loop;
  exception when others then
    failures := failures || format(E'\n  [price_list_items] per-client count guard itself errored: %s', sqlerrm);
  end;

  begin
    select count(*) into n_before
    from public.price_list_items p join public.clients c on c.id = p.client_id
    where c.name = 'Sirte Oil Company (SOC)' and p.currency <> 'LYD';
    if n_before > 0 then
      failures := failures || format(E'\n  [price_list_items] SOC carries %s row(s) not priced in LYD — its price list is quoted in Libyan Dinar, never USD.', n_before);
    end if;
    select count(*) into n_before
    from public.price_list_items p join public.clients c on c.id = p.client_id
    where c.name <> 'Sirte Oil Company (SOC)' and p.currency <> 'USD';
    if n_before > 0 then
      failures := failures || format(E'\n  [price_list_items] %s row(s) outside SOC are not priced in USD — every other client''s list is USD.', n_before);
    end if;
  exception when others then
    failures := failures || format(E'\n  [price_list_items] currency guard itself errored: %s', sqlerrm);
  end;

  begin
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'price_list_items' and column_name = 'has_valid_code'
        and generation_expression = '((item_number ~ ''[A-Za-z]''::text) AND (item_number ~ ''[0-9]''::text))'
    ) then
      failures := failures || E'\n  [price_list_items] has_valid_code is no longer the generated expression this project depends on (readable code = contains a letter AND a digit) — a plain writable column here would let an import set it to anything, including the wrong thing.';
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'price_list_items' and column_name = 'review_flags'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'price_list_items' and column_name = 'pricing_details'
    ) then
      failures := failures || E'\n  [price_list_items] review_flags/pricing_details (migration 0070) are missing — the ~214 rows the cleaned batches flagged for human review would have nowhere to record why.';
    end if;
  exception when others then
    failures := failures || format(E'\n  [price_list_items] has_valid_code/review_flags shape guard itself errored: %s', sqlerrm);
  end;

  -------------------------------------------------------------------------------------
  -- Guard 8 (2026-09-10, migration 0073, Part 1 of the session's seven-part plan): the
  -- purge tool. Two facts only Postgres can confirm, neither of which a Playwright test
  -- against the offline demo/cloudstub.js could ever prove:
  --
  --   · purge_confirmation_codes carries RLS on and NO policy for any role — not even the
  --     admin who requested a code may read or write it directly. The one-time code lives
  --     here only as a hash, and the only door open to this table is the admin-actions
  --     Edge Function's service-role key, which bypasses RLS entirely. A policy ever
  --     appearing here (even an "admin can read their own row" one, added with good
  --     intentions) would let a signed-in admin session read back its own emailed code's
  --     hash — not the code itself, but a foothold this table was built to have none of.
  --   · purge_test_tickets deletes exactly one row (`delete from tickets ...`) and relies
  --     entirely on every ticket-child table cascading from it — ticket_lines,
  --     ticket_items, ticket_crew, ticket_assets, ticket_attachments, ticket_notes, and
  --     audit_log.ticket_id. If any one of these were ever changed to NO ACTION or
  --     SET NULL, the purge would either fail outright (NO ACTION refuses the parent
  --     delete while children remain) or worse, silently orphan rows (SET NULL) that the
  --     app would then render with a blank ticket reference. Confirmed live once already,
  --     re-confirmed here as a standing fact rather than a one-time observation.
  -------------------------------------------------------------------------------------
  begin
    if not exists (
      select 1 from pg_class where relname = 'purge_confirmation_codes'
        and relnamespace = 'public'::regnamespace and relrowsecurity
    ) then
      failures := failures || E'\n  [purge_confirmation_codes RLS] the table either does not exist or does not have row level security enabled — the one-time purge code would be readable by anyone with a client, not just the service-role Edge Function.';
    end if;
    select count(*) into n_before from pg_policies
      where schemaname = 'public' and tablename = 'purge_confirmation_codes';
    if n_before <> 0 then
      failures := failures || format(E'\n  [purge_confirmation_codes RLS] %s client-reachable polic(y/ies) exist on this table — it must have none. Even an "admin reads their own row" policy would let a session read back the hash of a code that was only ever supposed to reach one inbox.', n_before);
    end if;
  exception when others then
    failures := failures || format(E'\n  [purge_confirmation_codes RLS] guard itself errored: %s', sqlerrm);
  end;

  begin
    for expected in
      select * from (values
        ('ticket_lines'), ('ticket_items'), ('ticket_crew'), ('ticket_assets'),
        ('ticket_attachments'), ('ticket_notes'), ('audit_log')
      ) as t(table_name)
    loop
      select array_agg(distinct rc.delete_rule)
        into actual_cols
        from information_schema.table_constraints tc
        join information_schema.referential_constraints rc
          on tc.constraint_name = rc.constraint_name and tc.constraint_schema = rc.constraint_schema
        join information_schema.constraint_column_usage ccu
          on rc.unique_constraint_name = ccu.constraint_name and rc.unique_constraint_schema = ccu.constraint_schema
        where tc.constraint_type = 'FOREIGN KEY'
          and tc.table_schema = 'public' and tc.table_name = expected.table_name
          and ccu.table_name = 'tickets';

      if actual_cols is null or not ('CASCADE' = any(actual_cols)) then
        failures := failures || format(
          E'\n  [purge cascade] %s''s foreign key to tickets is %s, not CASCADE — purge_test_tickets''s single `delete from tickets` (admin-actions Edge Function) would no longer clean this table up, and would either refuse the whole purge or leave orphaned rows behind depending on which rule replaced it.',
          expected.table_name, coalesce(array_to_string(actual_cols, ', '), '(no such foreign key found)'));
      end if;
    end loop;
  exception when others then
    failures := failures || format(E'\n  [purge cascade] guard itself errored: %s', sqlerrm);
  end;

  -------------------------------------------------------------------------------------
  if failures <> '' then
    raise exception E'REGRESSION GUARD FAILURES:%', failures;
  else
    raise notice 'ALL REGRESSION GUARDS PASSED';
  end if;
end $$;

rollback;
