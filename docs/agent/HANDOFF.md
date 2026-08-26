# Makaman PWA — Living State & Next Task (HANDOFF.md)
> **Read `docs/agent/CLAUD.md` first. This file is second.**
> **Last updated:** 2026-08-26 — synced against the actual repo, branch `claude/makaman-app`.

---

## 0. HOW THIS FILE WAS WRONG, AND WHAT REPLACED IT

Until 2026-08-26 `docs/agent/HANDOFF.md` was a copy of the 86KB session log at the repo
root. That log describes `app/` as a **Vite/React** project with `theme.css`, `Users.jsx`,
`PrintPreview.jsx` and `src/lib/offlineQueue.js`. None of that exists. `app/` is a single
static dc-runtime `index.html`, and CONSTRAINTS §3 forbids rewriting it to React.

An agent following that log would have re-planned work that shipped weeks ago. The root
`HANDOFF.md` is kept as history; **this file is the living state**. Do not restore the old
one over it.

---

## 1. WHERE THE PROJECT ACTUALLY IS

`app/index.html` is **6,159 lines**, mirrored byte-identical to `app/Job Ticket System.dc.html`.
Twenty-six Playwright suites sit beside it. The backend is live on `igutjfezxkdncrcpvnqx`.

### 1.1 Shipped (verified in git, with the commit that did it)

| # | What | Commit |
|---|------|--------|
| A | Timezone selector removed — `OPERATING_TZ` is a constant (Africa/Tripoli, UTC+2). Accent swatches gone. 24h default; PDFs/ZIPs always 24h, the 12h toggle is screen-only. | `c2ab70b` |
| B | Top-bar coordinates on every tab; long-press copies them with a 2s "Coordinates Copied!" banner; coordinates print beside the Well No. at footnote size. | `dabbbc9` |
| C | Oilfield / well / rig capped at 10 characters (`LOCATION_MAX`, `clampLoc`). **Customer deliberately uncapped** — company names run long. | `a249882` |
| E | Admin/ops can force a ticket number on an in-progress ticket and approve on a technician's behalf, with a forced-action notice and Activity attribution. | `eb01f51` |
| F | Real tablet/laptop layout for technicians — the phone bezel is gone at every width, column held to 760px, nav pinned centred. | `eb01f51`, `d96b512` |
| G | The numbering claim moved out of individual tickets into its own Account-tab section, transferable by handover or by an Admin override. | `d96b512` |
| H | Tools/crossover allocation is its own container, between the job-type-objective and ticket-header containers. | `d96b512` |
| — | Price lists re-imported: **2,610 rows** generated, **2,600 live** (336 recovered). `unit_cost` nullable. | `3876667`, `9b1e785` |
| — | Signup approval routed through the `admin-actions` Edge Function; outbox no longer jams on a refused write. | *this session* |
| P1.8 | **Permission registry** — `permissions` + `user_permissions`, `has_permission()` / `my_permissions()`, `hasPermission()` in the app, and an admin Permissions page in Account. 31 capabilities, per-person grant *and* revoke. | *this session* |

Earlier landed work, for orientation: real Supabase auth (`d3690ae`), the app on Supabase
(`c2ab70b`), per-ticket ZIP + monthly overview exports (`2fc71f8`), currency-aware decimals
(`fc57078`), DB-side item-code normalisation (`3974cb7`).

### 1.2 Test suites in `app/` (none of these were recorded anywhere before today)

`approval` (new), `assets`, `audit`, `auth`, `claim`, `clock`, `cloud`, `coalesce`, `coop`,
`currency`, `export`, `forced`, `geo`, `layout`, `lengthcap`, `numbering`, `observer`,
`office`, `office2`, `roles`, `search`, `sync`, `tabs`, `techreport`, `toast`, `wellgeo`.

`clock`, `wellgeo`, `lengthcap` and `forced` are the suites that pin items A, B, C and E.

