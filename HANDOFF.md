# Makaman Job Tickets — resume here

**If you are a coding agent starting a fresh session: read this file top to bottom first.**

---

## 0. What to do first, in order

1. Confirm the **Supabase** and **Vercel** MCP connectors are loaded in this session.
2. Read the rest of this file.
3. Check whether Part A's Vercel step actually went live (see §3a) before redoing any of it.

---

## 1. What this project is

A job-ticket system for **Makaman Libya**, an oilfield services company.

Field technicians work in off-grid locations with no internet. A technician opens a **Job Ticket** on arrival at a well site (arrival time auto-stamped), records Customer / Field Name / Well No. / Rig Name, then logs job events line by line — each line auto-stamped with its own date and time. The first line sets the *Start Job* date; pressing **Job Done** sets the *End Job* date. All of this works fully offline and is pushed up with a **Sync** button when signal returns.

Once synced, the **Ops Manager** reviews the ticket: assigns a unique ticket number, enters one-way mileage (charged as round trip), and adds charged items drawn from that client's price list. Four checks must pass before **Approve** unlocks. Approved tickets are then printed onto four sheet layouts the company already uses: Service Ticket (Original + Copy) and Job Log (Original + Copy).

**Admin** manages price lists, numbering, job types and users. **Founder** gets a read-only report.

### Roles and permissions

| Action | Technician | Ops Manager | Admin |
|---|---|---|---|
| Create and log own tickets | ✅ | – | ✅ |
| Edit own ticket before approval | ✅ | – | ✅ |
| Review / approve any Done ticket | – | ✅ | ✅ |
| Edit Arrival / Start / End stamps, and individual job-log line timestamps, after Job Done | – | ✅ | ✅ |
| Approve signups (→ assigns Technician role) | – | ✅ | ✅ |
| Create Technician accounts directly | – | ✅ | ✅ |
| Promote a user to Ops Manager or Admin | – | – | ✅ |
| Manage price lists / numbering / job types | – | – | ✅ |

Admin has every permission. Signups always land pending and are approved by an Ops Manager, which automatically assigns the Technician role.

**Timestamp editing scope (confirmed):** both the ticket-level Arrival/Start/End stamps *and* the individual job-log line timestamps are editable by Ops Manager/Admin. Every edit — either kind — appends to `audit_log`.

---

## 2. Repository layout

```
app/                        Vite + React PWA — this is the deployable app
  public/                   real Makaman Libya logo + generated PWA icon set
  src/styles/theme.css      CSS-variable theming (light/dark/system + 5 accents)
  src/context/              AuthContext, SettingsContext
  src/lib/                  format.js (timezone + 12h/24h), offlineQueue.js,
                            geolocation.js, supabaseClient.js
  src/screens/              Login, Signup, PendingApproval, Settings,
                            technician/, ops/, admin/, founder/
  .env.example              env vars the app needs
  .env.production           committed — live Supabase URL + anon key (see §3a note on why)
supabase/
  migrations/0001_init.sql  schema + RLS + auth trigger + seed reference data
  migrations/0002_...sql    adds price_list_items.unit_cost_additional + currency, clients.currency
  functions/admin-actions/  Edge Function for privileged user management
HANDOFF.md                  this file
```

---

## 3. Status: what is built and live

