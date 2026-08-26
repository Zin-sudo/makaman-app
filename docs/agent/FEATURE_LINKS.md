# Makaman — Feature Link Tree
> **Read `docs/agent/CLAUD.md` FIRST. Then read this before editing ANY feature.**
> **Update this file in the SAME commit as the code change.**
> **This file lives in `docs/agent/FEATURE_LINKS.md` in the repo.**

---

## 0. HOW TO USE THIS FILE

### Before Starting a Task
1. **Read `docs/agent/CLAUD.md`** for project context and methodology.
2. Find the feature you're about to edit in the Link Matrix below.
3. Read its "Affected By" and "Links To" columns.
4. If any linked feature will break due to your change, plan to update it too.
5. **Query Graphify** (`/graphify query "what depends on <feature>?"`) for cross-file impact analysis.

### After Completing a Task
1. If you added a new feature, add a row to the Link Matrix.
2. If you changed an existing feature's data contract (columns, params, return type), update all rows that reference it.
3. If you extracted a shared utility, add it to the Shared Utilities section.
4. Commit this file alongside your code.

---

## 1. LINK MATRIX

| Feature | Reads From | Writes To | Affected By | Links To | Status | Suite |
|---------|-----------|-----------|-------------|----------|--------|-------|
| **Ticket create** | `clients`, `job_types`, `org_defaults`, `numbering_series` | `tickets`, `ticket_lines`, `audit_log` | `org_defaults`, `job_types`, `numbering_series` | Job log, Ops Review, Number Reservation | ✅ Shipped | `roles`, `lengthcap` |
| **Job log** | `tickets` | `ticket_lines`, `audit_log` | Ticket timestamps, `fmt()` settings | Ticket create, Ops Review, Activity tab | ✅ Shipped | `clock`, `audit` |
| **Ops Review** | `tickets`, `ticket_lines`, `price_list_items`, `numbering_series`, `ticket_items` | `tickets`, `ticket_items`, `audit_log` | Item ordering, surcharge/discount, timestamp editing, number reservation | Print Preview, Exports, Activity tab | ✅ Shipped | `office`, `office2`, `forced` |
| **Forced admin/ops action** | `tickets`, session role | `tickets`, `audit_log` | Ops Review, ticket status | Ops Review, Activity tab | ✅ Shipped (`eb01f51`) | `forced` |
| **Numbering claim** | `numbering` (holder + history) | `numbering` | Account tab, Admin override | Ticket numbering, Activity tab | ✅ Shipped (`d96b512`) | `claim`, `numbering` |
| **Location cap (10 chars)** | — | `tickets.field/well/rig` | `LOCATION_MAX`, `clampLoc()` | Ticket create, sheets, exports | ✅ Shipped (`a249882`) | `lengthcap` |
| **Coordinates (top bar + sheets)** | `geo` fixes | clipboard, sheet render | Location sharing toggle, banner system | Top bar, Well No. cell, reports | ✅ Shipped (`dabbbc9`) | `wellgeo`, `geo` |
| **Clock & timezone** | `settings.timeFormat` | `settings` | `OPERATING_TZ` is fixed (Africa/Tripoli) | Every stamp; exports always 24h | ✅ Shipped (`c2ab70b`) | `clock` |
| **Item ordering** | `ticket_items` | `ticket_items.order_index` | Ops Review UI, Print Preview, exports | Ops Review, Print Preview, exports | ⏳ Not built | — |
| **Print Preview** | `tickets`, `ticket_lines`, `ticket_items` | — | Item ordering, timestamps, logo | Ops Review, exports | ✅ Shipped | `techreport` |
| **Exports (ZIP + overview)** | `tickets`, `ticket_lines`, `ticket_items` | File buffer | Item ordering, timestamps, preview layout | Print Preview, Ops Review, Account tab | ✅ Shipped (`2fc71f8`) | `export` |
| **Master-Excel automation** | approved `tickets` | shared master workbook | Approval event | Account tab download | ⏳ Not built — ask the user first | — |
| **Notifications** | `tickets`, `push_subscriptions` | `notifications` | Job Done, Approve, Note add | Ticket create, Ops Review, Notes, SW | ⏳ Not built | — |
| **Notes** | `tickets` | `ticket_notes`, `notifications` | Approve status (approved only) | Ops Review, Notifications, Activity | ⏳ Not built | — |
| **Settings** | `localStorage` | `localStorage`, `user_settings` | Theme CSS, `fmt()` helpers | Every screen | ✅ Shipped | `clock`, `tabs` |
| **Permissions** | `permissions`, `user_permissions`, `profiles` | `user_permissions` | Every new feature | Every capability gate in the app | ✅ Shipped and honoured — 11 gates converted, presentation stays role-based | `permissions`, `observer`, `roles` |
| **Activity tab** | `audit_log` | — | Every feature that writes `audit_log` | Job log, Ops Review, Timestamp editing | ✅ Shipped | `audit` |
| **Log-events container (Review)** | ticket `audit` | — | `activity.view_edits` — the Observer reaches this screen, so it is gated exactly as the Activity tab is | Ops Review, Activity tab | ✅ Shipped — gated, attributed, kind-labelled | `reviewlog` |
| **Observer live view** | `tickets` | — | Presence badge, auto-sync | Activity tab | ✅ Shipped | `observer` |
| **Number Reservation** | `numbering_series`, `tickets` | `numbering_series` | Ops Review actions, status changes | Ticket create, Ops Review | ⏳ Not built (local check only) | `numbering` |
| **Signed Document Attachment** | `tickets`, `ticket_documents` | `ticket_documents`, Storage | Approval status | Ops Review, Archive, Observer | ⏳ Not built | `assets` (partial) |
| **Sync / offline queue** | `localStorage` outbox | `tickets`, `audit_log` | Connectivity, coalescing, refusal back-off | Ticket create, Notifications | ✅ Shipped | `sync`, `coalesce`, `cloud` |
| **Co-op / crew tickets** | `ticket_crew` | `ticket_crew`, `audit_log` | Assignment, handover | Ticket create, Ops Review | ✅ Shipped | `coop` |
| **Search** | `tickets` | — | Inbox filters | Ops Review inbox | ✅ Shipped | `search` |
| **Currency** | `clients.currency`, `price_list_items.currency` | — | Per-client decimals | Ops Review, exports, sheets | ✅ Shipped (`fc57078`) | `currency` |
| **Layout / responsive** | viewport policy in `<head>` | — | Phone vs tablet vs laptop | Every screen | ✅ Shipped (`d96b512`) | `layout` |
| **Toasts / banners** | — | — | Unified banner system | Every screen | ✅ Shipped | `toast` |
| **PWA installability** | `manifest.webmanifest`, `sw.js` | — | Service Worker capabilities | Every screen | ⚠️ Partial | — |
| **Auth (login/signup)** | `auth.users`, `profiles` | `auth.users` (signup only) | Approval flow, role assignment | Every screen (session) | ✅ Shipped (`d3690ae`) | `auth` |
| **Approval / role management** | `profiles` | `profiles` **via `admin-actions` only** | `profiles` RLS is SELECT-only for clients | Auth, Permissions, Admin Users screen | ✅ Fixed 2026-08-26 | `approval` |
| **Role swap (act as Technician)** | session, `PERMISSION_DEFAULTS` | session only — **never `profiles`** | `user.act_as_technician`; narrows `hasPermission()` to the acted role | Top bar, `activeTechnicians()` (assignment, co-op, handover, field devices), every capability gate | ✅ Shipped — per device only | `swap` |
| **User deletion** | `profiles` | — | `admin-actions` has no `delete_user` | Admin Users screen | ⏳ Not built — dialog says so | `approval` |
| **Theme system** | `localStorage` settings | CSS variables | Settings screen | Every screen | ✅ Shipped | `tabs` |
| **Responsive theme v2** | `reference/makaman-responsive-theme-v2.css` | — | Not imported by anything | App-design polish (pending mockups) | 📦 Stored, not wired — see HANDOFF §5 | — |
| **Audit logging** | — | `audit_log` | Every feature that changes data | Activity tab, Permissions | ✅ Shipped | `audit` |