**How to run one:**
```bash
cd app && python3 -m http.server 8934 &
npm install playwright-core --no-save          # from the repo root; not vendored
NODE_PATH=../node_modules node forced.test.js
```
They drive `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Budget ~60–120s each;
run them in small batches or a 7-suite batch will exceed a 2-minute tool timeout.

### 1.3 Still open

| Item | Notes |
|------|-------|
| **App-design polish** | Card UI, sticky blurred headers, iOS toggles, empty states. **User asked for mockups to approve before any code.** A candidate stylesheet is in the repo — see §5. |
| **"Apper" skill** | After the Excel automation. |
| **Q1 rewording** | To "Tools Allocated Reclaimed or Back-to-Base?" — deferred until the backend is finished; DB (migration 0009) and app differ by one word today. |
| **Offline/online stress test** | Two devices taking one series number, ops edits during an offline log, etc. |
| **Migration 0002** | Applied to the DB but missing from `supabase/migrations/`. Do not rebuild the schema from files alone. |

---

## 2. THIS SESSION — SIGNUP APPROVAL

### 2.1 The symptom
An admin approves a pending sign-up. The row shows active. The person still cannot log in,
and the account reverts to pending.

### 2.2 The cause, confirmed against the live database
```sql
select policyname, cmd from pg_policies where tablename='profiles';
-- profiles_select_own   SELECT
-- profiles_select_staff SELECT
```
RLS is on and **only SELECT policies exist** — no INSERT, UPDATE or DELETE for any
signed-in client. The approval was a local `mutate()`, which `diffOps()` turned into a
`profiles` upsert on the generic outbox. Postgres refused it every time.

Two consequences, and the second is the worse one:
1. `refresh()` runs `hydrate()` after the drain and adopts the database's version, so the
   old `pending` row came straight back.
2. `outboxDrain()` stopped at the first failure to preserve ordering — correct for a lost
   connection, fatal for a refusal that will never succeed. The rejected profile row sat at
   the head of the queue and **blocked every later write on that device indefinitely**.

### 2.3 The fix
- `adminAction(action, payload)` invokes the `admin-actions` Edge Function, which already
  implemented `approve_signup`, `promote_role` and `create_technician`, each re-deriving the
  caller from their own JWT. The app had simply never called it.
- Approve, promote and create-account now go through it in cloud mode and only touch the
  replica once the server has said yes and `refresh()` has read the new row back. The demo
  store keeps its local path — `authMode: 'local'` is what the behaviour suites run on.
- **`profiles` is removed from the `diffOps` pair list.** A profile row can no longer enter
  the outbox at all.
- `outboxDrain()` now counts attempts. An op still holds its place while a retry is
  plausible, but after `OUTBOX_TRIES` (5) it is set aside into `makaman.outbox.refused.v1`
  and the queue moves on. The change itself stays in the replica; only the attempt to send
  it is abandoned, and the refusal is kept rather than dropped silently.

**No RLS policy was added to `profiles`** — CONSTRAINTS §4 forbids it, and it would let any
signed-in staff member promote themselves to Admin.

### 2.4 Deliberate loose end
Deleting a user is the same class of privileged write and `admin-actions` has no action for
it. Rather than remove the row locally and have `refresh()` put it back, the confirm dialog
now says so plainly in cloud mode. Wiring a `delete_user` action is listed in §1.3.

### 2.5 Verification
`app/approval.test.js` — 12 assertions, all passing. It proves `profiles` is absent from the
outbox pair list, that all three handlers reach the Edge Function, and — by driving the real
`outboxDrain` against a client that refuses every `profiles` write — that a permanently
refused op no longer blocks the write behind it, that the queue drains empty, and that the
refusal is recorded.

Re-ran for regressions: `roles` 11, `sync` 18, `numbering` 18, `layout` 13, `claim` 23,
`forced` 19, `lengthcap` 14 — **116 assertions, 0 failures**.

---

## 2b. THIS SESSION — P1.8, THE PERMISSION REGISTRY

### What was built
- **`public.permissions`** — `permission_id`, `permission_name`, `permission_level`,
  plus `category`, `description`, `default_roles`. 31 capabilities, seeded in migration
  0014 **from the role gates that already exist in `index.html`**, so the registry
  describes the app rather than proposing a second answer.
- **`public.user_permissions`** — per-person `granted` boolean. Revoking matters as much
  as granting: keeping one ops manager out of the price list needs a row saying `false`,
  not the absence of a row.
- **`has_permission(uuid, text)`**, **`effective_permissions(uuid)`**, **`my_permissions()`**.
  All read the role from `profiles`, never from the JWT (B-7.2).
- **`hasPermission(key)`** in the app — reads the hydrated map, falls back to
  `PERMISSION_DEFAULTS` when there is none, and returns **false** for an unknown key.
- **Admin → Account → Permissions**: one person at a time, capabilities grouped by
  category, each row showing its key and saying which way an exception runs.

### `permission_level` is severity, not rank
1 routine field work, 2 supervisory, 3 administrative. It orders the screen and says how
alarming a grant is. It does **not** mean level 3 contains level 2 — Observer is broad
read access with almost no writes and fits no ranking, which is why the default set is an
explicit list of roles rather than a number to compare.

### Security, and what the linter caught
`has_permission` and `effective_permissions` take somebody else's id and run as definer,
and were reachable at `/rest/v1/rpc` **without signing in** — making "what may this person
do" a public question. Migration 0015 revokes `anon`, and both now refuse unless you are
that person or you are staff. `my_permissions()` takes no argument at all, which is what
the app calls.

`user_permissions` *is* client-writable, under an admin-only RLS policy — unlike
`profiles`. The distinction is deliberate: the policy calls `is_admin()`, which looks the
role up in `profiles`, and the worst an Admin can do there is what an Admin may already do.

### The gap to close next
The registry is read by the Permissions screen and by `hasPermission()`. **The other
twenty-eight role comparisons in `index.html` still test `S.role === 'x'` directly.** They
agree with the registry today because the defaults were seeded from them — but until they
call `hasPermission()`, granting someone an exception changes what the screen says and not
what the app does. That conversion is the substantial follow-up.

### Verification
`app/permissions.test.js` — 23 assertions: the catalogue's shape, the screen rendering,
a grant writing exactly one exception, and a toggle back to the role's own answer
**deleting** the row rather than storing a redundant one. Against the live database:
admin 31 granted / technician 6, an override winning in both directions, `source` reporting
`override`, and the unauthenticated guard refusing. Database left with zero overrides.

Regressions: `roles` 11, `approval` 12, `layout` 13, `tabs` 11, `claim` 23, `observer` 18,
`audit` 9 — 97 assertions, 0 failures. No overflow at 1280px or 430px.

---

## 2c. THIS SESSION — P1.8b, THE GATES ACTUALLY READ THE REGISTRY

**Eleven capability gates converted; eighteen role comparisons deliberately kept.**

### The line between the two
A role comparison that decides **what someone may do** became `hasPermission()`. One that
decides **how the app is presented to them** stayed a role comparison, because it is not a
capability and a permission toggle must never be able to break navigation.

Converted: activity depth, who may put a number on a ticket, whose approved jobs a report
covers, ticket read-only-ness, the numbering claim panel / transfer / override, promoting a
user, deleting a user.

Kept, on purpose: which page a role lands on (`showMgrPage`, `showAdminPage`,
`showFounderPage`), whether the desk nav or the phone frame is used (`deskTabs`,
`showDeskNav`), the identity flags (`isTech`/`isMgr`/`isAdmin`/`isFounder`), which toolbox
Account offers, screen titles and labels, the technician's own geolocation loop, and the
Observer's tool-custody detail. **Do not "finish the job" by converting these** — routing
gated on a permission is a blank screen waiting to happen.

### `readOnly` is not `ticket.edit_closed`
The `locked` flag it feeds governs the technician's own job-log editing as well as the ops
review. Gating it on `ticket.edit_closed` alone would have locked technicians out of their
own logs. It is now "holds no ticket-writing capability at all" —
`!hasPermission('ticket.log') && !hasPermission('ticket.edit_closed')` — which is false for
a technician, false for the office, and true only for the Observer.

### The conversion found a defect in the seed
Zero behaviour change was the expected result, so the four observer failures were
informative rather than annoying. `activity.view_all` had been seeded to include `founder`
and used for the *edit* trail as well as for seeing every ticket — two capabilities under
one name. The Observer reads the work, not the edit history or the tool-custody answers.
Migration 0016 adds **`activity.view_edits`** (ops/admin only) and the gates now use it.

This is the argument for doing the conversion at all: a registry seeded from role
comparisons inherits their imprecision, and only pointing real gates at it exposes where.

### Verification
195 assertions across 12 suites, 0 failures: `roles` 11, `permissions` 25, `approval` 12,
`claim` 23, `observer` 18, `office` 15, `office2` 12, `forced` 19, `techreport` 13,
`audit` 9, `sync` 18, `layout` 13, `tabs` 11, `numbering` 18.

The permissions suite no longer asserts a capability count — a magic number that goes stale
on every addition. It asserts the invariant instead: two capabilities that differ for any
one role must be two keys.

---

## 2d. THIS SESSION — THE ROLE-SWAP CONTROL

`user.act_as_technician` (migration 0017, ops/admin). The control sits beside the name in
the top bar, because what it changes is who the app thinks you are working as and that
belongs in the same glance that tells you who you are.

### Three properties carry it
1. **The swap narrows.** While acting, `hasPermission()` resolves against the acted role's
   defaults and ignores the hydrated map — that map belongs to the real person. An ops
   manager who could still approve while "working as a technician" would be an ops manager
   with a different layout, which tells you nothing about what the field experiences. Not
   a specific technician's exceptions either: this is working as *a* technician, not
   impersonating one.
2. **The way back is never gated.** Acting as a technician drops `user.act_as_technician`
   along with everything else, so a permission check on the swap-back control would be a
   door that locks from the inside. `showSwapOut` is keyed on `S.actingAs`, nothing else.
3. **Attribution never moves.** `session.name` is untouched, so every audit entry, holder
   and crew name stays the real person's. Nothing about the swap is written to `profiles`.

### Decisions worth keeping
- **It survives a reload.** The swap lives on the session. A refresh mid-job must not
  quietly hand the office's powers back; undoing it is as deliberate as making it. A fresh
  login always clears it.
- **The corner never reads plainly "Technician".** It reads `As Technician · Ops Manager`.
  An invisible swap is how somebody forgets they are in one and wonders where their
  approve button went.
- **`activeTechnicians()`** is now the single answer to "who counts as a technician right
  now" — four call sites (assignment, co-op, handover, field devices) that previously
  repeated the same filter.
- **`CORNER_ROLE`** was added because the top bar had always shortened "Operations
  Manager" to "Ops Manager" while `ROLE_LABEL` spelled it out; the swap made one control
  show both. Two deliberate readings, one map each.

### Known limit, stated rather than assumed
The swap is **per device**. It lives in the session, not in `profiles`, so an ops manager
swapped in on their own phone still reads as an Ops Manager to everyone else. Making it
visible org-wide would mean a privileged profile write on every swap — a much larger
promise than this feature needs. If the office wants to see who is currently in the field,
that is a separate decision.

### Verification
`app/swap.test.js` — 22 assertions: who is offered the swap (admin and ops yes; technician
and observer no), the office inbox disappearing, approving no longer offered, survival
across a reload, the way back working, and the source-level properties above.
Regressions: 217 assertions across 13 suites, 0 failures. No overflow at 1280px or 390px.

---

## 2e. THIS SESSION — THE PER-TICKET LOG IN REVIEW

The container already existed. Three things were wrong with it, and the first is why this
was worth doing before anything cosmetic.

**It was ungated, and the Observer reaches this screen.** `showMgrPage` admits `founder`
at `mgrScreen === 'review'`, so the full edit history of every ticket was readable by the
one role the Activity tab had just been taught to withhold it from. Fixing the feed did
nothing for this — the same capability, a second place, and no reason for either to know
about the other. `curAuditDeep` is now named once and read by the rows, the empty state and
the scope line together, so they cannot drift into disagreeing.

**It dropped who.** Every entry has carried `by` since `logOn()` was written; only the
Activity tab was showing it. "Ticket approved" with no name is the half of the record that
does not settle an argument — and attribution is exactly what the forced-action and
role-swap work depends on.

**It said nothing about what kind of change an entry was.** Stage and Edit now carry a
badge, matching the Activity tab's own distinction.

### Verification
`app/reviewlog.test.js` — 15 assertions. The load-bearing one is that the Observer sees the
stage entry and **not** the edit, on the same ticket where the office sees both.

Two harness traps cost real time here and are worth carrying forward:
- **The store is not written until the first mutation.** Seeding through `localStorage`
  before one happens writes into nothing. `window.__mkApp` is the handle the other suites
  already use; `app.mutate()` then `app.setState({ activeId, mgrScreen: 'review' })`.
- **The page says "written to the audit trail" in prose further up.** A body-text search
  for the heading finds that first and reads the ticket header as though it were the log.
  Locate the panel by its DOM node.

And a mistake worth naming: the first run of this suite reported **the leak as fixed while
nothing had rendered at all** — a negative assertion passing on a blank page. Every "is not
shown" check here is now conditional on the panel actually being present.

Regressions: 146 assertions across 9 suites, 0 failures.

---

## 2f. ADMIN/OPS IN THE FIELD — SETTLED, AND VERIFIED END TO END

**The user confirmed the swap is the intended design**: ops and admin swap into the
technician state and back; technicians cannot swap unless their own role is ops or admin.
They also offered to drop the swap and simply grant technician abilities to the office if
that were lighter. It is not, and the measurement is worth keeping:

Ops and admin **already hold** `ticket.create`, `ticket.log`, `ticket.close` and
`ticket.sync` by default — capabilities were never the obstacle. What they lack without a
swap is the technician's *screens*; `showMgrPage` routes them to the office inbox. The
no-swap route would therefore still need a second path into those screens — a parallel
office-side "raise a job" flow duplicating what exists. The swap reuses the technician
screens whole, for ~90 lines and one state field.

**Verified by driving the real form**, not by calling into state: a swapped ops manager
raises a job and the ticket carries `tech`, `holder` and `crew` all set to **their own
name**, status `logging`, on the technician's log screen, with what they typed on it.

### A defect this found
The opening audit entry — the one entry every ticket is guaranteed to have — was written
inline at creation rather than through `logOn()`, which is the only place that stamps a
name. **Every ticket ever created had an unattributed first entry.** Invisible until §2e
started showing names, and worst exactly where it matters most: opening a job is the act
you most want attributed when the office is in the field. Now carries `by` and `kind`.

---

## 3. NEXT TASK — see §6 for the sequencing decision

Remaining functional work: the **approved-ticket → master Excel** automation (the user asked to be questioned in
detail first), and **Arabic / RTL**, still marked 🔴 critical for the market.

**Do RTL before the design pass** — see §6.

The gate conversion is done (§2c). When adding a capability gate, call
`hasPermission(key)`; when deciding presentation, a role comparison is still right.

### If blocked
Stop and log it here rather than guessing:
- Ten Waha price-list conflicts are parked in `backup.price_list_conflicts_20260820`. They
  need real item numbers from the user. **Never invent codes, average prices, or drop rows.**
- Supabase "leaked password protection" is still OFF and the seeded Admin password appeared
  in a chat transcript. Both need the user at the dashboard.

---

## 4. STANDING REMINDERS

- Push to **`claude/makaman-app`** only.
- Supabase project **`igutjfezxkdncrcpvnqx`**. Never touch `vaawlkmbhdbevkylclkf`
  (`makaman-libya`, the company website).
- After every edit to `app/index.html`: `cp` to `app/Job Ticket System.dc.html`, `cmp`, and
  `node --check` the extracted `<script type="text/x-dc">` block.
- No ternaries inside `{{ }}` — dc-runtime fails silently (BLINDSPOTS B-9.1).
- 110 price-list rows have `NULL unit_cost` and mean "quoted separately". They must never
  render as 0.00.


---

## 5. THE RESPONSIVE THEME (`reference/makaman-responsive-theme-v2.css`)

Supplied by the user 2026-08-26 and **stored, not wired in**. Nothing in `app/` imports
it. It is the design direction for the app-design-polish item, to be applied when that
task comes up — and that task still needs mockups approved first.

What it brings: a token set (`--mk-*`), card/button/input/table/badge components, a
five-breakpoint responsive system (640 / 1024 / 1440 / 1920 plus a mobile-landscape fix),
per-role container widths, iOS-style toggle switches, a permissions-page component set,
and print / reduced-motion / high-contrast blocks.

### Three things to settle before any of it is adopted

1. **It violates CONSTRAINTS §5 as written.** Line 7 is
   `@import url('https://fonts.googleapis.com/css2?family=Inter...')`. The rule is **no
   Google Fonts CDN, no CDN dependencies** — a technician at a wellhead has no network,
   and a webfont fetched over the wire is a font that never arrives. Vendor Inter into
   `app/vendor/` (or `app/uploads/fonts/`) and replace the `@import` with a local
   `@font-face` before this file goes anywhere near `app/`.

2. **Its permission vocabulary is not the registry's.** The stylesheet gates on
   `data-perm-create`, `data-perm-gps`, `data-perm-pricing`, `data-perm-approve`,
   `data-perm-discount` and about twenty more, scoped by `.role-technician` /
   `.role-ops` / `.role-observer`. The live registry (migrations 0013–0015) uses
   `ticket.create`, `ticket.approve`, `pricelist.view` and so on, and does not scope by
   role at all — the whole point is that a person's capabilities are not their role's.
   These are two different models of the same idea. **Reconcile before adopting**: either
   emit `data-perm-<key>` attributes from `hasPermission()` for the registry's keys, or
   drop the CSS gating and keep the gating in the bindings where it is today. Do not ship
   both vocabularies — that is exactly the drift B-15.2 warns about.
   Several of its permissions have no registry equivalent yet and would need seeding:
   GPS capture, attachments, price visibility to a technician, discount, surcharge
   removal, all-bases filter, audit visibility for the Observer.

3. **The colours are a different palette, not the current one.** `--mk-accent: #00d4aa`
   (teal) and `--mk-accent-2: #6366f1` (indigo) against `#0a0a0f`, versus the app's
   present `--accent` blue on `--ground`. Adopting the tokens means restyling every
   screen, not adding a layer — the app styles inline against `--ink-rgb`, `--accent`,
   `--success` etc. throughout. This is the "mockups first" part of the task.