- **PWA** — `vite-plugin-pwa` generates the manifest and service worker.
- **Real auth** — Supabase Auth with email + password. A DB trigger (`on_auth_user_created`) creates the matching profile row so signups can never end up account-without-profile.
- **Settings screen** — logo, light/dark/system theme, five accent colors (Makaman red default), timezone, 12h/24h, technician location-sharing toggle, Logout.
- **Real logo** — the actual Makaman Libya artwork is in, trimmed/transparent, split into a wide wordmark (`logo.png`) and a square mark (`mark.png`, used for the topbar/favicon/app icons).
- **Editable timestamps — ticket-level and line-level** — after Job Done, Ops Manager and Admin can correct Arrival / Start job / End job from the review sidebar, *and* correct any individual job-log line's timestamp inline next to that line. Every change appends to the ticket's audit trail. Enforced by RLS policies (`tickets_update_staff`, `ticket_lines_update_staff`), not just the UI.
- **Silent location note** — if a technician enables it in Settings, opening a ticket quietly captures GPS coordinates into `tickets.ops_location_note`, visible only to Ops Manager and Admin.
- **Offline-first tickets** — `src/lib/offlineQueue.js` keeps tickets in localStorage and pushes dirty ones on Sync.
- **Real price list data** — the workbook `Autofill_ServiceTikcet_System.xlsx` (sent mid-session) turned out to contain the real Service Ticket/Job Log layout *and* the real per-client price lists. Parsed and imported: **2,274 items across 6 clients** (Waha ×2 sheets, AGOCO, Harouge/HOO, Sirte/SOC, Zueitina). Schema extended (`0002_price_list_two_tier_and_currency.sql`) to capture first-day-vs-additional-day pricing and per-client currency (SOC is priced in LYD, the rest in USD) — see `unit_cost_additional` and `currency` columns. Admin's Price Lists screen and Ops's item lookup on Ticket Review both surface these.

### Supabase (live)

- Project: `makaman-job-tickets`, ref `igutjfezxkdncrcpvnqx`, org `Zin-sudo's Org`.
- Migrations `0001_init` and `0002_price_list_two_tier_and_currency` applied.
- `admin-actions` Edge Function deployed.
- Admin seeded: `Lateri@makaman.ly` — **tell the user to rotate this password**, it was typed into a chat transcript.
- **Email confirmation has NOT been turned off.** No MCP tool in this session exposed Auth config, and no documented Management API path was found either — this needs a human to flip "Confirm email" off under Authentication → Providers → Email in the Supabase dashboard. Required, not optional (see original A.1 rationale below).

### 3a. Vercel — created but NOT verified live

A Vercel project (`makaman-job-tickets`) was created and linked to `Zin-sudo/makaman-app`, with production branch set to `claude/job-log-timestamps-locked-8m5mz0` (`create_git_project` reported success and a real 409-conflict on retry confirms it exists). **But every read call after that — `list_projects`, `get_project`, `get_deployment`, even `web_fetch_vercel_url` — returned 403/404**, across three separate pushes over 30+ minutes. This looks like a permissions/scoping bug specific to that session's Vercel MCP tools, not a real absence, but it was never confirmed live from inside the session. **Check the Vercel dashboard directly first** before assuming this step needs to be redone — if the project is there and deployed, just set env vars (below) if missing and move on to A.5 verification.

If it's genuinely not there: root directory `app`, framework Vite, build command `npm run build`, output directory `dist`. Env vars — `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — are already committed in `app/.env.production` (Vite reads this automatically for production builds; this is safe because the anon key is meant to be public and RLS is what actually protects data), so no manual env var step should even be needed unless that file is missing or stale.

### A.5 Verify on the live URL (do this whenever the URL is confirmed live)

Walk the whole flow, do not just check that it loads:

1. Log in as the seeded Admin.
2. Create a Technician account, and separately sign up a test account and approve it as Ops Manager.
3. Log a ticket as that technician with the location setting on.
4. Press Job Done.
5. Review it as Ops Manager: set ticket number, mileage, job type, add an item (try one with a two-tier price, e.g. an item with an "Add'l Day" rate, and one from Sirte/SOC to see LYD).
6. **Edit a ticket-level timestamp AND an individual job-log line timestamp; confirm both appear in the audit trail.**
7. Change theme, timezone and 12h/24h in Settings; reload and confirm they persist.
8. Log out.

---

## PART B — The four sheets (template + data now in hand, generation not yet built)

Layout preview only (`app/src/screens/ops/PrintPreview.jsx`) — no real file is generated yet.

### What's now available (previously blocking, now resolved)