---

## 2. SHARED UTILITIES

> **If you need to do something that sounds like it already exists, check here first.**

| Utility | Location | Purpose | Used By |
|---------|----------|---------|---------|
| `fmt()` | `app/support.js` | Date/time formatting with timezone + 12h/24h from settings | Every screen with timestamps |
| `money()` | `app/support.js` | Currency formatting (USD/LYD), negative handling | Ops Review, Print Preview, Excel |
| `auditLog()` | `app/support.js` | Write to `audit_log` with consistent schema | Every feature that changes data |
| `notify()` | `app/support.js` | Insert into `notifications` + trigger Realtime | Job Done, Approve, Note add |
| `activeTechnicians()` | `app/index.html` (component method) | Who counts as a technician right now: role-technicians plus whoever is swapped in on this device. | Assignment, co-op, handover, field devices |
| `hasPermission(key)` | `app/index.html` (component method) | Resolve a capability: **acted role's defaults while swapped**, else hydrated map > `PERMISSION_DEFAULTS` for the role > deny. Never asks the server — the answer must work with no signal. An unknown key is **false**. | 14 call sites: activity depth, numbering, reports, ticket read-only, the claim, promote/delete, the Permissions screen. **Use it for capabilities; a role comparison is still right for presentation and routing.** |
| `roleLabel()` | `app/support.js` | Map DB role key to display label (`founder` -> "Observer") | Users table, nav bar |
| `normaliseItemNumber()` | Supabase DB function | Strip whitespace around hyphens in item codes | Price list import, item search |
| `flatSubtotal()` | `app/support.js` | Calculate subtotal of non-percent items only | `itemTotal()`, `ticketTotal()` |
| `itemTotal()` | `app/support.js` | Calculate line total (flat or percent-of-subtotal) | Ops Review, Print Preview, Excel |
| `ticketTotal()` | `app/support.js` | Calculate grand total (items + surcharge + discount) | Ops Review, Print Preview, Excel |
| `paginate()` | `app/support.js` | Split items/events into cap-sized pages | Print Preview, Excel generation |
| `/graphify` | CLI skill | Queryable knowledge graph of entire repo | Every feature (impact analysis) |

