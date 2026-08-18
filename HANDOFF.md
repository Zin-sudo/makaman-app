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

---

## Session checkpoint — Numbering & Job Types (Admin) verified against the real business rule

Captured the Admin → **Numbering & Job Types** tab (also missing from the first baseline
batch — same lesson as the Ops Manager Ticket View gap above). It already implements
exactly the per-category numbering scheme the user described:

- **Special Tools** — no letter prefix, plain digits (baseline: last used 1883 → next
  1884). Matches the user's rule: 4-digit, e.g. 1880/1881/1882.
- **Fishing** — `F` prefix (baseline: last used 702 → next F703). Matches: `F` + digits,
  e.g. F800/F801/F802.
- **Drilling** — `D` prefix (baseline: last used 5023 → next D5024). Matches: `D` +
  digits, e.g. D5040/D5041/D5042.

Behavior: admin enters the last number reached on paper, system continues from there and
refuses any number already used. The ticket-view screen's "Take next from series" buttons
(section 1) read live off this same table — cross-checked consistent with the user's
attached screenshot (Special Tools → 1884, Fishing → F703, Drilling → D5024 match on both
screens).

**No change needed here — confirmed working as intended, not a gap.** Keep this numbering
model as-is when we get to the edit phase; don't "fix" or redesign it.

---

## Session checkpoint — Admin "Users & Customers" and "System" tabs captured; OneDrive contradiction found

Captured the remaining two Admin tabs (user sent screenshots directly; re-captured myself
too for a consistent baseline set):

**Users & Customers:**
- Users & Roles table: Yousef Al-Harbi (Field Technician, Ahmadi Base, synced 2h ago),
  Mahmoud Zaki (Field Technician, Ahmadi Base, yesterday), Omar Al-Saleh (Operations
  Manager, Ahmadi Base, live), R. Makaman (Founder (observer), —, live).
- Customers, Fields & Rigs cards: Kuwait Oil Group / Al-Dhafra Energy / Northern Gulf
  Petroleum, each showing field/rig lists and "8 priced items" (demo data — real clients
  are the 6 in Supabase, not these 3 demo names).

**System:**
- Charging & Export Rules: Mileage charging ×2 (one-way KM entered, charged both ways) —
  consistent with the ticket-view screen. Approval gate: 4 checks. Reopen after approval:
  logged, reason mandatory. Excel targets: 4 sheets (Original + Copy for Service Ticket
  and Job Log) — consistent with Part B decisions.
- Danger Zone: "Reset Demo Data" button — resets the prototype's local data back to seeded
  demo tickets/price lists. Harmless dev/demo control.

