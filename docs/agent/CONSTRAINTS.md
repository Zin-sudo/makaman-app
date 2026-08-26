# Makaman — Agent Constraints & Anti-Patterns
> **Read this before every task. Violating any rule = immediate STOP.**
> **This file lives in `docs/agent/CONSTRAINTS.md` in the repo. Update it after every task.**

---

## 0. CLAUD.md — READ FIRST, UPDATE EVERY TASK

**`docs/agent/CLAUD.md` is the entry point for every agent session.**

- **Read it FIRST** before HANDOFF.md, MINDMAP.md, CONSTRAINTS.md, or FEATURE_LINKS.md.
- **Update it EVERY task** — if you discover a new pattern, skill, or methodology, add it immediately.
- **It contains:** project persona, methodology (Graphify, one-touch, dependency-first), skills registry, environment setup, architecture rationale.
- **CLAUD.md is source code.** Commit it with every change.

## 0.5. REPO PLACEMENT DIRECTIVE

**All four agent-loop files MUST live in the repo at `docs/agent/`:**
- `docs/agent/CLAUD.md` — Project context, persona, methodology, skills registry (READ FIRST)
- `docs/agent/HANDOFF.md` — Living state + next task
- `docs/agent/MINDMAP.md` — Full project map
- `docs/agent/CONSTRAINTS.md` — This file — hard rules
- `docs/agent/FEATURE_LINKS.md` — Cross-feature dependency tree

**After completing EVERY task:**
1. Update `CLAUD.md` if methodology, skills, or architecture changed.
2. Update the relevant `.md` file(s) to reflect what changed.
3. Commit them alongside your code changes: `git add docs/agent/ && git commit -m "..."`
3. Push to `claude/makaman-app`.

**These files are part of the codebase, not external docs.** Treat them as source code.

---

## 1. BRANCH & REPO (Immutable)

- **Branch:** `claude/makaman-app` ONLY. Never push to `claude/job-log-timestamps-locked-8m5mz0`.
- **Repo:** `Zin-sudo/makaman-app`
- **Deploy target:** Vercel project `makaman-app`, Root Directory = `app/`, Production Branch = `claude/makaman-app`.
- **Git-based deploy only.** Never use `deploy_to_vercel` (inlines files, burns tokens, incomplete deploys).

## 2. SUPABASE (Immutable)

- **Project ref:** `igutjfezxkdncrcpvnqx` (`Makaman-app`).
- **Forbidden project:** `makaman-libya` (`vaawlkmbhdbevkylclkf`) — company website, never touch.
- **Confirm ref** before every `apply_migration` or `execute_sql`.
- **Migration 0002** is applied-but-missing in `supabase/migrations/`. Do NOT rebuild DB from files alone.
- **Price-list normalization** happens in DB (`public.normalise_item_number()` + trigger `trg_price_list_items_normalise`), NOT in import scripts.

## 3. APP ARCHITECTURE (Do Not Rewrite)

- `app/` is a **static dc-runtime HTML app** (`index.html` + `support.js` + `config.js`), NOT Vite/React. Do NOT rewrite to React/Vite/Next.js.
- `prototype/Job Ticket System.dc.html` is the **16-edit UX master**. Port FROM it, do not redesign.
- Offline storage is currently `localStorage` (`makaman.jobtickets.v2`). IndexedDB migration is P1.3 — do NOT jump ahead.
- Edge Functions are **admin-only** (`admin-actions`). All other writes use direct Supabase client + RLS.

## 4. SECURITY (Never Bypass)

- `admin-actions` Edge Function re-derives caller identity from their JWT. **Never trust a `userId` or role from the request body.**
- Role changes to Admin/Ops Manager are restricted to Admins inside that function, independently of UI.
- Seeded Admin (`Lateri@makaman.ly`) password was in a chat transcript — **rotate before production**.
- Supabase Auth "leaked password protection" is OFF. Turn on before real accounts exist (manual dashboard toggle).
- Email confirmation is still ON — needs manual dashboard toggle OFF (cannot automate via MCP).

## 5. OFFLINE-FIRST RULES

- **NO Google Fonts CDN.** Vendor Inter locally in `app/public/fonts/`.
- **NO unpkg.com / CDN dependencies** in production. All runtime libraries must be in `app/vendor/`.
- Service Worker must work without network. `sw.js` is minimal today — do NOT break it.

## 6. VERCEL (Read-Only from Tools)