Two smaller notes for whoever picks it up: `--mk-bg-tertiary` is referenced in the locked
toggle rules but never defined, and `--mk-border-focus` is used with a fallback in some
places and without one in others.


---

## 2g. WITHDRAWING ACCESS — AND WHY IT IS NOT A DELETE

The loose end from §2.4 is closed, but not the way it was written down. **The schema
refuses a delete, and it is right to.**

```
tickets.technician_id / holder_id / closed_by / approved_by   NO ACTION
audit_log.changed_by                                          NO ACTION
ticket_crew.profile_id                                        CASCADE
```
Postgres will not remove anybody who has ever touched a ticket — every real user. And
where a delete *would* go through, `ticket_crew` is CASCADE: it would silently erase who
was on a job, out of a trail CLAUD.md records as legally required.

The app's own dialog had been promising the correct behaviour all along — *"their name
stays on any tickets they already touched"* — while the button said Delete. So the
implementation follows the promise: **status becomes `disabled`, the row stays.**

- `set_user_status` on `admin-actions` (v2), Admin only. Re-checks **server-side** that
  you are not disabling the master Admin and not disabling yourself — the client hides
  those buttons, and hiding a button is not a permission check. Also ends any session the
  target already holds rather than letting their token run out.
- `user.delete` retired for **`user.disable`**. A key that promises what the database will
  not do is worse than no key.