`Autofill_ServiceTikcet_System.xlsx` (in the chat upload) contains:
- **`Service Ticket (Original)`** and **`Service Ticket (Copy)`** sheets — real, filled example (customer HAROUGE). Exact cell map (row/col), confirmed by direct read:
  - `B8` Customer, `E8` Ticket No, `B9` Field Name, `B10` Well No, `E10` MKN Supervisor, `B11` Rig Name, `E11` Start Job, `E12` End Job, `B12` Mileage (Km, one-way — `C16` formula does `=B12*2` for round trip).
  - `B13` Base Location — **confirmed by the user: this is a permanent default, not a formula and not entered per-ticket.** It stays the same across every ticket unless the Ops Manager changes it for that ticket. Model it as an admin-configured default string, pre-filled at draft/review time, overridable per ticket by Ops Manager — not as free technician input and not as a spreadsheet formula.
  - Line items start row 15 (headers) / 16 (first data row): `A` Item no., `B` Description, `C` Qty, `D` Unit, `E` Unit Cost, `F` Total Cost (`=C*E`).
  - Row 22 "DESERT/MARINE Surcharge" (item `MKN-1963`, 20% of items subtotal — `D22`=0.2, `E22`=`SUM(F16:F21)`, `F22`=`E22*D22`) — **confirmed by the user: this is a normal price-list item that goes on nearly every ticket for nearly every client, not hardcoded math.** The Ops Manager can remove/waive it per ticket as a client goodwill gesture when the total feels overwhelming. Model as: a price-list item of a "percentage of subtotal" type, added by default when a ticket is drafted, removable during Ops review before Approve.
  - Row 24 "Discount 60%" (`E24`=`E22+F22`, `F24`=`-(E24*0.6)`) — **confirmed by the user: not a standard 60%, and not applied by default.** Discounts at varying percentages are applied at the Ops Manager's discretion during review, occasionally, case by case. Model as: an optional percentage-discount line the Ops Manager adds manually per ticket, never defaulted, with the percentage entered at the time (60% in this sample was just what was chosen for that ticket).
  - **Both the surcharge and the discount are meant to eventually become selectable price-list items** (so Ops Manager picks them the same way as any other charged item when drafting/reviewing a ticket) rather than being separate hardcoded formulas — factor this into the `price_list_items` / `ticket_items` schema when Part B is actually built (e.g. an item "kind": flat / percentage-of-subtotal, and a "default-add-on-draft" flag for the surcharge specifically).
  - `A40`/`F40` grand total = `E24+F24` (i.e. subtotal + whatever surcharge/discount lines actually ended up applied that ticket). Signature block rows 44/49.
- **`Job Log (Original)`** / **`(Copy)`** — most header fields are formulas pulling from the Service Ticket sheet (`='Service Ticket (Original)'!E8` etc.), so the Job Log's header is derived, not independently entered. Log lines start row 20: `A` Date, `B` Time, `C` Pressure, `D` Total, `E:I` (merged) Details of the Job. ~25 line rows before the closing signature block at row 45/48.
  - `F14` "Customer Rep." (example value: "Workover Office") — **confirmed by the user: same pattern as `B13` above.** Permanent default, not a formula despite sitting among formula cells, not per-ticket technician input. Stays constant unless the Ops Manager overrides it for that ticket.
- **Six client price lists** — already parsed and imported into `price_list_items` (see §3 above). If a 7th client or a workbook revision arrives later, the parser used is described below so it can be re-run.

### Parsing notes for the price list sheets (for re-running or extending)

Each client sheet repeats this pattern many times: a bold section header (col A, sometimes "← Contents" in a far column), an optional subsection title row, then a column-header row where **col A is literally the text "Item Code"**, col B "Description", and then either one "Price"-ish column, or a "Unit" column followed by one price column, or a "First Day"/"Additional Day" pair. Data rows follow until the next such header row. Two things to watch for if re-parsing:
- **WAHA 1 Price List's item codes/descriptions/prices are external-reference formulas** (`='[1]1'!A7` etc.) pointing at a file not present in the workbook — you MUST read with `data_only=True` (cached values) or you'll get formula text instead of real data. All other sheets are plain values.
- Source data has real-world messiness: leading/trailing spaces in codes, a couple of literal duplicate item numbers within the same client (last-one-wins was used, acceptable), one row with a doubled dash (`MKN100--020`), etc. Don't over-normalize — preserve what's there.