- MCP token is **write-only**. `list_projects` returns empty. `get_deployment` 404s. `*.vercel.app` is egress-blocked in this sandbox.
- **Trust user's direct dashboard check over MCP tools.** Do not burn sessions retrying deploy verification.
- Env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are committed in `app/.env.production` — correct as-is.

## 7. ITEM ORDERING RULES (Standing Decision)

On the Service Ticket, charged items MUST appear in this **default order**:
1. **Transportation** — always first
2. **Engineer / Supervisor** — second
3. **Tool: First Day** — third
4. **Tool: Additional Day** — fourth
5. **Surcharge** (20% desert/marine) — always second-to-last
6. **Discount** — always last

**Exception:** The Ops Manager may drag-and-drop reorder items for exceptional cases. The system must persist the custom order per ticket. Reordering is done in the Ops Review screen only (not by technician).

- Store `ticket_items.order_index` (integer, default NULL = use category sort).
- When `order_index` is NULL, sort by category priority (Transport=1, Eng=2, Tool1st=3, ToolAdd=4, Surcharge=98, Discount=99).
- When `order_index` is set, sort by that index ascending.
- Drag-and-drop must work on both desktop (mouse) and tablet (touch).

## 8. NOTIFICATIONS RULES (Standing Decision)

Push notifications are **role-targeted** and **event-triggered**:

| Event | Sender | Recipient | Message |
|-------|--------|-----------|---------|
| Technician presses "Job Done" | Technician | Ops Manager | "New ticket awaiting review — [Customer] / [Ticket No]" |
| Ops Manager approves ticket | Ops Manager | Technician | "Ticket [Ticket No] approved. Ready to generate and download." |
| Observer adds note to approved ticket | Observer | Ops Manager | "Follow-up on [Ticket No] — [Observer Name]" |

- Notifications are stored in a `notifications` table (not ephemeral).
- Each notification has: `id`, `recipient_id`, `sender_id`, `ticket_id`, `type`, `title`, `body`, `read` (boolean), `created_at`.
- RLS: users can only SELECT their own notifications. Admins can SELECT all.
- Web Push (VAPID) is the transport. Service Worker handles `push` events.
- If push permission is denied or unavailable, notifications appear as in-app badges + bell icon.
- In-app notification bell is visible to ALL roles (Technician, Ops, Admin, Observer).

## 9. NOTES SYSTEM RULES (Standing Decision)

- **Observer-only** (and Admin) can add notes to **approved tickets**.
- Each note: `id`, `ticket_id`, `author_id`, `content`, `created_at`, `acknowledged_by` (Ops Manager ID, nullable), `acknowledged_at`.
- Notes appear in a "Follow-up Notes" panel on the approved ticket view (Observer sees add input; Ops Manager sees add input + acknowledge button).
- Adding a note triggers a push notification to the Ops Manager (see §8).
- Acknowledging a note sets `acknowledged_by` and `acknowledged_at`.
- Notes are read-only after acknowledgment (no editing).
- RLS: Technicians cannot see notes. Ops Managers and Observers can see all notes on tickets they have access to. Admins see all.

## 10. OPS MANAGER TICKET NUMBER RULE (Standing Decision)

### 10.1 When Number Assignment Is Allowed
- **Ops Manager can ONLY assign/edit a ticket number when the ticket status is `awaiting_review`.**
- This means: AFTER the technician presses "Job Done" and BEFORE the Ops Manager presses "Approve".
- The ticket number input and "Take next from series" buttons are **disabled/hidden** when:
  - Status is `logging` (technician still working)
  - Status is `approved` (already approved, number is locked)
- RLS policy `tickets_update_staff` must enforce this at the database level: `status = 'awaiting_review'` is required for `ticket_number` column updates.
- If a ticket needs re-numbering after approval, the Ops Manager must first **reopen** the ticket (with mandatory reason, already logged to `audit_log`), which resets status to `awaiting_review`, then edit the number, then re-approve.

### 10.2 Number Reservation / Sequence Tracking (NEW)
When the Ops Manager clicks "Take next from series":

