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

| Feature | Reads From | Writes To | Affected By | Links To | Status |
|---------|-----------|-----------|-------------|----------|--------|
| **Ticket create** | `clients`, `job_types`, `org_defaults`, `permissions`, `numbering_series` | `tickets`, `ticket_lines`, `audit_log`, `numbering_series` (reservation) | `org_defaults`, `job_types`, `permissions`, `numbering_series` | Job log, Ops Review, Notifications, Number Reservation | ⏳ Not ported |
| **Job log** | `tickets`, `permissions` | `ticket_lines`, `audit_log` | Ticket timestamps, `fmt()` settings, `permissions` | Ticket create, Ops Review, Activity tab | ⏳ Not ported |
| **Ops Review** | `tickets`, `ticket_lines`, `price_list_items`, `numbering_series`, `permissions`, `ticket_items` | `tickets`, `ticket_items`, `audit_log`, `notifications`, `numbering_series` (approve/release) | Item ordering, surcharge/discount, timestamp editing, permissions, number reservation | Print Preview, Excel generation, Notifications, Activity tab, Number Reservation | ⏳ Not ported |
| **Item ordering** | `ticket_items`, `permissions` | `ticket_items.order_index` | Ops Review UI, Print Preview, Excel generation | Ops Review, Print Preview, Excel generation | ⏳ Not built |
| **Print Preview** | `tickets`, `ticket_lines`, `ticket_items`, `permissions` | — | Item ordering, B13/F14, timestamps, logo | Ops Review, Excel generation | ⏳ Not ported |
| **Excel generation** | `tickets`, `ticket_lines`, `ticket_items` | File buffer | Item ordering, B13/F14, timestamps, print preview layout | Print Preview, Ops Review | ⏳ Not built |
| **Notifications** | `tickets`, `permissions`, `push_subscriptions` | `notifications` | Job Done, Approve, Note add | Ticket create, Ops Review, Notes, Service Worker | ⏳ Not built |
| **Notes** | `tickets`, `permissions` | `ticket_notes`, `notifications` | Approve status (only approved tickets), permissions | Ops Review, Notifications, Activity tab | ⏳ Not built |
| **Settings** | `localStorage`, `permissions` | `localStorage` | Theme CSS, `fmt()` helpers | Every screen (nav bar) | ⏳ Not ported |
| **Permissions** | `permissions`, `user_permissions`, `auth.users` | `audit_log` | Every new feature | Every feature (gates access) | ⏳ Not built |
| **Activity tab** | `audit_log`, `permissions` | — | Every feature that writes to `audit_log` | Job log, Ops Review, Notes, Timestamp editing | ⏳ Not built |
| **Observer live view** | `tickets`, `permissions` | — | Presence badge, auto-sync | Activity tab | ⏳ Not ported |
| **Number Reservation** | `numbering_series`, `tickets` | `numbering_series` (reserved_by, reserved_at, used) | Ops Review actions, ticket status changes | Ticket create, Ops Review | ⏳ Not built |
| **Signed Document Attachment** | `tickets`, `ticket_documents`, `permissions` | `ticket_documents`, Supabase Storage | Ticket approval status, permissions | Ops Review, Outstanding Tasks, Admin Archive, Observer view | ⏳ Not built |
| **Auto-sync timer** | `localStorage` (queue), `permissions` | `tickets` (synced flag), `audit_log` | Offline queue, connectivity | Ticket create, Notifications | ⏳ Not ported |
| **Presence badge** | `tickets`, `permissions` | — | Auto-sync, connectivity | Observer live view, Ops Review | ⏳ Not ported |
| **Item search + suggestions** | `price_list_items`, `ticket_items`, `permissions` | `ticket_items` | Price list data, behavioral tracking | Ops Review | ⏳ Not ported |
| **Cloud storage linking** | `localStorage`, `permissions` | `localStorage` | Settings screen | Print Preview, Excel generation | ⏳ Not ported |
| **PWA installability** | `manifest.webmanifest`, `sw.js` | — | Service Worker capabilities | Every screen (add-to-homescreen) | ⚠️ Partial |
| **Responsive CSS** | `theme.css` | — | Screen layouts | Every screen | ✅ Ported |
| **Auth (login/signup)** | `auth.users`, `profiles`, `permissions` | `auth.users`, `profiles`, `audit_log` | Approval flow, role assignment | Every screen (session) | ⏳ Not ported |
| **Role management** | `profiles`, `permissions` | `profiles`, `audit_log` | Admin actions | Auth, Permissions | ⏳ Not ported |
| **Theme system** | `localStorage` (settings), `theme.css` | CSS variables | Settings screen | Every screen | ⚠️ Partial |
| **CLAUD.md** | `CLAUD.md` | `CLAUD.md` | Every task | Every feature (context) | ✅ Exists |
| **Graphify** | Entire repo | `graphify-out/` | Every file change | Every feature (impact analysis) | ✅ Setup required |
| **Audit logging** | — | `audit_log` | Every feature that changes data | Activity tab, Permissions | ✅ Exists (DB) |

---

## 2. SHARED UTILITIES

> **If you need to do something that sounds like it already exists, check here first.**

| Utility | Location | Purpose | Used By |
|---------|----------|---------|---------|
| `fmt()` | `app/support.js` | Date/time formatting with timezone + 12h/24h from settings | Every screen with timestamps |
| `money()` | `app/support.js` | Currency formatting (USD/LYD), negative handling | Ops Review, Print Preview, Excel |
| `auditLog()` | `app/support.js` | Write to `audit_log` with consistent schema | Every feature that changes data |
| `notify()` | `app/support.js` | Insert into `notifications` + trigger Realtime | Job Done, Approve, Note add |
| `hasPermission()` | `app/support.js` | Resolve per-user permission (user override > role default > hard deny) | Every gated feature |
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