**Contradiction found — flag, don't silently fix:** both this System tab ("Storage: Local
+ OneDrive — offline-first on device, synced on demand") and the Users & Customers tab's
footnote ("Excel output cell maps — Service Ticket and Job Log templates on **OneDrive**;
each field's target cell is configured here once the layouts are supplied") describe
OneDrive as the storage/export target. This directly contradicts the already-settled Part
B decision: **download from the app, no OneDrive/Google Drive, no cloud credentials
needed.** This baseline copy predates that decision. Same category as the CDN/offline
contradiction already flagged — needs a deliberate fix during the edit phase, not a quiet
one, and not something to leave inconsistent.

Admin section of the baseline is now fully captured: Price Lists, Numbering & Job Types
(verified correct, no change needed), Users & Customers, System (OneDrive copy needs
fixing later). Still not yet captured for baseline: Technician's New Ticket / Job Log
screens, Settings screen (not built yet per Q2), Login/Signup (not built yet per Q2).

---

## Session checkpoint — Part B storage decision finalized (resolves the earlier OneDrive flag)

This resolves the "OneDrive vs. download-from-app" contradiction flagged in the previous
checkpoint. The reasoning that led here (from the other session, carried over verbatim
since it's sound and the user is keeping it):

> Writing to OneDrive/SharePoint means Microsoft Graph — Azure AD app registration,
> tenant ID, client ID/secret, admin consent for Files.ReadWrite.All or
> Sites.ReadWrite.All. That's a request sitting in someone else's queue for days if you're
> not the M365 admin. Download-only needs no credentials, no admin approval, works the
> day it's built. If the Ops Manager's PC has the OneDrive desktop folder synced, saving
> the download into that folder puts the file on OneDrive anyway, in the right place, with
> zero integration work. Building the generator so its output is a file buffer (not
> written straight to disk) means a storage adapter can be bolted on later to push that
> buffer to OneDrive/Drive without touching generation logic.

**Final decision, per-artifact:**

1. **The four per-ticket sheets** (Service Ticket Original/Copy, Job Log Original/Copy) —
   **download only**, Excel + PDF, from the app. Unchanged, no cloud integration.

2. **The running master workbook** gets three access paths, all built:
   - **Download** — same as the per-ticket sheets, a plain file download.
   - **Upload to a linked drive account** — optional, user-initiated. An Admin can link a
     drive account (OneDrive/Google Drive); once linked, the master workbook can be
     pushed there. This is exactly the "storage adapter on a file buffer" pattern already
     planned — build it as an add-on to the generator, not baked into generation logic.
     Not required to work day one; the download path is what ships first and always
     works regardless of whether a drive is linked.
   - **In-app preview backed by Supabase** — the master record is also queryable/viewable
     directly inside the **Admin panel**, not just as a downloadable file. **Visible to
     Admin, Ops Manager, and Founder. Not visible to Technician.** This is a new
     role-gated screen/section, and it means the master-record data needs to live in
     Supabase (ticket data queried live), not just get generated into a workbook on
     demand — so this piece naturally lands in the backend-wiring phase (already answered
     as "after the four sheets" in Q3), same as the rest of the real data wiring.

**Update to the earlier flag:** the "Storage: Local + OneDrive" copy and the "Excel
output cell maps ... on OneDrive" footnote in the current zip's System / Users & Customers
tabs are still stale relative to this — they should get rewritten to reflect
download-first + optional linked-drive + Supabase-backed admin preview, not "OneDrive" as
a given. Still a deliberate fix for the edit phase, not urgent, but now has a concrete
target to fix *to* instead of just a contradiction to flag.

---

## Session checkpoint — real Service Ticket/Job Log template saved durably in the repo

`Autofill_ServiceTikcet_System.xlsx` (the real, filled workbook with the four sheets —
`Service Ticket (Original/Copy)`, `Job Log (Original/Copy)` — used to build
`CELL_MAPPING.md`) is now committed at `reference/Autofill_ServiceTikcet_System.xlsx` so
it survives regardless of upload-folder/session lifetime. Verified byte-identical
purpose: same four sheets present, plus the six price-list sheets (WAHA 1/2, AGOCO, HOO,
SOC, Zueitina) which are intentionally ignored here — that data already lives in
Supabase `price_list_items` (2,274 rows, verified).

**When Part B (the four sheets generator) is actually built:** use this file directly as
the fill target (per the earlier answer — "use the real Autofill_ServiceTikcet_System
exact format, don't invent a new file"). Don't re-request it from the user; it's here.

---

## Session checkpoint — baseline capture complete

Captured the last two missing screens: Technician **New Job Ticket** (arrival stamp,
technician name, customer/field/well/rig fields, "Start Logging" disabled until filled)
and **Job Log** (header card, job events list, add-line input, "Log Line — stamps
[time]", "Job Done" button). Both also show the plain-text "‹ Cancel" / "‹ All tickets"
back links — same button-visibility fix already flagged applies here too, not just the
Ops Manager screens.

**Baseline is now fully captured, all 11 screens:**
1. Technician — ticket list (default)
2. Ops Manager — inbox
3. Admin — Price Lists (default)
4. Founder — report
5. Ops Manager — Ticket View (Awaiting Review state)
6. Ops Manager — Ticket View (Approved state)
7. Admin — Numbering & Job Types (verified correct, no change needed)
8. Admin — Users & Customers
9. Admin — System (OneDrive copy flagged for fix)
10. Technician — New Job Ticket
11. Technician — Job Log

Nothing left uncaptured before starting the first real edit pass. Given the token
situation this session, the next session/turn should start directly with the first
screenshot-gated edit — no more baseline work needed first.

---

## Session checkpoint — Founder→"Observer" rename, live event visibility, online/offline badge, second-page overflow handling

**Rename:** Founder role/view is renamed **"Observer"** everywhere (nav tab, section
title, role label). Same read-only nature as before — this is a naming change only.

**Live event visibility (Observer + Ops Manager):**
- If a technician is online while a job ticket is open/logging, **Observers can see
  their events logging live**, in real time, as lines get added.
- **Ops Manager also gets this same live-view access** (Observer page/reports), not just
  the existing Review dashboard — so an Ops Manager can inspect live event logging for
  any technician with an active, connected ticket too.
- If a ticket was done **fully offline** (technician never connected while working it),
  it does **not** appear live to Observers/Ops Manager at all. It only shows up on the
  **Ops Manager's Review dashboard** once synced, for approval — and only lands in the
  **Observer reporting options** after approval (or when specifically requested/queried
  there). No live visibility for fully-offline tickets, ever.

**Online/offline status badge (per in-progress ticket):**
- Technician opens ticket + logs first line while online, then loses connection → ticket
  shows **"In Progress (Offline)"** until next sync.
- Reconnects and syncs → flips to **"In Progress (Online)"**.
- Style: **minimalist, small, but flashy** — reuse/extend the existing `.pulse-dot`
  pattern already in the design system's CSS (small animated dot) rather than inventing a
  new visual language.

**Auto-sync rule:** don't rely only on the technician manually pressing Sync to update
the Observer/Ops-Manager live view. The app should **auto-sync in the background on a
time-limit** (periodic, debounced) while a ticket is being actively logged and the device
has connectivity — specifically to keep live observation current — while still avoiding
sync-spamming the server. Manual Sync button stays as-is for the technician's own offline
queue; this is an additional background behavior, not a replacement.

**Four-sheets generation — overflow / second-page handling (confirmed with the user,
verbatim understanding accepted):**
- Row caps on the real template: Service Ticket items fillable region ends at **row 39**;
  Job Log events fillable region ends at **row 44** (consistent with the earlier
  row-16–39 / row-20-plus-~25-lines notes — same limits, just now given as exact last
  rows).
- At generation time, if placing a ticket's items (Service Ticket) or job-log events (Job
  Log) would exceed that row, **pop up a choice to the Ops Manager** — never silent,
  never automatic:
  1. **Add a second page** — same layout, stapled/paired with the first page, continuing
     the overflow, submitted to finance as one attached set.
  2. **Manually tick items/events on/off one-by-one** until the selected subset fits
     within the single-page row limit, and generate just that one valid page.
- Applies generally to any overflowing ticket, but the realistic/likely case flagged is
  **Fishing (F-prefix) job types** (e.g. F700/F701/F702), which occasionally run long
  jobs producing longer item lists or job logs.
- The underlying ticket data in Supabase is never trimmed by choice (b) — only what gets
  printed/downloaded onto that specific generated document is affected.

This is Part B (four-sheets) + new "Observer" feature scope — still queued behind the
prototype's visual/behavioural layer per the existing backend-timing answer (Q3: after
the four sheets... wait, four sheets ARE Part B — sequencing stays: visual layer signed
off first, then Part B/four-sheets + Observer live-view work, then final backend wiring
for auth/roles). Nothing built yet, decisions recorded for when we get there.

---

## Session checkpoint — renamed: branch, Vercel project, Supabase project

User renamed all three for consistent naming:
- **Branch**: `claude/job-log-timestamps-locked-8m5mz0` → **`claude/makaman-app`**
  (renamed on GitHub directly; local checkout switched and tracking updated). This is now
  the working branch for all future commits/pushes in this repo.
- **Vercel project**: `makaman-job-ticket` → `makaman-app`.
- **Supabase project**: `makaman-job-tickets` → `makaman-app` (display name only —
  project ref `igutjfezxkdncrcpvnqx` and API URL unchanged).
- **GitHub repo itself** did NOT change name — still `Zin-sudo/makaman-app`. Only the
  branch was renamed.

**Verified no further action needed:**
- No open PRs existed, so nothing to redirect there.
- Supabase requires zero config changes anywhere — ref/URL are immutable, unrelated to
  display name.
- Vercel's OIDC-claims rename warning is boilerplate that fires on every rename; doesn't
  apply here since this project uses a plain Supabase URL + anon key, not OIDC
  federation.
- Vercel env vars (`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`) should be unaffected
  since the Supabase URL didn't change — **not yet verified live** (Vercel MCP connector
  was disconnected in this session when this was checked) — worth a quick manual glance
  in Vercel → Settings → Environment Variables to confirm, or re-verify via tools next
  session once the connector's back.
- Vercel's own default deployment URL DID change (was `makaman-job-tickets.vercel.app`,
  now presumably `makaman-app.vercel.app` or similar) — re-test the live app at the new
  URL, the old bookmark won't resolve.