1. **Immediate reservation:** The next number in the selected series is **reserved** immediately in the database. It is marked as `reserved_by = [ops_manager_id]` and `reserved_at = now()`.
2. **Reservation is tied to the ticket:** The `tickets.ticket_number` column is populated with the reserved number.
3. **If approved:** The reservation becomes permanent. The number is marked as `used = true` in `numbering_series`.
4. **If NOT approved (cancel, navigate away, ticket rejected):** The reservation is released. The number returns to the pool of available numbers. The sequence resets to the last unused number.
5. **Auto-cleanup:** A background job (or trigger) releases reservations older than 24 hours with no approval.
6. **Collision prevention:** Two Ops Managers cannot reserve the same number. The "Take next" button fetches the lowest available number atomically (`SELECT ... FOR UPDATE` or equivalent).

**Schema addition to `numbering_series`:**
```sql
ALTER TABLE numbering_series ADD COLUMN reserved_by uuid REFERENCES auth.users(id);
ALTER TABLE numbering_series ADD COLUMN reserved_at timestamptz;
ALTER TABLE numbering_series ADD COLUMN used boolean DEFAULT false;
```

**UI behavior:**
- "Take next from series" button is visible only when status = `awaiting_review`.
- After clicking, the number appears in the input field with a small "(reserved)" label.
- If the Ops Manager navigates away without approving, the reservation is released on next load (or via auto-cleanup).

## 11. PERMISSIONS SYSTEM RULES (Standing Decision)

### 11.1 Per-User Permissions (NEW)
**Permissions are resolved at the USER level, not just the ROLE level.**

Resolution order (highest priority wins):
1. **User-level override** — `user_permissions` table: `user_id` + `permission_key` = explicit `true`/`false`
2. **Role default** — `permissions.default_values` JSON: the role's default for this permission
3. **Hard deny** — Some permissions are locked ON/OFF regardless of override (e.g., Technician cannot approve tickets)

**Example:** Two Observers can have different permissions:
- Observer A: `observer_activity_full = true` (sees all audit log entries)
- Observer B: `observer_activity_full = false` (sees only status changes, default)
- Admin sets this per-user in the Users & Customers panel.

### 11.2 Auto-Adoption Rule (CRITICAL)
**Every new feature, screen, or capability built into the PWA MUST automatically register a permission toggle in the permissions system.** This is not optional. It happens in the SAME commit as the feature.

- When you build a feature, ask: "Who should be able to use this?"
- Create a permission record for it immediately.
- The permission must be wired into the UI via `data-perm-*` attributes or conditional rendering.
- Default state: ON for roles that logically need it (e.g., timestamp editing = ON for Ops/Admin, OFF for Technician).

### 11.3 Permission Categories
| Category | Count | Behavior |
|----------|-------|----------|
| **Locked** | 4 | Always ON, grayed out, cannot be disabled. Core safety features. |
| **Workflow** | 9 | Can be disabled, but shows confirmation modal. Affects business process. |
| **Cosmetic** | 13+ | Free toggle. UI preferences, optional features. |

### 11.4 Observer Activity Tab Granularity
Observer's view of the "Activity" tab (audit trail / live events) has TWO permission levels:

- **`observer_activity_status_only`** (default): Observer sees ONLY status-level changes:
  - "Ticket created"
  - "Job Done pressed"
  - "Ticket approved"
  - "Ticket reopened"
  - "Note added" (but not note content, just "Observer added a note")

- **`observer_activity_full`** (if enabled by Admin for this user): Observer sees ALL edits:
  - Timestamp changes (old → new)
  - Item additions/removals
  - Price overrides
  - Mileage changes
  - B13/F14 overrides
  - Discount percentage changes
  - Everything in `audit_log`

**Implementation:** The Activity tab queries `audit_log` with a filter. When `observer_activity_status_only` is OFF (or user-level override is false), filter out `event_type` values that are not in the status-only whitelist. Whitelist: `ticket_created`, `job_done`, `ticket_approved`, `ticket_reopened`, `note_added`.

### 11.5 Audit Trail for Permissions
**Every permission change MUST write to `audit_log`** with:
- `event_type`: `'permission_changed'`
- `details`: JSON with `{ permission_key, old_value, new_value, changed_by, target_user_id }`
- Old and new values must be explicit (boolean, string, or JSON).
- Admin making the change is captured from JWT, not request body.
- If the change is a user-level override (not role default), `target_user_id` is the affected user.

## 12. CROSS-FEATURE LINKAGE RULE (Standing Decision)

### 12.1 The Golden Rule
**If you change Feature A, and Feature B reads from Feature A's data or UI, you MUST update Feature B in the same commit. No exceptions. No "I'll come back to it."**