- Disabled accounts stay in the Users list, labelled and dimmed, and drop out of
  `activeTechnicians()` so they cannot be assigned. Restoring is the same control.

### Two things this turned up
1. **Migration 0018's constraint did nothing.** `profiles_status_check` from 0001 already
   restricted the column to pending/active. Two CHECKs on one column both apply, so the
   stricter won and `disabled` was refused — the new constraint looked like it worked and
   did not. 0019 retires the original. *One column, one statement of what may go in it.*
2. **Seeded audit entries carried no `by`.** Harmless until §2e started showing names.
   Fixed — and while fixing it I nearly reclassified the numbering entry as an `edit`,
   which would have quietly dropped it out of the Observer's view. Every seeded `kind` now
   matches what `auditKind()` already inferred, so adding the field changed nobody's view
   of anything. Widening what is hidden is a product decision, not a tidy-up.

### Verification
`app/disable.test.js` — 18 assertions, including that the row is **kept**, the name stays
on their tickets and audit entries, they leave the assignment list, and it all reverses.
Against the live database: an unknown status is refused, disable and restore both work,
and the row was left as found. Regressions: 160 assertions across 8 suites, 0 failures.

---

## 2h. THE MASTER WORKBOOK

Four decisions were taken by the user before any code: **one row per approved ticket**,
**stored in Supabase Storage**, **never hand-edited**, **rebuilt server-side on approval**.
Every one of those makes the design safer, and the third is the load-bearing one — a file
nobody edits can be rebuilt from scratch, which makes the whole thing idempotent.