---

## Session checkpoint — Vercel↔Supabase association verified correct (manual check)

User manually checked Vercel's env vars post-rename and confirmed:
- `VITE_SUPABASE_URL` = `https://igutjfezxkdncrcpvnqx.supabase.co`
- `VITE_SUPABASE_ANON_KEY` decoded payload: `{iss: supabase, ref: igutjfezxkdncrcpvnqx,
  role: anon, ...}`

Both match the project ref exactly, confirming the rename to `makaman-app` didn't affect
either value (as expected — they're keyed off the immutable ref, not the display name).
**No action needed on Vercel or Supabase — the connection is correct as-is.** Rename
follow-up (branch/Vercel/Supabase naming + cross-service check) is now fully closed out.

---

## Session checkpoint — connections check (GitHub / Supabase / Vercel)

- **GitHub**: connected, working. `get_me` succeeded.
- **Supabase**: connected, working. `list_projects` succeeded — confirmed project
  **`Makaman-app`** (`igutjfezxkdncrcpvnqx`), `ACTIVE_HEALTHY`. Rename is live on the API
  side, not just the dashboard.
- **Vercel**: connection itself works (no auth error), but `list_projects` returned
  empty and `get_project("makaman-app")` returned 404, despite the project genuinely
  existing (user just renamed it via their own dashboard). **Same read-visibility bug
  already documented earlier this session** — Vercel's connection accepts calls but its
  list/get responses are unreliable in this session. Treat the user's own Vercel
  dashboard as ground truth, not these tools, until this clears up.

---

## Session checkpoint — Supabase agent-skills installed; new Vercel deployment (unverifiable from tools again)

**Supabase agent-skills installed** via `npx skills add supabase/agent-skills` — two
skills added: `supabase` and `supabase-postgres-best-practices`, at
`.agents/skills/*` (symlinked from `.claude/skills/*`), committed to the repo so they're
available in future sessions too. Load `supabase-postgres-best-practices` before any
schema/migration/RLS work in Part B or the backend-wiring phase.

**New Vercel deployment reported by user** (post project-rename), two URLs:
- `https://makaman-6q85nzsz4-midolateri-2760s-projects.vercel.app/`
- `https://makaman-app-git-claude-makaman-app-midolateri-2760s-projects.vercel.app/`
  (git-branch preview URL, tracking `claude/makaman-app`)
- Referenced commit: `0234adb` (the connections-check checkpoint).

**Could not verify from tools — same persistent bug as before, not new:**
`mcp__Vercel__list_projects` returns empty, `get_deployment` 404s, and both
`web_fetch_vercel_url` and general `WebFetch` fail (egress-blocked / can't create
shareable URL) for these exact hosts. This matches the earlier-documented Vercel
read-visibility bug — last time this happened, the deployment was actually fine and the
tools were wrong, confirmed by the user's own dashboard. Treat that as the likely case
again unless the user reports otherwise. **Not yet confirmed working by the user as of
this checkpoint** — ask/verify next time before assuming.

---

## Session checkpoint — new Vercel deployment confirmed working by user

User confirmed both URLs from the previous checkpoint load correctly:
- `https://makaman-6q85nzsz4-midolateri-2760s-projects.vercel.app/`
- `https://makaman-app-git-claude-makaman-app-midolateri-2760s-projects.vercel.app/`

Same pattern as the earlier Vercel incident: tools reported not-found/empty while the
deployment was genuinely live. Confirmed once again — trust the user's direct check over
these tools for Vercel state in this session.

---

## Session checkpoint — Part B/prototype edits #1-4 complete (Q2 items underway)

Working directly in `prototype/Job Ticket System.dc.html` now, per the "keep going, show
previews, I'll stop you when necessary" instruction — no more per-step approval gating,
but still small commits + screenshots for every change.

1. **Founder → Observer rename** — nav tab, heading, dialog copy, Users table role tag.
2. **Back-navigation as visible buttons** — new `.back-btn` class, applied to all 4
   plain-text back links across Technician/Ops screens.
3. **Settings screen** (Q2 item 5) — gear icon in nav opens a full-screen overlay:
   Appearance (theme+accent, stored but not yet live-applied — flagged honestly in-UI),
   Date & time (timezone + 24h/12h — **genuinely functional**, refactored `fdate/fshort/
   ftime/fstamp` to a `fmt()` helper reading `data.settings`, threaded through every call
   site), Technician-only share-location toggle (stored, capture-wiring is a follow-up),
   red Logout button (honest placeholder dialog since real auth doesn't exist yet).
   **Bug found+fixed during this step**: inline ternaries inside `{{ }}` template
   bindings aren't supported by this dc-runtime — confirmed by grep, every other
   conditional style in the file is precomputed in JS. Don't reintroduce this pattern.
4. **Real Makaman logo** (Q2 item 8) — extracted from the real uploaded PNG (already had
   a transparent alpha channel), trimmed to two crops: full lockup + icon-only mark, saved
   to `prototype/uploads/makaman-logo-{full,mark}.png`. Icon mark in top nav, full lockup
   (medium) on Settings. "Large on Login/Signup" pending that screen's existence.

**Remaining Q1/Q2 items still to build:** real Login/Signup + approval flow (item 6, the
big structural one — replaces the demo role-switcher), role management/create-technician
(item 7), line-level job-log timestamp editing + audit (Q1), B13/F14 admin defaults (Q1),
surcharge/discount as price-list items (Q1), item search + behavioral suggestions for Ops
Manager, in-progress online/offline badge, Observer/Ops live-event-view, auto-sync timer.

All 4 edits committed and pushed individually to `claude/makaman-app`. Server-serving
note for future screenshot passes: `python3 -m http.server 8000` from `prototype/` dies
between tool calls in this sandbox — always re-check with curl before assuming it's up,
and prefer `setsid nohup ... < /dev/null &` over plain `&` + `disown`, don't `pkill` in
the same command block as starting a new one (causes exit 144 with nothing captured).

---

## Session checkpoint — prototype edit #5 complete: real Login/Signup + approval flow

Q2 item 6 done — full auth flow replacing the demo role-switcher, verified end-to-end
(signup → pending → admin approves → new technician logs in correctly). Details in the
commit message (`a4fc276`). Session persists across reloads via a separate localStorage
key. Admin's Users & Customers table now has a working Approve action for pending
signups.

**Flagged, not fixed (pre-existing, not introduced by this edit):** Technician screen's
ticket list filters by hardcoded name `'Yousef Al-Harbi'` instead of the logged-in
session's name — a technician other than Yousef currently sees his demo tickets. Worth
fixing alongside role management (item 7), next up.

**Remaining Q1/Q2 items:** role management (item 7 — Admin promote to Admin/Ops Manager,
Ops Manager also create-technician directly; Ops Manager currently has NO Users/Team
panel at all in this zip, only Admin does), line-level job-log timestamp editing + audit
(Q1), B13/F14 admin defaults (Q1), surcharge/discount as price-list items (Q1), item
search + behavioral suggestions for Ops Manager, in-progress online/offline badge,
Observer/Ops live-event-view, auto-sync timer, plus the hardcoded-technician-name fix
noted above.

---

## Session checkpoint — all Q2 app-feature items complete (edits #1-6)

All four Q2 items now built and verified in `prototype/Job Ticket System.dc.html`:
Settings screen, real Login/Signup+approval, role management (Ops Manager Team screen +
Admin promote dropdown), real Makaman logo. Plus the Observer rename and back-button
visibility fix from Q1/general polish. 6 commits total, most recent `01c6931`.

**Next up: Q1 business rules**, all still to build:
1. Line-level job-log timestamp editing (Ops/Admin) + audit trail
2. B13/F14 admin-configured permanent defaults (Base Location, Customer Rep.)
3. 20% desert/marine surcharge as a waivable price-list item
4. Discount as a discretionary price-list item
Plus: item search + behavioral suggestions for Ops Manager, in-progress online/offline
badge, Observer/Ops live-event-view, auto-sync timer — all still pending.

---

## Session checkpoint — prototype edits #7 and #8 complete (Q1 items 1 and 2)

**Edit #7 (`9c9e96c`)** — job-log line timestamps are no longer locked. Every job-log
line under "3 · Job log from the field" now has a `datetime-local` input (was a plain
div), editable by Ops Manager/Admin, same audit-trail pattern as everything else. Ticket-
level Arrival/Start job/End job (in the "Ticket header" box) got the same treatment —
previously read-only text, now editable inputs. This reverses the original handoff's
"stays locked" default per the user's explicit correction mid-session ("YES i mean those
from individual job-log line timestamps too").
Verified: typed a new value into a job-log line's timestamp AND into the ticket-level
Arrival field independently (had to be careful — DOM order puts job-log lines before the
ticket-header box, so naive `.first()`/`.nth()` selection across all 8 datetime-local
inputs on the page grabs the wrong one; counted all 8 and confirmed indices 0-4 are
job-log lines, 5-7 are Arrival/Start/End before touching anything). Both edits produced
correct audit-trail entries.

**Edit #8 (`751fb3a`)** — B13 (Base Location) / F14 (Customer Rep.) are now permanent,
admin-configured defaults instead of unset per-ticket text. Added `d.orgDefaults` to seed
data, a "Ticket Defaults" box on Admin's System tab to edit the org-wide values, and
pulled those defaults into every new ticket at draft time. Ops Manager/Admin can still
override either field per-ticket from the Ticket header box (third field-type alongside
the existing read-only and datetime-editable ones) — every override is audit-logged with
old value shown as `"(default)"` when never touched before.
Also folded in a fix for 5 stale "OneDrive" text references left over from an earlier,
since-superseded storage decision (System tab, mgrPrint screen, Admin footnote, seed
ticket audit entry, export dialog) — all now say "downloaded from the app" consistently.
Verified end-to-end: typed real values into both fields on the seeded Al-Dhafra Energy /
RW-98 ticket, confirmed they persisted, confirmed exact audit-trail wording matches the
`<label> changed by <name>: "<old>" -> "<new>"` pattern used elsewhere.

**Q1 remaining: items 3 and 4** — 20% desert/marine surcharge and discretionary discount
as selectable, waivable price-list items (kind: percent-of-subtotal, sign +/-, surcharge
carries a default-add-on-draft flag). This is the next item up. Also still pending: item
search + behavioral suggestions for Ops Manager, in-progress online/offline badge,
Observer/Ops live-event-view, auto-sync timer.

---

## Session checkpoint — prototype edit #9 complete: surcharge/discount as price-list items

**Edit #9 (`50437d7`)** — closes Q1 items 3 and 4, the last of the four business-rule
items. Surcharge (20% desert/marine, standard-but-waivable) and discount (discretionary,
variable, never defaulted) are now a new "percent of subtotal" kind of price-list item,
not hardcoded ticket-total math. Both live in every client's price list next to the flat
items (new `SPECIAL_ITEMS` constant, appended in `priceList(mult)`), so the Ops Manager
picks/removes them from the exact same "Add item from price list" dropdown and table as
any other line — no new markup was needed anywhere. `itemTotal()`/`ticketTotal()` now
branch on `kind: 'percent'`: the percentage (stored in `cost`) is applied to
`flatSubtotal(t)` — the subtotal of non-percent items only, so surcharge and discount
never compound on each other. The surcharge (only) carries `defaultAddOnDraft: true`,
read by `createTicket()` to pre-add it when a technician starts a new job; the Ops
Manager waives it with the existing per-line × remove button, same as waiving any item.
`money()` was fixed to format negative totals as `-$113.40` instead of `$-113.40`, now
that a discount line can drive a total negative.
Verified end-to-end: technician-created ticket auto-carries the surcharge line
(localStorage read-back); Ops Manager review screen — added a flat item ($1,134.00),
added the surcharge (correctly $226.80, 20% of the flat subtotal), added the discount and
typed 10% into it (correctly -$113.40, 10% of the *flat* subtotal, not the post-surcharge
figure — confirms no compounding), grand total $1,247.40 exactly right; removed
(waived) the surcharge row, total dropped to $1,020.60, exactly right.

**All four Q1 business-rule items and all four Q2 app-feature items are now complete**
(edits #1-9). Remaining from the original punch list: item search + behavioral
suggestions for the Ops Manager when picking price-list items, in-progress online/offline
badge on tickets, Observer/Ops-Manager live-event-view (real-time visibility into a
technician's logging while connected), auto-sync timer (background sync on a time limit
rather than only manual).

---

## Session checkpoint — prototype edit #10 complete: in-progress presence badge

**Edit #10 (`a532b49`)** — tickets still being logged in the field (status 'logging',
not yet Job Done) now show a small Online/Offline presence badge next to the existing
status chip, in three places: the technician's own ticket list, the Ops Manager Inbox
table, and the Ops Review screen header. All three read from the same new
`ticketView()` fields (`presenceShow`/`presenceDot`/`presenceLabel`).
Important simplification, noted in the code and worth carrying forward: this prototype
only ever modeled one shared device-connectivity flag (the header's Online/No-signal
toggle), not real per-technician live presence — so today every in-progress ticket
reflects that same single flag rather than that specific technician's actual device
state. A real backend would need per-session/per-device presence to make this fully
honest; flagged for whoever builds that.
Verified end-to-end: toggled the connectivity pill as Yousef, confirmed the badge flips
color/label live on his own ticket list; synced while online, switched to Omar (Ops
Manager), confirmed the still-in-progress ticket appears in the Inbox and its Review
screen both carrying the badge, while Approved/Awaiting-review tickets correctly show no
badge at all.

**Remaining from the original punch list**: item search + behavioral suggestions for the
Ops Manager when picking price-list items, Observer/Ops-Manager live-event-view
(real-time visibility into a technician's logging while connected — natural next step
after this edit, since the Inbox can now surface in-progress tickets), auto-sync timer
(background sync on a time limit rather than only manual).

---

## Session checkpoint — prototype edit #11 complete: auto-sync timer

**Edit #11 (`9acf67d`)** — sync is no longer manual-only. A second interval alongside the
existing 30s clock tick now calls `autoSync()` on a real-world-realistic once-a-minute
cadence (`AUTO_SYNC_INTERVAL_MS`, overridable via `window.__AUTO_SYNC_TEST_MS` for fast
test verification): if the device is online, someone's logged in, and there are
not-yet-synced tickets, they get marked synced automatically, same as the manual Sync
button but silent and audit-logged as "Auto-synced from field device (...)" instead of
"Uploaded from field device (...)" so the two paths stay distinguishable in the trail.
Manual Sync is untouched — still there as an "upload right now" option. Updated the
Field Device explainer copy and added a small "Last auto-synced ..." note once at least
one has happened.
Verified end-to-end with a shrunk test-only interval: seeded in-progress ticket (t3,
"not synced") correctly flips to synced with the right audit text once the device goes
online and the timer fires; pending-upload banner disappears; UI shows the new
last-auto-synced note.

**All four Q1 business-rule items, all four Q2 app-feature items, the in-progress
presence badge, and the auto-sync timer are now complete** (edits #1-11). Remaining from
the original punch list, not yet started: item search + behavioral suggestions for the
Ops Manager when picking price-list items, and Observer/Ops-Manager live-event-view
(real-time visibility into a technician's logging while connected).

---

## Session checkpoint — prototype edit #12 complete: item search + suggestions

**Edit #12 (`5ed03f4`)** — the "Add item from price list" dropdown in the Ops Review
Charged Items box now has a live search input above it (filters by code or description
substring) and a "Frequently added" quick-add chip row showing the top 3 items charged
most often on that customer's *other* tickets, excluding whatever's already on this one.
Clicking a chip adds the line directly, no dropdown needed. Both the dropdown's Add line
button and the chips now go through one shared `addItemByCode()` closure so the
percent-item/mileage-qty/log-line logic isn't duplicated.
Verified end-to-end: a client (Kuwait Oil Group) with one existing 4-item approved ticket
correctly suggested those items' codes as chips on a brand-new, item-empty ticket for the
same client; clicking a chip added it and it dropped off the chip row immediately;
searching "supervisor" correctly narrowed the dropdown to just the one matching item.

**Only one item remains from the original punch list, not yet started**:
Observer/Ops-Manager live-event-view — real-time visibility into a technician's job-log
entries while they're still logging (not yet synced/Job-Done). Edit #10's presence badge
and the fact that in-progress tickets now surface in the Ops Manager Inbox once synced
once (edit #10/#11) are the groundwork this would build on.

---

## Session checkpoint — prototype edit #13 complete: Observer live-event-view

**Edit #13 (`69475e9`)** — the last item on the punch list. New "Live activity" box on
the Observer screen lists every currently-in-progress (status 'logging', synced at least
once) ticket company-wide: customer, technician, location, most recent job-log line +
timestamp, log-line count, and the same online/offline presence badge from edit #10.
Empty state reads "Nothing in progress right now" rather than showing a blank box.
Gated on `synced` for the same reason the Ops Manager Inbox is — consistent visibility
rule, not extra access for Observer. Documented in-code that "real-time" here means
"re-renders on the app's existing 30s tick," not a real push feed — this prototype has
one shared local data store, not a multi-device backend, and the comment says so
explicitly for whoever builds the real thing.
Verified end-to-end: Observer view showed the correct empty state before anything
synced; after the technician went online and synced their in-progress ticket, the
Observer's Live Activity box picked it up with the real last-log-line text/timestamp,
line count, and presence badge, matching the technician's own screen.

**Every item on the original Q1/Q2 punch list, plus every follow-up item (presence
badge, auto-sync timer, item search/suggestions, live-event-view), is now complete —
13 edits total (`f3831d1` through `69475e9`), each verified end-to-end with Playwright
and committed/pushed individually to `claude/makaman-app`.**

Operating mode for this stretch of work, per explicit user instruction: make one
self-contained edit, verify with real interaction (not just a screenshot), commit+push
immediately with a detailed message, move to the next item without stopping for
approval — only stop if the user interjects.

---

## New plan items added by the user (2026-08-18, after the 13-edit checkpoint)

Two new requirements to add to the punch list, not yet started:

14. **Cross-device access for all roles.** Every role (Technician, Ops Manager, Admin,
    Observer) must be usable on phone, tablet, laptop, and desktop — someone may have to
    log in from an unfamiliar device, not just their usual one. Current state as of this
    note: the technician screen is hard-wrapped in a fixed-size (398px/806px) decorative
    "phone mockup" frame with a desktop-only "Field Device" explainer sidebar next to it
    — fine for a desktop design review, but it would overflow/break on an actual narrow
    phone viewport. The Ops Manager/Admin/Observer screens use fixed 2-column grids,
    4-column stat grids, and wide multi-column tables with no responsive fallback at all
    — no `@media` queries exist anywhere in the file yet. Login itself has no
    device/role coupling (any role can already reach the login screen from any device),
    so this is a CSS/layout responsiveness problem, not an access-control one. Also
    covers real PWA installability (manifest + service worker + icons) so the app can be
    added to a homescreen on any device, not just opened as a plain browser tab.
15. **Ops Manager cloud storage linking.** Add the option to link and upload exported
    sheets to OneDrive and Google Drive, in addition to local download. Note: this
    reverses/extends an earlier settled decision from before this session
    ("download from app, no cloud account needed" — the 5 stale OneDrive references
    fixed in edit #8 were removed *because* of that decision). The user has now
    explicitly asked for OneDrive + Google Drive + local as options, so that supersedes
    the earlier simplification. Since this is a static prototype with no backend, real
    OAuth linking to Microsoft/Google isn't achievable honestly without a real app
    registration + server-side token exchange — plan is to build the UI/UX (a
    Storage & Export panel with mocked connect/disconnect state per provider, matching
    the existing shareLocation-toggle pattern) and flag clearly in the commit message
    that the actual OAuth handshake is out of reach for a static file and needs a real
    backend to finish.

---

## Session checkpoint — prototype edit #14 complete: cross-device + PWA (item #14)

**Edit #14 (`20d46fe`)** — item #14 done. Added the first `@media` queries in the file
(none existed before): the technician "phone mockup" bezel now collapses into a real
full-width mobile page under 640px instead of overflowing an actual phone; the four
2-column detail grids collapse to 1 column and the two 4-column stat grids collapse to
2-then-1 column under 980px/640px; all 5 major tables scroll within their own box
instead of blowing out the page. New `manifest.webmanifest` + `sw.js` + generated app
icons (`prototype/uploads/icon-*.png`) give real PWA installability.
Two classic CSS gotchas hit and fixed along the way, both worth remembering for any
future layout work in this file: (1) `flex:none` (flex-shrink:0) holds a flex item at
its content width even after overriding `width` — the phone frame needed `flex` itself
overridden too, not just width; (2) grid items default to `min-width:auto`, which floors
a `1fr` track at its content's min-content size and silently defeats all shrinking —
fixed with a blanket `.mk-2col > * { min-width:0 }` rule.
Verified with an automated sweep: all 4 roles x 4 viewports (phone/tablet/laptop/desktop)
= 16 combinations, each checked for zero page-level horizontal overflow via
`document.documentElement.scrollWidth === clientWidth`. All 16 pass. The worst-case
screen (Ops Review) took 3 rounds of diagnosis to get fully clean at 375px — confirmed
with full-page screenshots showing a legible, fully editable single-column layout at
both phone and tablet width.

**User feedback + fix (`3bc9514`)**: the Admin tab bar's `overflow-x:auto` from edit #14
hid the "System" tab behind a scroll on narrow phones — flagged as not practical.
Standard clarified and applied: horizontal scroll is only for genuinely long/many-column
data lists (tables); a small fixed set of options (tabs, a dropdown+button row) must
always fit fully visible, shrinking margins/font-size per device instead. Fixed the tab
bar (now a 2x2 wrap grid under 640px, unchanged single row at tablet+) and cleaned up two
more cramped-but-technically-visible rows (Admin price-list top row, Ops print-screen
header) to wrap cleanly rather than 3-way-squeeze. Tables (Inbox, Team/People user lists,
price lists, Numbering series, Observer approved-jobs) intentionally kept scrollable —
those are the "long list" exception.

---

## Session checkpoint — prototype edit #15 complete: cloud storage linking (item #15)

**Edit #15 (`45f3d1d`)** — closes the last plan item. New Settings > "Storage & export"
section, Ops-Manager-only, with Connect/Disconnect for OneDrive and Google Drive
(matches the existing shareLocation-toggle role-gating pattern). Local download always
works with no account, unchanged. Once connected, the print/export screen shows
"Upload to OneDrive"/"Upload to Google Drive" buttons next to "Fill Excel & download" —
each writes an audit-trail entry and confirms with a dialog naming the linked account.
Admin's System tab "Storage" row is now dynamic (`Local device + OneDrive` etc.) instead
of a hardcoded string.
**Important, flagged in the code and here**: the OAuth connect flow is mocked — "Connect"
just stores the session's email and flips a flag, since a static-file prototype has
nowhere safe to hold a real Microsoft/Google app registration or do a server-side token
exchange. A real build needs a backend for the actual handshake; this is UI/UX only.
Verified end-to-end: Technician correctly doesn't see the section; Ops Manager connect/
disconnect both providers works and shows the right account; upload buttons appear only
once connected; upload produces the correct audit entry and confirmation dialog; Admin's
System tab correctly reflects the live connected state.

**Both user-requested plan items (#14 cross-device/PWA, #15 cloud storage linking) are
now complete**, on top of the original 13-edit punch list — 16 edits total
(`f3831d1` through `45f3d1d`). Also fixed, per user feedback mid-stream: the Admin tab
bar and two other rows were hiding options behind an unnecessary horizontal scroll on
narrow viewports (`3bc9514`) — small option sets now always fit visible, scroll is
reserved for genuinely long data tables.

---

## Session checkpoint — sheet preview now matches the real Excel template (`dbe860a`)

**User feedback**: the "Preview 4 sheets" screen was a from-scratch mockup layout, not
the real `reference/Autofill_ServiceTikcet_System.xlsx` template already saved in the
repo. Asked for the preview to reproduce that file's actual layout.

Inspected the real workbook cell-by-cell with openpyxl (values, merges, styles) to get
the exact field order/labels — confirmed along the way that the real template's
surcharge/discount rows and B13/F14 cell references match what edits #9/#8 already
built. **Tried LibreOffice headless rendering first** (would have given a pixel-exact
image preview) but `soffice --convert-to pdf` is non-functional in this sandbox — fails
on even a trivial txt file with "source file could not be loaded" / silent exit 81, not
a permissions/sandbox issue (ruled out explicitly). **If a working LibreOffice becomes
available in a future session, image-based rendering of the real sheets would be a
strictly more faithful upgrade over the HTML reconstruction below — worth revisiting.**

Rebuilt the preview as a faithful HTML/CSS reconstruction instead: same field labels,
grouping and order as the real sheets (Customer/Field Name/Well No+MKN Supervisor/Rig
Name+Start Job/Mileage+End Job/Base Location → job-type banner → Item no./Item
Description/Qty/Unit/Unit Cost/Total Cost table → "Total =" row for Service Ticket;
Customer+Date/Field+Job Type/Well No+Customer Rep./Job Supervisor+Rig Name → Start/End/
Arrived band → Date/Time/Pressure/Total/Details of the Job table for Job Log), a
prominent "TICKET NO:" box matching the real sheet's oversized number cell, and the
real two-tier signature block ("Customer or his agent"/"MAKAMAN LIBYA" then
"Representative Signature" x2). Two real-template fields have no data source in this
app yet and show "—": "MKN Supervisor" (mapped to the technician, closest existing
concept) and per-line Pressure/Total columns in the Job Log table.
Verified with a fully-populated ticket (Kuwait Oil Group/1882, $27,920.40) — matches
the source workbook's structure field-for-field; re-ran the 16-combination responsive
sweep, still 0 overflow.

Excel-fill/download logic itself and the app's business math were deliberately not
touched — this was scoped to the on-screen preview layout only.