### Decisions already made — do not re-ask

- **Delivery: download from the app.** No cloud credentials needed.
- **Format: both Excel and PDF.**
- **Structure: both per-ticket and a running master workbook.**

### Still needed before generation can be built

- Confirm the 60% discount and 20% surcharge logic seen in the sample ticket is standard/always-applied vs. situational.
- The Job Log's "Job Type" cell (`F12`) actually pulls `='Service Ticket (Original)'!A14`, which in the sample held free text (`" 7'' Combination For CSG Test & Cement Job"`) rather than referencing the `job_types` table — decide whether Job Type in the real template means the admin-managed `job_types` picklist or a free-text line-item header, and adjust the Ops Manager review UI/mapping accordingly.

### Implementation note

Generation should be a Supabase Edge Function, not the browser, using the real `.xlsx` as a template (fill cells, keep formatting/logo/print setup) and also render a PDF.

---

## 4. Known gaps and deliberate scope decisions

- **Ticket numbering is manual** with a uniqueness check at entry. Not an auto-assigner.
- **Vercel deployment status unconfirmed** — see §3a, resolve before redoing Part A work.
- **Email confirmation still needs a manual dashboard toggle** — see §3.

## 5. Security notes worth carrying forward

- The `admin-actions` Edge Function runs with the service-role key and therefore bypasses RLS. It re-derives the caller's identity from their own JWT and re-checks their role on every action — never let it trust a `userId` or role supplied in the request body.
- Role changes to Admin or Ops Manager are restricted to Admins inside that function, independently of what the UI shows.
- The seeded Admin password was shared in a chat transcript and should be rotated.
- The Admin's first-boot seed used a direct `insert into auth.users` (with `crypt()`/pgcrypto for the password hash) plus a matching `auth.identities` row, because no MCP tool exposed an "create auth user directly" action. This is an unsupported-but-commonly-used pattern for bootstrapping the first account; verify login works and don't repeat it for anyone else — use `admin-actions`'s `create_technician` action (or the real signup+approve flow) for every subsequent account.

---

## Session checkpoint — paused for Claude Pro usage reset

Working from the other session's handoff bundle (`NEXT_SESSION_BRIEF.md`, `CELL_MAPPING.md`,
`REQUESTS_TO_FLAG.md`, `Field_Technician_Logging_App.zip`). Plan agreed with the user:
work only inside `Job Ticket System.dc.html` (never port frameworks, never touch
`support.js`, never restyle), cheap-first with a screenshot preview after every change,
backend/Vercel untouched until the whole visual layer is signed off. Prototype not yet
committed into this repo (still pending the `prototype/` baseline commit step).