### 12.2 Feature Link Map
**The canonical Feature Link Map lives in `docs/agent/FEATURE_LINKS.md`.** Read it before editing any feature. Update it after every commit.

Before editing any feature:
1. **Read `docs/agent/FEATURE_LINKS.md`** to see what depends on what you're about to change.
2. **Search the codebase** for existing implementations of the same pattern. Reuse, don't duplicate.
3. **Check the Feature Registry** — has this been built before in a different form?
4. **Ask:** "Am I editing a file that was already touched for this feature in a previous commit?" If yes, consolidate.

### 12.3 Post-Flight Checklist (Before Every Commit)
Before `git commit`:
1. **Grep for the old pattern** — did I leave a duplicate implementation elsewhere?
2. **Grep for references** — does any other feature import/use the thing I just changed?
3. **Run end-to-end** — if I changed item ordering, does Print Preview still render correctly? If I changed timestamps, does the audit log still capture them?
4. **Verify no orphaned code** — delete old implementations, don't leave them commented out.
5. **Update `docs/agent/FEATURE_LINKS.md`** — add your feature if new, or update links if you changed an existing one.

## 13. COST-EFFICIENCY METHODOLOGY (Standing Decision)

### 13.1 The Goal
**Minimize token usage by eliminating duplication, overlap, and rework.** Every line of code should be written exactly once.

### 13.2 The Rules

**A. Feature Registry Pattern**
Maintain a mental (and code-level) registry of features. Before building anything:
- Search `app/` and `prototype/` for existing similar functionality.
- If a pattern exists (e.g., `audit_log` write, `notification` insert, `modal` component), **reuse it exactly**.
- If a pattern is 80% similar, **parameterize it** rather than copy-pasting.

**B. One-Touch Rule**
Each file should be edited **once per feature**. If you find yourself going back to the same file for the same feature, you failed to plan. Stop, consolidate, and redo as one change.

**C. Dependency-First Ordering**
Never build a dependent feature before its foundation:
- Build `permissions` table BEFORE any feature that needs gating.
- Build `notifications` table BEFORE wiring push events.
- Build `ticket_items.order_index` BEFORE drag-and-drop UI.
- Build `audit_log` write pattern BEFORE any feature that needs auditing.
- Build `fmt()` helper BEFORE any screen that displays dates/times.

**D. Shared Utilities Over Inline**
If the same logic appears in 2+ places, extract it:
- Date formatting → `fmt()` in `support.js`
- Money formatting → `money()` in `support.js`
- Audit logging → `auditLog()` in `support.js`
- Notification insertion → `notify()` in `support.js`
- Permission check → `hasPermission()` in `support.js`

**E. No Speculative Code**
Do not build "in case we need it later." Build exactly what the current task requires. The Feature Registry and Link Map will tell you when a foundation is needed for a future task.

**F. Commit = Snapshot of Working State**
Every commit must leave the app in a working state. Do not commit broken code with a note to fix later. If a task is too big for one commit, split it into smaller tasks.

**G. The 30-Minute Rule**
If stuck on a sub-task for >30 minutes:
1. Check if you're duplicating something that already exists.
2. Check if you're solving a problem that doesn't exist yet (speculative).
3. If neither, STOP, log blocker, and move to the next queued item.

## 14. ANTI-PATTERNS — DO NOT DO

