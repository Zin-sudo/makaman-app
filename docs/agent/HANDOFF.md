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
| **Role-swap control** | Top-right control letting admin/ops act as Technician and swap back, appearing among technicians for assignment. |
| **Log-events container in Review** | Admin/ops need the event log surfaced inside the Review screen. |
| **Admin/ops unrestricted ticket access** | Full A–Z technician flow on tickets they opened, audit trail kept throughout. |
| **User deletion** | The Delete button now says plainly that deletion happens on the server (see §2.4). `admin-actions` has no `delete_user` action yet. |
| **App-design polish** | Card UI, sticky blurred headers, iOS toggles, empty states. **User asked for mockups to approve before any code.** A candidate stylesheet is in the repo — see §5. |
| **Approved-ticket → master Excel** | PWA → DB → script → shared master file, with a download button for admin/ops/observer. **User asked to be questioned in detail first.** |
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

## 3. NEXT TASK — the role-swap control

P1.8 landed, so the three items that were waiting on it can proceed. In this order:

1. **Role-swap control (top right).** Admin/ops act as Technician and swap back. Swap the
   *session's* effective role, never the profile row — the profile is the record of who
   someone is, and `profiles` is not client-writable anyway. Gate it on a new
   `user.act_as_technician` capability rather than `role === 'admin'`, and list a swapped
   user among technicians for assignment and co-op while swapped. Everything they do while
   swapped stays attributed to their real name in the audit trail.
2. **Log-events container in Review**, gated on `activity.view_all`.
3. **Admin/ops unrestricted ticket access** — the full A–Z technician flow on tickets they
   opened, gated on the `ticket.*` capabilities rather than role comparisons.

**Then the migration of the existing gates.** The registry is in place and read by the
Permissions screen, but the other twenty-eight role comparisons in `index.html` still ask
`S.role === 'x'` directly. They are correct today because the defaults were seeded from
them — but until they call `hasPermission()`, granting an exception changes what the
Permissions screen says and not what the app does. Convert them subsystem by subsystem
with a suite each, not in one sweep.

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