**AskUserQuestion phase (4 questions total, per the other session's pre-batching) — status:**

- **Q1 (business rules, items 1–4)** — not asked yet.
- **Q2 (app-level features, items 5–8) — ANSWERED.** User selected **all four**:
  - Settings screen (Light/Dark/System + accent, timezone, 12h/24h, silent-location
    toggle, red full-width Logout)
  - Real Login/Signup (replaces the demo role-switcher; signups pending, Ops Manager
    approval auto-assigns Technician)
  - Role management (Admin promotes to Admin/Ops Manager; Admin **and** Ops Manager can
    create Technician accounts directly)
  - Real Makaman logo (swap text branding for the real lockup — large/centred on
    Login/Signup, medium on Settings)
  - (Item 9 — ticket-level Arrival/Start/End editable by Ops Manager + audit trail — was
    folded into this question's context as "already partially there, verify it," not a
    separate toggle. Still needs explicit confirmation once we're back in the zip.)
- **Q3 (backend timing: now vs. after the four sheets)** — not asked yet.
- **Q4 (Pressure/Total columns on job-log lines)** — not asked yet.

**Resume point:** ask Q1, Q3, Q4 (can combine into remaining AskUserQuestion calls, cap 4
questions/call), then start the `prototype/` baseline commit + first screenshot-gated
edit pass. Do not re-ask Q2 — already answered above.

---

## Session checkpoint — all 4 AskUserQuestion rounds now answered

**Q1 (business rules) — ANSWERED, all four selected:**
- Line-level job-log timestamps editable by Ops Manager/Admin, audited
- `B13`/`F14` as permanent admin-configured defaults, Ops-Manager-overridable per ticket
- 20% desert/marine surcharge as a real price-list item (percent-of-subtotal), auto-added
  on draft, Ops Manager can remove per ticket
- Discount as a price-list item (percent-of-subtotal, negative sign), manual, variable
  rate, never defaulted

**Q3 (backend timing) — ANSWERED: after the four sheets.** Finish and sign off the whole
visual/behavioural layer in the prototype (including Part B's four sheets) before
touching Supabase/Vercel wiring.

**Q4 (Pressure/Total on job-log lines) — ANSWERED: optional per line.** Add Pressure and
Total as fields on every job-log line, matching Job Log sheet columns C/D, but leave them
blank-by-default/optional since not every job type has a reading to log.

All 4 questions from the other session's pre-batched plan are now answered (Q2 was
answered in the prior checkpoint above — Settings screen, real Login/Signup, role
management, real logo, all four selected).

**Next up:** commit the untouched zip contents as the `prototype/` baseline, then begin
screenshot-gated edits to `Job Ticket System.dc.html` one change at a time, starting with
whichever screen makes sense first (likely Login/Signup, since Settings/logo/role-mgmt
all touch it).

---

## Session checkpoint — two more decisions (previously lost to an interrupted tool call, now captured)

**Item search + behavioral item suggestions for the Ops Manager (price list, during ticket
review/drafting):**
- **Search by item no.** — Ops Manager can search/filter a client's price list by item
  number instead of scrolling a long list every time.
- **Behavioral suggestions** — track which items a given Ops Manager actually adds for a
  given *client* over time. Next time the same client is being served, surface the most
  likely next item as a suggestion.
  - Show **one suggestion at a time**, not a list.
  - If the offered suggestion is picked, immediately offer the *next* item in that
    client's behavioral sequence.
  - Keep offering the next-most-likely item until the behavioral pattern runs out, then
    stop — let the Ops Manager finish adding items manually, don't clutter the screen with
    suggestions that aren't backed by real behavior.
  - Real-world sequence example the client described: **Transportation → Engineer → Tool:
    first day → Tool: additional/after-first day → Desert/Marine surcharge** (surcharge
    not applicable to every client — matches the existing surcharge business rule).
  - Goal stated explicitly: speed up filling out the service ticket before approval, not
    to replace manual selection.

**"Previous page" / back navigation — needs to be a visible button, not plain text.**
- E.g. the "‹ All tickets" back link (visible in the annotated screenshot,
  `draw-2d624c37...png`) reads as plain text today, which is easy to miss for someone who
  isn't a habitual app/mobile user.
- Client's stated reason: some of the people being trained on this app aren't very
  tech-comfortable, so back/previous navigation needs an actual button treatment (visible
  bounds, not just a text link) wherever it appears in the prototype, not just on that one
  screen.

These fold into the already-answered Q1 (business rules — the suggestion behavior is a
UX/workflow detail of "Ops Manager adds price-list items," not a new toggle) and Q2 (app
features — navigation/back-button treatment applies across whichever screens get built).
No new AskUserQuestion round needed for these two; they're direct instructions.

---

## Session checkpoint — Part B (four sheets) questions answered

**Master workbook — ANSWERED: both.** A summary/index sheet at the front (one row per
approved ticket: ticket no., client, dates, total, etc.) plus every approved ticket's full
Service Ticket + Job Log sheets appended as their own tabs behind it.

**Item-row overflow — ANSWERED, important correction to `CELL_MAPPING.md`'s row
22/24 references:**
- **No row is fixed in place.** Row 22 (surcharge) and row 24 (discount) in the earlier
  cell mapping were just where they landed on that one sample ticket (HAROUGE/1897) —
  not fixed positions. Do not treat them as constants.
- **Use the real `Autofill_ServiceTikcet_System.xlsx` template file exactly as-is** —
  never invent/recreate the sheet layout. Fetch ticket data and place it using the cell
  mapping at fixed *header* cells (customer, ticket no., etc. — those stay fixed), but:
  - **Job-log lines** are placed in the order they actually occurred (as logged by the
    technician, editable/reorderable by Ops Manager).
  - **Items** are placed in the order the Ops Manager selected them.
- **Fillable region for items + surcharge + discount is rows 16–39** (not just 16–21).
  Never a second page/continuation sheet — whatever fits in 16–39 is what fits; Ops
  Manager arranges within that space as needed.
- **Order preference within that region:** main items first (top), surcharge right after
  the items, discount last (bottom-most of the three).
- **Spacing preference (not mandatory, just preferred when room allows):** one blank row
  between items and surcharge, another blank row between surcharge and discount.
- Grand total row and everything below is unaffected by this — see next point.

**Signature block — ANSWERED: do not touch rows 41–50 at all.** Not just the signature
lines themselves (44/49) — the entire row range 41–50 stays exactly as the real template
has it. No pre-filled names, nothing generated into that range.

**Original vs. Copy sheets — ANSWERED: no difference, exact duplicate.** Both generated
identically. Organizational purpose only: **Original goes to the client's finance
department, Copy stays with Makaman's own finance department.** No visible "COPY" stamp
or any other distinguishing mark.

All Part B/four-sheets questions are now answered. Nothing else pending on this topic —
build the generator against these answers when we get to that phase (after the whole
visual/behavioural layer in the prototype is signed off, per the earlier backend-timing
answer).

---

## Standing rule — preview after every major step

In addition to the per-change screenshot-gated workflow already agreed (small edit →
render → screenshot → get a yes), the user wants a **preview of the PWA itself shown
after every major step** (not just individual small edits) — e.g. after a screen is fully
built out, after a batch of related changes lands, after backend wiring goes in, after a
deploy. Don't let this rule get lost/skipped as the work progresses — check back against
it before declaring any major step "done."

---

## Session checkpoint — baseline preview rendered, CDN-block confirmed independently

Rendered the untouched zip's `Job Ticket System.dc.html` (Technician, Ops Manager,
Admin, Founder views) as the "before" baseline, before any edits. Screenshots sent to
the user, not stored in the repo (scratchpad only, regenerate on demand).

**Confirms the brief's flagged contradiction independently, from a different angle:**
this session's own sandbox network policy blocks `unpkg.com` outbound (proxy denial log
shows explicit 403 on CONNECT to unpkg.com). The prototype could not render at all until
worked around — real, first-hand evidence the app cannot boot without that CDN reachable,
not just a theoretical concern from the brief.