---

## 3. DATA CONTRACTS

> **If you change any of these, you MUST update all features that depend on them.**

### `tickets` table
```
id, customer_id, field_name, well_no, rig_name, technician_id,
status ('logging'|'awaiting_review'|'approved'|'reopened'),
arrival_at, start_job_at, end_job_at, ticket_number, mileage,
base_location, customer_rep, job_type_id, ops_location_note,
created_at, updated_at, synced, presence ('online'|'offline')
```
**Dependents:** Ticket create, Job log, Ops Review, Print Preview, Excel, Notifications, Activity tab, Observer live view, Number Reservation

### `ticket_lines` table
```
id, ticket_id, timestamp, pressure, total, details, created_at
```
**Dependents:** Job log, Ops Review, Print Preview, Excel, Activity tab

### `ticket_items` table
```
id, ticket_id, price_list_item_id, code, description, qty, unit,
cost, kind ('flat'|'percent'), order_index (int, NULL = default sort)
```
**Dependents:** Ops Review, Item ordering, Print Preview, Excel, Activity tab

### `audit_log` table
```
id, ticket_id, event_type, details (jsonb), created_at, created_by
```
**Event types:** `ticket_created`, `job_done`, `ticket_approved`, `ticket_reopened`, `timestamp_edited`, `item_added`, `item_removed`, `item_reordered`, `price_overridden`, `mileage_changed`, `b13_changed`, `f14_changed`, `discount_changed`, `surcharge_waived`, `note_added`, `note_acknowledged`, `permission_changed`
**Note:** `timestamp_edited` can be triggered by Technician (before "Job Done"), Ops Manager, or Admin. Details include: `{ field, old_value, new_value, editor_role, reason }`.
**Dependents:** Activity tab, Permissions audit

### `notifications` table
```
id, recipient_id, sender_id, ticket_id, type, title, body, read, created_at
```
**Types:** `ticket_done`, `ticket_approved`, `ticket_note`, `system`
**Dependents:** In-app bell, Service Worker push, Notifications list


### `ticket_documents` table (NEW)
```
id, ticket_id, uploaded_by, file_name, storage_path, file_size, mime_type, created_at
```
**Constraints:** `mime_type` MUST be `application/pdf`.
**RLS:** Technicians and Ops Managers can INSERT. Admin, Ops Manager, and Observer can SELECT. Technicians cannot SELECT documents on tickets they did not create.
**Dependents:** Signed Document Attachment, Outstanding Tasks, Admin Archive

### `price_list_items` table (Updated 2026-08-20)
```
id, client_id (uuid), item_number, description, unit_cost (numeric, NULLABLE), unit, kind, default_add_on_draft
```
**Note:** `unit_cost` is nullable. 110 rows are "quoted separately" (descriptive text, no fixed price). App MUST display "Quoted Separately" or description — NEVER 0.00.
**Ten Waha code conflicts:** Same `(client_id, item_number)` maps to different items/prices. Parked in `backup.price_list_conflicts_20260820`. Do NOT invent numbers.
**Dependents:** Item search, Ops Review, Print Preview, Excel generation