### The chain
`approval` → `public.master_export_rows` (view) → `master-export` (Edge Function) →
private `exports` bucket → signed link that expires in 60 seconds → Account tab.

- **The shape of a row is a view, not code.** Finance's definition of "one approved job"
  is a property of the data. Changing what they see is `create or replace view`, not a
  redeploy.
- **Rebuild, never append.** A reopened and re-approved ticket, a corrected price, a fixed
  customer name — all simply come out right next time. An append-only file carries every
  past mistake forever.
- **Currency is its own column and totals are never summed across it.** Sirte prices in
  dinar, everyone else in dollars; one blended Total would be meaningless and would still
  add up in a spreadsheet.
- **Scheduling is a watermark, not a trigger.** A trigger firing an HTTP call per approval
  means ten approvals start ten rebuilds racing to overwrite one object. Instead pg_cron
  asks every minute whether any approved ticket has changed since the last good build, and
  almost always does nothing. Same effect as "on approval" — nobody opens anything — with
  at most a minute's lag.
- **Failures are kept.** `export_runs` records every attempt; the Account tab shows the
  reason a file is stale rather than leaving the last success looking current.

### ✅ VERIFIED END TO END — the whole chain has now run
`200 · {"ok":true,"rows":0,"path":"master/makaman-approved-jobs.xlsx","by":"scheduler"}`,
a real **17,873-byte** `.xlsx` with the correct Excel MIME type in the bucket, and an
`export_runs` row reading `ok` in 0.27s. **SheetJS under Deno and the storage upload are
no longer assumptions.** `rows: 0` is correct — there are no approved tickets yet, and the
sheet still carries its headings.