**Preview workaround used (does not touch the prototype):** npm-installed the identical
`react@18.3.1`, `react-dom@18.3.1`, `@babel/standalone@7.29.0` packages into the
scratchpad, then used Playwright's `page.route()` to redirect just those three exact
unpkg.com URLs to the local files for rendering purposes only. Nothing in
`Job Ticket System.dc.html` or `support.js` was modified. Reuse this same interception
setup for every future preview until vendoring those libraries locally becomes the real,
intentional fix (part of the already-flagged offline/installable work — not something to
do early/quietly).

---

## Session checkpoint — baseline preview corrected: Ops Manager Ticket View was missing

User caught that the first baseline preview batch (4 role-landing screens) skipped the
Ops Manager's **Ticket View / Review Detail** screen (opened by clicking Review/View from
the Inbox — sections "1 Ticket Number & Mileage", "2 Charged Items", "3 Job Log From The
Field", "4 Approval", right column Ticket Header + Audit Trail). Captured both states now:
- Approved (Kuwait Oil Group · BG-214, $27,920.40) — confirmed exact match to the user's
  own screenshot of this screen.
- Awaiting Review (Al-Dhafra Energy · RW-98) — same template, unapproved state.

**Lesson for future baseline/preview passes:** the four top-level role landings are not
the whole app — each role has sub-screens reached by navigation (ticket detail, new
ticket, job log, settings, etc.) that also need covering before calling a baseline (or
any "after a major step" preview) complete. Don't assume the landing screens alone
satisfy the "preview after every major step" standing rule.