| Anti-Pattern | Why It Destroys Velocity | What To Do Instead |
|-------------|--------------------------|-------------------|
| "Rewrite to React/Vite now" | `app/` is static HTML. Rewriting + porting simultaneously = 2 rewrites. | Finish static file first. Migrate after launch. |
| "Add RxDB/PouchDB/ElectricSQL" | Overkill for 5–20 tickets/tech. Adds 100–300KB + sync complexity. | Use raw IndexedDB or `idb` wrapper. Keep existing queue pattern. |
| "Route all writes via Edge Functions" | Bypasses RLS, replicates auth logic, adds latency. | Direct Supabase client + RLS for 95%. Edge Functions for admin-only. |
| "Redesign the schema" | 44 RLS policies already production-grade. | Extend, don't redesign. Add columns/tables as needed. |
| "Verify Vercel via MCP" | Token is write-only. Will never work. | Trust user's dashboard. Do not retry. |
| "Use Google Fonts CDN" | Breaks offline-first. No font at wellhead. | Vendor Inter locally. `font-display: swap`. |
| "Implement permissions before features exist" | Permissions gate ghosts. | Build feature in `app/` first, THEN wire permission toggle in SAME commit. |
| "Rebuild print preview from scratch" | Prototype has 16 rounds of refinement. | Port prototype's CSS/layout into `app/`. Do not redesign. |
| "Ask user about already-decided items" | 4 AskUserQuestion rounds completed. All Q1/Q2 answered. | Check Standing Decisions in MINDMAP.md. Implement, don't re-ask. |
| "Add real OAuth for cloud storage" | Needs MS/Google app registration + server-side token exchange. | Mock the UI/UX only. Flag "needs backend" in commit message. |
| "Build notifications before ticket workflow exists" | Notifications need events (Job Done, Approve) to trigger. | Build the core ticket flow first, then wire notifications to events. |
| "Store notifications in localStorage only" | Notifications must survive device switch and be visible to recipient on any device. | Supabase `notifications` table + Realtime subscription. |
| "Duplicate audit_log write logic in every feature" | 15 features x 5 audit points = 75 copies of the same INSERT. | Extract `auditLog()` helper. Call it once per event. |
| "Build drag-and-drop before item ordering schema exists" | DnD needs `order_index` to persist. No column = no persistence. | Add `order_index` column first (schema), THEN build DnD UI. |
| "Build Observer activity filter before permissions system exists" | Filter depends on permission value. No permission = no filter logic. | Build permissions schema first, THEN activity tab filter. |
| "Skip updating FEATURE_LINKS.md" | Dependencies become tribal knowledge. Next agent breaks things. | Update the link map in the SAME commit as the code change. |
| "Store permissions per role only" | User explicitly requested per-user overrides. Two Observers need different access. | Use `user_permissions` table for overrides. Role default is fallback. |
| "Reserve ticket numbers in memory only" | Browser refresh = lost reservation = duplicate numbers. | Reserve in `numbering_series` table with `reserved_by` + `reserved_at`. |

## 15. CSS / LAYOUT RULES

- **Tables** = scroll within their own box (`overflow-x: auto`). Never let a 6+ column table blow out page width.
- **Small option sets** (tabs, button rows, dropdown+action) = must always fit fully visible. Use wrap grids or shrink margins. Never hide behind horizontal scroll.
- **Responsive breakpoints:** 640px (phone), 980px (tablet). Verify `scrollWidth === clientWidth` at 375/768/1280px after every layout change.
- **No inline ternaries in `{{ }}` bindings** — dc-runtime doesn't support them. Precompute in JS.
- **Drag-and-drop items** must work with both mouse and touch. Use native HTML5 DnD with touch polyfill if needed.

## 16. COMMIT DISCIPLINE

- One self-contained edit per commit.
- Commit message must include: what was ported/changed, what was verified, any mock/placeholder flags.
- **Include `docs/agent/*.md` updates in the same commit as the code change.**
- Push to `claude/makaman-app` immediately after commit.
- `npm run build` (or equivalent static validation) must pass before commit.

## 17. STANDING DECISIONS (Do Not Re-Derive)