### `numbering_series` table
```
id, category ('special_tools'|'fishing'|'drilling'), prefix,
last_number, next_number, reserved_by (uuid), reserved_at (timestamptz), used (boolean)
```
**Dependents:** Ops Review (assign number), Ticket create (pre-fill), Admin Numbering tab

### `profiles` table — **write path is not the ordinary one**
```
id (= auth.users.id), email, full_name,
role ('technician'|'ops_manager'|'admin'|'founder'), status ('pending'|'active')
```
RLS carries **SELECT policies only** (`profiles_select_own`, `profiles_select_staff`). No
signed-in client may INSERT, UPDATE or DELETE, by design — a client that could set its own
role would be no protection at all (CONSTRAINTS §4).

Therefore:
- **Reads** come from `hydrate()` like any other table.
- **Writes** go through the `admin-actions` Edge Function only, via `adminAction()` in
  `app/index.html`. It re-derives the caller from their JWT; a `userId` or `role` in the
  body names who is *acted upon*, never who is *allowed to act*.
- Actions available: `approve_signup`, `promote_role`, `create_technician`. There is **no
  `delete_user`** — add one before wiring any delete button to the server.
- `profiles` is deliberately **absent from the `diffOps` pair list**. Never add it back:
  every such op is refused, and before 2026-08-26 the refusal jammed the whole outbox.

**Dependents:** Auth, Admin Users screen, Permissions (P1.8), Role swap

---

## 4. CHANGE LOG

> **Append-only. Log every update to this file.**

| Date | Commit | What Changed |
|------|--------|--------------|
| 2026-08-23 | — | File created. Initial Link Matrix with 21 features. Shared Utilities and Data Contracts sections added. |
| 2026-08-24 | — | Added CLAUD.md and Graphify as meta-dependencies. Updated all intros to reference CLAUD.md first. |
| 2026-08-24 | — | Added BLINDSPOTS.md failure registry. Integrated pre-flight/post-flight diagnostic protocol across all agent-loop files. |
| 2026-08-24 | — | Standing Decision #7: Technician timestamp editing added. audit_log contract updated to capture editor_role. |
| 2026-08-24 | — | Standing Decision #26: Signed Document Attachment feature added. `ticket_documents` data contract added. Link Matrix updated. |
| 2026-08-20 | — | Price list import: 2,610 rows. `price_list_items` contract updated — unit_cost nullable, "quoted separately" rule, Waha conflicts noted. |

---

## 5. TEMPLATES

### Adding a New Feature
```markdown
| **Feature Name** | `table1`, `table2` | `table3` | `dependency1` | `consumer1`, `consumer2` | ⏳ Not built |
```

### Updating an Existing Feature's Contract
1. Find the feature in the Link Matrix.
2. Update its "Writes To" or "Reads From" columns.
3. Find all features in "Links To" that are affected.
4. Update their "Affected By" columns.
5. Update the Data Contracts section if table schema changed.
6. Log the change in the Change Log.

### Extracting a Shared Utility
1. Add it to the Shared Utilities table.
2. Find all features that currently inline the same logic.
3. Replace inline logic with the utility in the SAME commit.
4. Log the change in the Change Log.

---

*This is a living document. Update it after every commit. Do not let it drift.*


---

## 5. CLAUD.md & GRAPHIFY DEPENDENCIES

### CLAUD.md
**CLAUD.md is NOT a feature — it is the agent's operating system.** Every feature implicitly depends on it for:
- Project persona and success criteria
- Methodology (one-touch rule, dependency-first, shared utilities)
- Skills registry (what tools are available)
- Environment setup (commands, versions)

**When to update CLAUD.md:**
- New skill installed or removed
- Methodology change (e.g., new cost-efficiency rule)
- Architecture decision recorded
- Environment setup changes (new tool, new version)

### Graphify
**Graphify is a tooling dependency, not a product feature.** It affects every feature by improving the agent's ability to:
- Understand cross-file dependencies before editing
- Identify god nodes (shared utilities that many features use)
- Discover surprising connections (unexpected dependencies)
- Trace paths between concepts (e.g., "how does auth flow to audit_log?")

**When to rebuild the graph:**
- Before refactoring >3 files
- After adding a new feature
- When cross-feature dependencies are unclear
- Before any schema migration