**No credential is stored anywhere.** The vault is empty and nothing needs it.

### How the scheduler proves itself, and why it is not a key
The first design had pg_cron present the service-role key and the function compare it to
`SUPABASE_SERVICE_ROLE_KEY` by string equality. It failed with **401 Invalid session**,
and the reason is worth carrying: the platform fills that env var with the **legacy `eyJ…`
JWT**, while a project using Supabase's newer **`sb_secret_…`** format presents a different
string for the same authority. `===` cannot see they are the same, and nothing in the logs
explains it.

Chasing the matching spelling would have worked and been wrong twice over — a brittle
comparison, and a live credential parked in the database to keep in step with a format
Supabase is actively migrating. So the comparison is gone (migration 0023):

- `rebuild_master_export()` mints a row in `export_nonces` and sends it as `x-export-nonce`.
- The function looks it up, **deletes it whether or not it turns out to be fresh** (a
  leaked nonce is worth one attempt), then rejects anything older than two minutes.
- `export_nonces` has RLS on and **deliberately no policies** — the service role bypasses
  RLS, everyone else sees nothing. A nonce nobody can read is a nonce nobody can replay.
- Expired rows are swept on each run, so the table cannot grow without bound and no second
  scheduled job is needed to tidy it.

Nothing here breaks the next time a key format changes.