1. **Ticket numbering:** Manual by Ops Manager with uniqueness check. NOT auto-assigned. **Only editable when status = `awaiting_review`.**
2. **Number reservation:** "Take next from series" immediately reserves the number in DB. Released if not approved. Auto-cleanup after 24h.
3. **Delivery format:** Download from app (Excel + PDF). Cloud upload is secondary UI-only.
4. **Surcharge:** 20% desert/marine as real price-list item (`kind: 'percent'`, `defaultAddOnDraft: true`), waivable.
5. **Discount:** Discretionary price-list item (`kind: 'percent'`, negative), variable rate, NEVER defaulted.
6. **B13/F14:** Admin-configured permanent defaults, Ops-Manager-overridable per ticket.
7. **Timestamps:** Auto-captured by default. Technician MAY optionally edit ticket-level AND line-level timestamps before pressing "Job Done" (to align with 3rd party rig records). After "Job Done", timestamps are locked. Ops/Admin can edit timestamps at any time (including on approved tickets, with reopen if needed). Every timestamp edit -> `audit_log` with old→new values, editor role, and reason.
8. **Observer:** Formerly "Founder." Read-only. Live activity + approved tickets + notes.
9. **Pressure/Total on job-log lines:** Optional per line. Blank-by-default.
10. **Item search:** By item no. or description substring. Behavioral suggestions = one at a time, per-client history.
11. **Back navigation:** Visible button treatment everywhere, not plain text links.
12. **Original vs. Copy sheets:** Exact duplicates. No "COPY" stamp.
13. **Signature block (rows 41–50):** Do not touch. No pre-filled names.
14. **Row caps:** Service Ticket items = 24 rows. Job Log events = 25 rows. Overflow -> pagination or manual trim.
15. **Permissions:** Per-user overrides with role defaults as fallback. 4 locked ON + 9 workflow + 13+ cosmetic. **Auto-adopt every new feature in the SAME commit.**
16. **Font:** Local Inter. NO Google Fonts CDN.
17. **Architecture:** Direct Supabase + RLS. Edge Functions admin-only.
18. **Item ordering:** Transport -> Engineer -> Tool 1st Day -> Tool Add Day -> Surcharge -> Discount. Drag-and-drop override allowed.
19. **Notifications:** Push + in-app bell. Stored in Supabase. Web Push (VAPID) transport.
20. **Notes:** Observer/Admin can add to approved tickets. Ops Manager acknowledges. Triggers notification.
21. **Observer Activity Tab:** `observer_activity_status_only` (default) or `observer_activity_full` (if enabled per user). Filter `audit_log` accordingly.
22. **Cross-feature linkage:** Change Feature A -> update Feature B in same commit if B reads from A. Update `FEATURE_LINKS.md`.
23. **Cost efficiency:** One-touch rule, dependency-first, shared utilities, no speculative code.
24. **Repo docs:** `docs/agent/*.md` are source code. Update and commit them with every task.
26. **Signed Document Attachment:** After technician downloads sheets and obtains physical signature/stamp, either technician or ops manager may attach a scanned PDF of the signed documents to the approved ticket. PDF format only. Stored in Supabase Storage with DB reference in `ticket_documents` table. Accessible by Admin, Ops Manager, and Observer. Technicians and Ops Managers can view an "Outstanding Tasks" list showing approved tickets missing signed documents. Every upload -> `audit_log` with file name, uploader role, and timestamp.
27. **NULL unit_cost display:** 110 price-list rows have NULL `unit_cost` (quoted per job, e.g., "as per third party company invoice", "50% from first day charge"). The app MUST display "Quoted Separately" or the descriptive text — NEVER 0.00. This affects Ops Review, Print Preview, and Excel generation. Do NOT invent prices for these items.


---

## 18. GRAPHIFY RULES (Knowledge Graph Methodology)

### 18.1 When to Build/Rebuild the Graph
- **Initial setup:** Run `/graphify .` once to generate `graphify-out/`.
- **Before major refactors:** Run `/graphify . --update` if touching >3 files or changing data contracts.
- **After adding new features:** Rebuild so the graph includes new modules and dependencies.
- **Before cross-feature work:** Query the graph to understand dependencies instead of grepping.

### 18.2 Graphify Outputs (committed to repo)
```
graphify-out/
├── graph.html          # interactive visualization
├── GRAPH_REPORT.md     # key concepts, surprises, suggested questions
└── graph.json          # queryable graph data
```

### 18.3 Graphify Commands to Know
```bash
/graphify .                        # full rebuild
/graphify . --update               # incremental (changed files only)
/graphify query "what depends on tickets?"    # scoped question
/graphify path "auth.users" "audit_log"       # trace dependency chain
/graphify explain "ticket_items"              # understand a concept
```

### 18.4 Graphify + Claude Code Cache
Add to `.claudeignore` to prevent prompt cache invalidation:
```
graphify-out/
graph.json
```

### 18.5 Do NOT Use Graphify For
- Trivial one-line changes in a single file
- Tasks fully described in HANDOFF.md with no cross-file impact
- Changes that take <5 minutes to implement and verify

---

## 19. SKILLS REGISTRY RULES

### 19.1 Evaluating External Skills
Before installing any skill from https://x.com/VaibhavSisinty/article/2063290847723192610 or similar registries:

1. **Read the README** — understand what it does and how it works
2. **Check compatibility** — does it work with static HTML, Supabase, Vercel?
3. **Check overlap** — do we already have something that does this?
4. **Check maintenance** — is it actively maintained?
5. **Check value** — does it reduce tokens, improve quality, or save time?

**Install only if 3+ criteria are met.**

### 19.2 Registering Installed Skills
Every installed skill MUST be registered in `CLAUD.md` with:
- Skill name and source URL
- Install command
- When to use it
- When NOT to use it

