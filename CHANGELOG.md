# Changelog

Every released batch, newest first. The version here is the `BUILD` string on the login
screen — it is the only way a technician at a wellhead can tell which code their phone is
running, so it changes with every release and nothing else changes it.

---

## v1.0.0 · trial — 2 September 2026

The batch the field trial runs on. First numbered release.

### Security

- **Price lists are the office's** (`0045`). `price_list_items` was readable by every
  signed-in account — a technician's phone held the company's entire pricing, 2,610 rows,
  in localStorage, on a device that goes to a client's wellhead. SELECT and write are now
  `is_staff()`. The write policy also said `current_role() = 'admin'` while
  `pricelist.edit` was granted to ops_manager, so the app showed the Ops Manager an
  editing screen the database refused; both halves now agree.
- **A trigger function is not an API endpoint** (`0044`). `tg_profile_base_follows_role`
  was executable by PUBLIC — `0040` revoked it from `anon` and `authenticated`, which
  inherit the PUBLIC grant rather than replacing it, so the function stayed reachable at
  `/rest/v1/rpc/`. It was the only one in the schema with that hole.
- **Sign-up is for the company** (`0046`). Self-registration is limited to `@makaman.ly`
  and capped at five in any rolling 24 hours, enforced in `handle_new_user`. Accounts the
  office creates are exempt, marked through **app** metadata — which only the service-role
  key can write — rather than user metadata, which the browser supplies. The sign-up form
  states the rule before anything is typed and refuses in plain language.

### Speed

- **Date formatters memoised.** Every date render was constructing a fresh
  `Intl.DateTimeFormat`; a 120-row list built 700+ of them per render. At 4× CPU
  throttle `ticketView` went from 273 ms to **32 ms** at 120 tickets, and 1,684 ms to
  **88 ms** at 400.
- **Price lists off the sign-in path.** The full pull dropped from 22 requests to 19, and
  a technician's device now downloads none of the 2,610 rows. The office fetches one
  customer's list when it opens something that needs it, held for the session and never
  written to disk.
- **Cold boot** 5,029 KB → 1,967 KB; the full pull 34 requests / 4 sequential → 19 / 2.

### Fixed

- **An approved ticket came back as Awaiting review after closing the app.** The outbox
  drain wrote back `q.slice(done)`, discarding ops that had already been sent along with
  their retry counts. Operations are now numbered, merged back by number, and the drain is
  exclusive so two cannot overlap and double-send. A dropped connection no longer burns
  the retry budget — five drains with no signal used to abandon a technician's ticket.
- **Suggested charge lines stopped appearing.** They were built by intersecting the price
  list with usage, so they needed a client row matching the ticket's customer name exactly
  and every historical item number still on the current list. Both fail on what happens
  next: the office types customer names, and the corrected batches are being re-imported
  with changed codes. Suggestions now come from history — what this customer was actually
  charged — and a code no longer on the price list is **marked**, not dropped.
- **The awaiting-paperwork count could exceed what its filter showed.** The inbox is gated
  on a ticket the device has seen the server acknowledge and the counter was not, so the
  tile could read 1 above an empty table.

### Changed

- **Base Location and Customer Representative** are hardcoded onto every ticket
  (`Makaman Base {Awjilah} 29°06'29.2"N 21°22'37.6"E` and `Drilling/Workover Office`) and
  editable only by the office.
- **The awaiting-paperwork backlog is a count, not a pile.** It rendered every waiting
  ticket in a warning box above the inbox, in two places — twenty jobs waiting on a
  signature buried the inbox somebody opened the screen to read, and every ticket appeared
  twice. It is now one figure in the counter row (one strip on a phone) that filters the
  list below.
- **The job objective is suggested from the job log.** Phrases a technician actually
  writes — "P/T to 3000 psi", "pressure tested", "acid job" — propose
  `PKR FOR CSG TEST & ACID JOB`, joined with `&` in the order mentioned. Suggested only:
  it is never written without a tap, and accepting is recorded as an edit with both values.
- **Ticket lists page** at 10 with Load more.

### Interface

Against `docs/UX-PRINCIPLES.md`, adopted this release.

- **The Approve button says why it cannot be pressed.** It read "Approve ticket" whether
  or not the four checks passed; only its opacity changed. It now names what is missing
  ("Needs mileage and a job type") and the section counts progress ("Ready to approve —
  2 of 4").
- **Approving says what happens next.** The confirmation named what was accomplished and
  stopped there, at the exact moment the job's longest-running obligation begins. It now
  says the ticket is on the awaiting-paperwork count until the signed sheets come back.
- **Row deletes are real targets.** Four `×` controls — a job-log line, a charged line, an
  allocated tool, a price-list line — were bare 15px glyphs with no border and no
  min-height, beside the input they delete. Now 40 × 40 minimum, with a danger wash and a
  label naming what each removes.

### Also

- Downloadable error log (`makaman.errorlog.v1`): every refusal and failed request with
  its code and source, as markdown, from either Account screen.
- `CLAUDE.md` and `docs/UX-PRINCIPLES.md` added, so the project's standing constraints
  stop living only in chat transcripts.

### Known, and deliberately not in this release

- 20 `auth_rls_initplan` policies and 15 unindexed foreign keys. Invisible at this volume,
  mechanical, and not worth the risk the week before a trial.
- Screen-splitting (Hick, Miller) and progressive disclosure (Tesler) from the UX
  principles: redesigns of screens technicians are being trained on this week.
- Cloudflare in front of the app. It would not protect sign-up or login at all — those go
  from the phone straight to the Supabase project, which is not behind that DNS record.
  Rate limiting belongs in Supabase Auth settings plus `0046`.