### Two findings from the advisor, one an ERROR
1. **`master_export_rows` was SECURITY DEFINER** — the Postgres default for views. Any
   signed-in technician querying it would have read every approved job's totals, straight
   past the RLS on `tickets`. Fixed with `security_invoker = on` (0022).
2. **`rebuild_master_export` was callable by `authenticated`** — functions in `public` are
   granted to it by default, and revoking from PUBLIC does not remove that. Revoked.

`pg_net` sits in the `public` schema and the linter says to move it. It does not support
`SET SCHEMA`, and dropping it would disturb the request queue for a warning about where a
name is registered. Left deliberately.

### And a drift the suites now guard
`export.master` went into the database and into a gate, but not into `PERMISSION_DEFAULTS`
— so `hasPermission()` answered false for everyone offline and in the demo store, and the
tile silently never rendered. `permissions.test.js` now asserts that **every capability the
app asks for is one the offline defaults know**.

### Verification
`app/excel.test.js` — 14 assertions. Regressions: 160 across 9 suites, 0 failures.

---

## 6. SEQUENCING: THE RESPONSIVE THEME vs RTL

Asked directly whether to adopt `reference/makaman-responsive-theme-v2.css` now or later.
**Later — and specifically after Arabic/RTL.**

The argument is the same one that made P1.8b precede the design pass, and it is about
double work rather than about taste:

- The theme is not a layer. The app styles inline against `--ink-rgb`, `--accent`,
  `--success` on essentially every element, so adopting `--mk-*` tokens means editing every
  screen. That is a rewrite of presentation, not an import.
- **RTL is also a whole-layout concern** — direction, mirroring, padding that becomes
  margin, text metrics — and MINDMAP still marks it 🔴 critical for a Libyan market.
- Restyle first and you restyle again for RTL. Do RTL first and the design pass lands once,
  on a layout that is already correct in both directions.
- The theme's three blockers (§5) are unresolved regardless: the Google Fonts `@import`
  breaks CONSTRAINTS §5, its `data-perm-*` vocabulary contradicts the permission registry,
  and the palette is a different one.
- The user asked for **mockups to approve before any code**, which is a round trip that
  should not be spent twice.

The counter-argument, stated fairly: every feature added now is one more screen to restyle
later. That cost is real but small — the remaining functional surface is a few screens,
whereas RTL touches all of them.

**Trigger for revisiting:** once RTL lands and the functional backlog above is closed. At
that point the design pass should *absorb* the theme — take its tokens, spacing scale,
breakpoints and component shapes — rather than adopt the file wholesale, because its
permission vocabulary must be dropped in favour of `hasPermission()`.