### 19.3 Removing Obsolete Skills
If a skill becomes unused or is superseded by a better alternative:
1. Remove it from `CLAUD.md`
2. Uninstall it (`uv tool uninstall <name>` or equivalent)
3. Note the removal in the commit message



---

## 20. BLINDSPOTS DIAGNOSTIC RULES (Pre-Mortem Prevention)

### 20.1 The Philosophy
**It is 100× cheaper to prevent a failure than to debug it after production.** Every task MUST include a pre-flight and post-flight diagnostic check against `BLINDSPOTS.md`.

### 20.2 Pre-Flight Check (Mandatory)
Before writing any code:
1. Identify which subsystem(s) your task touches (Auth, Storage, Numbering, Excel, Notifications, etc.).
2. Read the failure modes for those subsystems in `BLINDSPOTS.md`.
3. Apply Prevention Rules in your design.
4. If your task introduces a NEW subsystem, derive 3+ failure modes and append them to `BLINDSPOTS.md` BEFORE coding.

### 20.3 Post-Flight Check (Mandatory)
After coding, before committing:
1. Run the Detection Method grep for each touched subsystem.
2. If grep returns a match → FAIL. Fix the code. Do not commit.
3. If grep returns no match → PASS. Note in commit message.
4. If you discovered a NEW failure mode during coding → append to `BLINDSPOTS.md`.

### 20.4 Token Efficiency
The Detection Methods in `BLINDSPOTS.md` are designed as **grep commands** — they cost ~10 tokens to run and give a binary PASS/FAIL. This replaces open-ended "analyze the code for bugs" prompts that cost 500+ tokens and give vague answers.

### 20.5 Commit Message Format
Every commit MUST include a diagnostic note:
```
P1.1: Port Settings screen
- Pre-flight: touches Nav (B-9.3), Settings overlay (B-9.1)
- Post-flight: B-9.1 PASS, B-9.3 PASS
- No new blind spots.
```

### 20.6 When to STOP
If Post-Flight check FAILS:
- Do NOT commit.
- Do NOT "fix it in the next task."
- Fix it NOW. The failure mode is documented. The fix is known. There is no excuse.


---

## 21. STUBS, DEFERRALS, AND CLOSING A CATEGORY

A stub is cheap to write and expensive to find again. The cost is never the stub itself —
it is coming back cold to a thing you already had loaded, re-deriving why it was left, and
discovering it had gone stale in the meantime. This session produced three examples inside
one day: an `exportExcel` that announced downloads it never performed, a `cloud.test.js`
that printed PASS over a dead suite, and a HANDOFF line still describing a stub that had
been implemented two commits earlier.

### 21.1 Register it at the moment you defer it
Every deferral — a stub, a mock, a "left alone", a "not investigated", a known-red test —
MUST be written into the **stub register (HANDOFF §8)** in the same commit that creates or
discovers it, with:
- what is incomplete, in one line;
- **the tier it must be closed in** (§7), which is the "recommended time";
- who it is blocked on, if anyone.

An unregistered deferral is a defect, not a decision.

### 21.2 A tier does not close while its stubs are open
**Before declaring any tier of §7 done, walk the register and close every entry assigned to
that tier.** No tier is complete with an open stub against it. This is the whole point: the
work is still loaded, the reasoning is still in hand, and closing it now costs a fraction
of what returning to it costs.

If an entry genuinely should not be done in its tier, it is **re-assigned in the register
with a reason** — not silently carried.

### 21.3 A stub must not lie
Until it is implemented, a stub MUST tell the truth about itself:
- It must never write to the audit trail, which is a record of what happened (B-18.1).
- It must never show success for work it did not do.
- It must say plainly that it is not connected or not finished.
A stub that reports success is worse than a missing feature, because it removes the very
signal that would have got it finished.

### 21.4 Prefer deleting to deferring
If nothing depends on it and nobody asked for it, remove it rather than register it. The
register is for work that is genuinely coming, not a graveyard.

### 21.5 Detection
```bash
# Anything in the docs that reads like a deferral must appear in the register.
grep -n -iE "still open|unimplemented|not investigated|mocked|left alone|for now" docs/agent/HANDOFF.md
# Every red suite is a registered stub until it is green.
cd app && for t in *.test.js; do NODE_PATH=../node_modules node "$t" >/dev/null 2>&1 || echo "RED: $t"; done
```
