# Makaman PWA — Project Mind Map
> **Read `docs/agent/CLAUD.md` FIRST, then this file for full project context. Do not re-derive.**
> **Last updated:** 2026-08-26 (v5 — §0 re-synced against the actual repo; P1.1 is done, not pending)

---

## 0. CURRENT STATE SNAPSHOT

### 0.1 Production-Grade (Exists & Live)
| Layer | Status | Details |
|-------|--------|---------|
| **Supabase Backend** | ✅ Live | `igutjfezxkdncrcpvnqx`, 15 tables, 12 migrations, **2,600 price-list items**, `admin-actions` Edge Function |
| **Database Schema** | ✅ Locked | PostgreSQL, FKs, cascades, triggers, `audit_log` table |
| **Auth** | ✅ Working | Supabase Auth + email/password, auto-profile creation. **Approval goes through the `admin-actions` Edge Function** — `profiles` has SELECT-only RLS, so no client can write it (fixed 2026-08-26; see HANDOFF §2) |
| **Prototype UX** | ✅ Complete | 16 verified edits in `prototype/Job Ticket System.dc.html` |
| **P1.1 — Prototype → `app/` port** | ✅ **Done** | Listed as a 🔴 blocker in v4. It shipped: `app/index.html` is 6,159 lines with 26 Playwright suites. See HANDOFF §1.1 for the commit-by-commit record. |
| **Field/office features A–H** | ✅ Done | Fixed Libya timezone, top-bar coordinates + long-press copy, 10-char location cap, forced admin actions, real tablet/laptop layout, Account-tab numbering claim, tools container. Commits in HANDOFF §1.1. |
| **Real Excel Template** | ✅ In repo | `reference/Autofill_ServiceTikcet_System.xlsx` — 4 sheets + 6 price-list sheets |
| **Vercel Deploy** | ✅ Live | `makaman-app`, builds from `claude/makaman-app`, Root Directory = `app` |

### 0.2 Demo / Needs Work
| Layer | Status | Details |
|-------|--------|---------|
| **`app/` (deployable)** | ⚠️ Static HTML | `index.html`, 6,159 lines of dc-runtime + `localStorage` + `authMode` fallback, mirrored byte-identical to `Job Ticket System.dc.html`. NO Vite, NO React. |
| **Test suites** | ✅ 26 in `app/` | `approval` `assets` `audit` `auth` `claim` `clock` `cloud` `coalesce` `coop` `currency` `export` `forced` `geo` `layout` `lengthcap` `numbering` `observer` `office` `office2` `roles` `search` `sync` `tabs` `techreport` `toast` `wellgeo`. Playwright against vendored Chromium; `playwright-core` is installed on demand, not committed. |
| **Outbox** | ⚠️ Bounded | Coalescing localStorage queue. A refused op is retried 5× then set aside into `makaman.outbox.refused.v1` so it cannot freeze the queue (2026-08-26). Nothing surfaces set-aside ops in the UI yet. |
| **Service Worker** | ⚠️ Basic | `sw.js` exists but minimal. No Background Sync API. No Push API. |
| **Offline Storage** | ⚠️ `localStorage` | Simple `synced` boolean + queue. Not IndexedDB. |
| **Permissions System** | ✅ Live and honoured | `permissions` (33 rows) + `user_permissions`; `has_permission()` / `my_permissions()` in the DB, `hasPermission()` in the app, admin page in Account. **11 capability gates converted; 18 presentation/routing comparisons kept as roles on purpose** (HANDOFF §2c). Migrations 0013–0017. |
| **Feature Link Map** | ⚠️ Not documented | Cross-feature dependencies are tribal knowledge. Risk of orphaned changes. |
| **Number Reservation** | ⚠️ Not built | "Take next from series" has no DB reservation. Risk of duplicate numbers. |

### 0.3 Hard Blockers for Launch
| Gap | Severity | Phase |
|-----|----------|-------|
| **Part B — Excel/PDF Generation** | 🟡 Partly done | P2.1–P2.2 — per-ticket ZIP + monthly overview shipped (`2fc71f8`); the approved-ticket → master-Excel automation is not started |
| ~~**Prototype -> `app/` Port**~~ | ✅ Done | P1.1 — shipped; see §0.1 |
| **Arabic / RTL Support** | ⚪ Cancelled (UI) · ✅ Done (content) | P2.4 — user ruled the interface stays English 2026-08-26; Arabic text entry, storage and PDF output are shipped and tested. See HANDOFF §2i. |
| **Notifications System** | 🔴 Critical | P1.6–P1.7 |
| **Notes System (Observer follow-ups)** | 🔴 Critical | P2.6 |
| **Drag-and-Drop Item Reordering** | 🟡 High | P2.0 |
| ~~**Permissions System + Per-User Overrides**~~ | ✅ Foundation done | P1.8 — schema, helpers and admin page shipped 2026-08-26; converting the existing role gates is the remaining work |
| **Number Reservation / Sequence Tracking** | 🟡 High | P1.9 |
| **IndexedDB + Migration** | 🟡 High | P1.3 |
| **Background Sync API** | 🟡 High | P1.4 |

---

## 1. ARCHITECTURE

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENT LAYER                                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Technician  │  │ Ops Manager │  │ Admin / Observer    │ │
│  │ (phone)     │  │ (desktop)   │  │ (any device)        │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                    │            │
│  ┌──────▼────────────────▼────────────────────▼──────────┐│
│  │  app/ — Static dc-runtime PWA (index.html + support.js)││
│  │  • localStorage offline queue                            ││
│  │  • Service Worker (basic -> Background Sync + Push API)   ││
│  │  • Supabase Auth (email/password)                      ││
│  │  • Supabase Realtime (notifications, live activity)    ││
│  │  • Permissions system (per-user overrides)           ││
│  └────────────────────────┬────────────────────────────────┘│
└─────────────────────────┼─────────────────────────────────┘
                          │
┌─────────────────────────▼─────────────────────────────────┐
│  SUPABASE BACKEND                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Auth        │  │ Database    │  │ Edge Functions      │ │
│  │ (email/pw)  │  │ (15 tables) │  │ admin-actions only  │ │
│  └─────────────┘  └──────┬──────┘  └─────────────────────┘ │
│                          │                                 │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │  RLS Policies (44) — Row-Level Security              │  │
│  │  Triggers: on_auth_user_created, ticket rules, audit   │  │
│  │  Realtime: notifications, ticket changes, presence       │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack
- **Frontend:** Custom dc-runtime (static HTML, not React/Vite)
- **Styling:** CSS variables (light/dark/system + 5 accents), `theme.css`
- **State:** `localStorage` (pending IndexedDB migration)
- **Backend:** Supabase (PostgreSQL + Auth + Realtime)
- **Serverless:** Edge Functions (Deno) for admin-privileged actions only
- **Deploy:** Vercel (static site from `app/`)
- **Template Engine:** dc-runtime (`{{ }}` bindings, NO inline ternaries)
- **Push:** Web Push API (VAPID) via Service Worker
- **Permissions:** Per-user overrides with role defaults as fallback
- **Knowledge Graph:** Graphify (https://github.com/Graphify-Labs/graphify) — local AST parsing, queryable codebase graph

---

## 2. FILE STRUCTURE REALITY

```
Zin-sudo/makaman-app/
├── app/                          ← DEPLOYABLE (Vercel builds here)
│   ├── index.html                427KB static dc-runtime (NEEDS 16 EDITS PORTED)
│   ├── support.js                dc-runtime support + business logic
│   ├── config.js                 Supabase URL/key + authMode
│   ├── sw.js                     Basic SW (NEEDS Background Sync + Push API)
│   ├── manifest.webmanifest      PWA manifest
│   ├── vercel.json               SPA routing
│   ├── *.test.js                 20+ Playwright behavior tests
│   ├── uploads/                  Logo, icons, generated assets
│   └── vendor/                   dc-runtime.js (LOCAL, not CDN)
│
├── prototype/                    ← DESIGN REFERENCE (NOT deployed)
│   └── Job Ticket System.dc.html 16-edit UX master — source of truth
│
├── supabase/                     ← BACKEND (Production-grade)
│   ├── migrations/               0001, 0003–0011
│   │   └── 0002 MISSING          Applied in DB but no file! Reconstruct.
│   ├── functions/admin-actions/  Edge Function for user mgmt
│   └── makaman_price_lists_final.sql
│
├── reference/                    ← BUSINESS ASSETS
│   └── Autofill_ServiceTikcet_System.xlsx  ← REAL TEMPLATE for Part B
│
├── docs/agent/                   ← THIS LOOP PACKAGE (source code)
│   ├── CLAUD.md                  Project context, persona, methodology, skills registry (READ FIRST)
│   ├── HANDOFF.md                Living state + next task
│   ├── MINDMAP.md                This file — full project map
│   ├── CONSTRAINTS.md            Hard rules & anti-patterns
│   ├── FEATURE_LINKS.md          Cross-feature dependency tree
│   └── BLINDSPOTS.md             Failure mode registry & diagnostic protocol
│
└── HANDOFF.md                    Legacy project memory (15K+ bytes)
```

**Rule:** If a file is not in `app/`, it does not ship. The prototype is a design reference, not production code.
**Rule:** `docs/agent/*.md` are source code. Update and commit them with every task.

---

## 3. PHASES & MILESTONES

### Phase 0 — Pre-Project & Discovery ✅ DONE
| Code | Milestone | Owner |
|------|-----------|-------|
| P0.1 | Business requirements gathered — 4 AskUserQuestion rounds | User + Claude |
| P0.2 | Real Excel template received and parsed | User upload |
| P0.3 | Cell mapping documented (B8/E8, formulas, signatures) | Claude |
| P0.4 | Supabase project created + schema designed | Claude |
| P0.5 | Vercel project created + first deploy | User dashboard |
| P0.6 | Price lists imported — 2,274 items, 6 clients | Claude |
| P0.7 | Graphify knowledge graph initialized — `graphify-out/` committed | Claude |
| P0.8 | **BLINDSPOTS.md failure registry created — 30+ failure modes documented** | Claude |

### Phase 1 — Foundation (Port Prototype -> app/) 🔄 IN PROGRESS
**Goal:** `app/` is a functional, themed, responsive static PWA with all prototype features ported.

| Code | Milestone | Status | Severity | Owner |
|------|-----------|--------|----------|-------|
| P1.0 | HANDOFF.md + Mind Map + Constraints + Feature Links created | ✅ Done | Low | Claude |
| P1.1 | Port all 16 prototype edits into `app/` | 🔄 Current | 🔴 Critical | Claude Code |
| P1.2 | Inject `makaman-responsive-theme-v2.css` — local Inter, `mk-*` classes | ⏳ Pending | 🟡 High | Claude Code |
| P1.3 | Switch to IndexedDB — migrate `localStorage` on first load | ⏳ Pending | 🟡 High | Claude Code |
| P1.4 | Background Sync API — SW `sync` tag, auto-retry when signal returns | ⏳ Pending | 🟡 High | Claude Code |
| P1.5 | PWA installability verified — Add to Home Screen, dark splash | ⏳ Pending | 🟡 Medium | User test |
| P1.6 | **Notification schema + Supabase Realtime** — `notifications` table, RLS, Realtime channel | ⏳ Pending | 🔴 Critical | Claude Code |
| P1.7 | **In-app notification bell + badge** — visible to all roles, unread count, click to list | ⏳ Pending | 🔴 Critical | Claude Code |
| P1.8 | **Permissions system foundation** — `permissions` + `user_permissions` tables, `hasPermission()` helper, per-user overrides, admin page in Account | ✅ Done 2026-08-26 (migrations 0013–0015) | 🟡 High | Claude Code |
| P1.8b | **Convert the capability gates to `hasPermission()`** — 11 converted, 18 presentation/routing comparisons deliberately left as roles. Surfaced that `activity.view_all` was two capabilities; migration 0016 splits out `activity.view_edits` | ✅ Done 2026-08-26 | 🔴 Was critical to P1.8 being real | Claude Code |
| P1.9 | **Number reservation system** — `numbering_series.reserved_by`, atomic reservation, auto-cleanup, release on cancel | ⏳ Pending | 🟡 High | Claude Code |

**P1.1 — The 16 Prototype Edits (Port Queue):**
| # | Edit | Prototype Commit | Ported to `app/`? |
|---|------|------------------|-------------------|
| 1 | Founder -> Observer rename | `f3831d1` | ✅ Yes (display label only) |
| 2 | Back-navigation as visible buttons | — | ⏳ No |
| 3 | **Settings screen** | — | ⏳ No |
| 4 | Real Login/Signup + approval flow | `a4fc276` | ⏳ No |
| 5 | Role management (Ops Team + Admin promote) | `01c6931` | ⏳ No |
| 6 | Real Makaman logo (large on Login/Signup, medium on Settings) | — | ⏳ No |
| 7 | Timestamp editing + audit trail | `9c9e96c` | ⏳ No |
| 8 | B13/F14 admin-configured defaults | `751fb3a` | ⏳ No |
| 9 | Surcharge/discount as percent items | `50437d7` | ⏳ No |
| 10 | Item search + behavioral suggestions | `5ed03f4` | ⏳ No |
| 11 | In-progress presence badge | `a532b49` | ⏳ No |
| 12 | Auto-sync timer | `9acf67d` | ⏳ No |
| 13 | Observer/Ops live-event-view | `69475e9` | ⏳ No |
| 14 | Cross-device responsiveness + PWA manifest/icons | `20d46fe` + `3bc9514` | ✅ Yes (theme.css @media) |
| 15 | Cloud storage linking UI (OneDrive/Google Drive, mocked OAuth) | `45f3d1d` | ⏳ No |
| 16 | Sheet preview (A4, pagination, real template) | `dbe860a`->`60f06e4` | ⏳ No |
| 14b | PWA installability verification | — | ⏳ No |

### Phase 2 — Core Business Features 🔴 BLOCKED (Needs P1 Complete)
**Goal:** The app generates real invoices, handles notifications, and serves the local market.

| Code | Milestone | Status | Severity | Owner |
|------|-----------|--------|----------|-------|
| P2.0 | **Drag-and-drop item reordering** — Ops Review screen, touch + mouse, persist `order_index` | 🔴 Blocker | 🟡 High | Claude Code |
| P2.1 | Part B — Excel Generation: Edge Function fills real template | 🔴 Blocker | 🔴 Critical | Claude Code |
| P2.2 | Part B — PDF Generation: Same function renders PDF | 🔴 Blocker | 🔴 Critical | Claude Code |
| P2.3 | Pagination / Overflow: Items >24 or log lines >25 -> multi-page or trim | 🔴 Blocker | 🔴 Critical | Claude Code |
| P2.4 | Arabic Text Rendering: Excel/PDF + UI input support | 🔴 Blocker | 🔴 Critical | Claude Code |
| P2.5 | Master Workbook: Admin download + optional Supabase preview | ⏳ Pending | 🟡 High | Claude Code |
| P2.6 | **Notes System + Observer follow-ups** — `ticket_notes` table, add note, acknowledge, audit | ⏳ Pending | 🔴 Critical | Claude Code |
| P2.7 | **Push Notifications (Web Push VAPID)** — Job Done -> Ops, Approve -> Tech, Note -> Ops | ⏳ Pending | 🔴 Critical | Claude Code |
| P2.8 | **Permissions auto-adoption** — Every P1 feature gets a permission toggle retroactively | ⏳ Pending | 🟡 High | Claude Code |
| P2.9 | **Observer Activity Tab granularity** — `observer_activity_status_only` vs `observer_activity_full` per user | ⏳ Pending | 🟡 High | Claude Code |
| P2.10 | **Signed Document Attachment** — PDF upload, Supabase Storage, outstanding tasks list | ⏳ Pending | 🔴 Critical | Claude Code |

**Item Ordering Rules (P2.0):**
```
Default order on Service Ticket:
1. Transportation        <- always first
2. Engineer / Supervisor
3. Tool: First Day
4. Tool: Additional Day
5. Surcharge (20%)       <- always second-to-last
6. Discount              <- always last

Ops Manager may drag-and-drop reorder for exceptional cases.
Storage: ticket_items.order_index (NULL = default category sort)
```

**Ops Manager Ticket Number Rule + Reservation:**
```
1. Ticket number assignment ONLY when status = 'awaiting_review'.
   After "Job Done" -> BEFORE "Approve".

2. "Take next from series" button:
   - Immediately reserves the number in numbering_series (reserved_by, reserved_at)
   - Populates tickets.ticket_number
   - Shows "(reserved)" label next to the number

3. If approved:
   - Reservation becomes permanent
   - numbering_series.used = true

4. If NOT approved (cancel, navigate away, reject):
   - Reservation released
   - Number returns to pool
   - Sequence resets to last unused

5. Auto-cleanup: reservations older than 24h with no approval are released.

6. Collision prevention: atomic fetch (SELECT ... FOR UPDATE).
```

**Notification Flow (P2.7):**
```
Technician presses "Job Done"
    ↓
[Supabase trigger / app event]
    ↓
INSERT INTO notifications (recipient_id=OpsManager, type='ticket_done', ...)
    ↓
Supabase Realtime broadcasts -> Ops Manager's device
    ↓
Service Worker Push API (if subscribed) -> native push
    ↓
In-app bell badge increments + toast appears

Ops Manager approves ticket
    ↓
[Supabase trigger / app event]
    ↓
INSERT INTO notifications (recipient_id=Technician, type='ticket_approved', ...)
    ↓
Body: "Ticket [MKN-1882] approved. Ready to generate and download."
    ↓
Technician sees push + in-app notification

Observer adds note to approved ticket
    ↓
[App event]
    ↓
INSERT INTO notifications (recipient_id=OpsManager, type='ticket_note', ...)
    ↓
Ops Manager sees push + in-app notification + acknowledges note
```

**Permissions Resolution (Per-User Overrides):**
```
Resolution order (highest priority wins):
1. User-level override (user_permissions table)
2. Role default (permissions.default_values JSON)
3. Hard deny (locked permissions)

Example: Two Observers, different access
- Observer A: observer_activity_full = true  (sees all audit log)
- Observer B: observer_activity_full = false (status-only, default)
- Admin sets per-user in Users & Customers panel
```

> **Exit Gate P2:** Finance receives downloaded Excel, opens it, confirms it matches paper Service Ticket/Job Log. Ops Manager gets notified of new tickets. Technician gets notified of approvals. Observer can add follow-up notes. Permissions gate every feature correctly. Numbers never duplicate.

### Phase 3 — Hardening ⏳ PENDING
**Goal:** Production-safe for real crews.

| Code | Milestone | Severity |
|------|-----------|----------|
| P3.1 | Permissions System UI: Admin page, 3 tabs, per-user overrides, 4 locked + 9 workflow + 13+ cosmetic toggles | 🟡 High |
| P3.2 | Audit Log for Permissions: Every change writes to audit trail with admin/timestamp/old->new/target_user | 🟡 Medium |
| P3.3 | Push Notifications refinement: batching, quiet hours, priority | 🟡 Medium |
| P3.4 | Conflict Detection: Two Ops open same ticket -> banner | 🟡 High |
| P3.5 | Rate Limiting / Load Test: 50 techs sync, no 429s | 🟡 High |
| P3.6 | Battery & Performance: <20% drain per 4h | 🟡 Medium |

> **Exit Gate P3:** 5-person internal test runs full day without data loss or sync failure.

### Phase 4 — Launch Readiness ⏳ PENDING
**Goal:** Real field deployment.

| Code | Milestone | Severity |
|------|-----------|----------|
| P4.1 | Security Hardening: Rotate admin pw, enable leak protection, audit Edge Function | 🔴 Critical |
| P4.2 | Data Migration Path: `localStorage` -> IndexedDB, zero ticket loss | 🟡 High |
| P4.3 | Field Test: 2–3 real techs at well sites for 3 days | 🔴 Critical |
| P4.4 | Documentation: Admin onboarding, tech quick-start, ops checklist | 🟡 Medium |
| P4.5 | Go/No-Go Decision | 🔴 Critical |

---

## 4. ROLES & PERMISSIONS MATRIX

| Action | Technician | Ops Manager | Admin | Observer |
|--------|-----------|-------------|-------|----------|
| Create and log own tickets | ✅ | — | ✅ | — |
| Edit own ticket before approval | ✅ | — | ✅ | — |
| Review / approve any Done ticket | — | ✅ | ✅ | — |
| Edit ticket-level & line-level timestamps | ✅ (before "Job Done" only) | ✅ | ✅ | — |
| Approve signups (-> Technician) | — | ✅ | ✅ | — |
| Create Technician accounts directly | — | ✅ | ✅ | — |
| Promote to Ops Manager or Admin | — | — | ✅ | — |
| Manage price lists / numbering / job types | — | — | ✅ | — |
| View live activity (in-progress tickets) | — | ✅ | ✅ | ✅* |
| View approved tickets / reports | — | — | ✅ | ✅* |
| **Add notes to approved tickets** | — | — | ✅ | ✅* |
| **Acknowledge notes on approved tickets** | — | ✅ | ✅ | — |
| **Receive push notifications** | ✅ | ✅ | ✅ | ✅ |
| **Assign ticket number** | — | ✅† | ✅† | — |
| **View Activity tab (status-only)** | — | — | ✅ | ✅* |
| **View Activity tab (full edits)** | — | — | ✅ | ✅‡ |
| **Upload signed document PDF** | ✅ | ✅ | — | — |
| **View signed document PDF** | — | ✅ | ✅ | ✅ |
| **View outstanding tasks (missing signed docs)** | ✅ (own) | ✅ (all) | — | — |

\* Subject to per-user permission override
\† Only when status = `awaiting_review`
\‡ Only if `observer_activity_full` enabled for this user by Admin
\§ Uploaders: Technician or Ops Manager. Viewers: Admin, Ops Manager, Observer.
\¶ Outstanding tasks = approved tickets with no `ticket_documents` record.

**Auth flow:** Signup -> Pending -> Ops Manager approves -> auto-assigned Technician.

---

## 5. BUSINESS RULES (Standing Decisions)

### 5.1 Core Rules
1. **Ticket numbering:** Manual by Ops Manager with uniqueness check. NOT auto-assigned. **Only editable when status = `awaiting_review`.**
2. **Number reservation:** "Take next from series" immediately reserves the number in DB (`reserved_by`, `reserved_at`). Released if not approved. Auto-cleanup after 24h.
3. **Delivery format:** Download from app (Excel + PDF). Cloud upload is secondary UI-only.
4. **Surcharge:** 20% desert/marine as real price-list item (`kind: 'percent'`, `defaultAddOnDraft: true`), waivable.
5. **Discount:** Discretionary price-list item (`kind: 'percent'`, negative), variable rate, NEVER defaulted.
6. **B13/F14:** Admin-configured permanent defaults, Ops-Manager-overridable per ticket.
7. **Timestamps:** Auto-captured by default. Technician MAY optionally edit ticket-level AND line-level timestamps before pressing "Job Done" (to align with 3rd party rig records). After "Job Done", timestamps are locked. Ops/Admin can edit timestamps at any time (including on approved tickets, with reopen if needed). Every timestamp edit -> `audit_log` with old→new values, editor role, and reason.
8. **Observer:** Formerly "Founder." Read-only. Live activity + approved tickets + notes.
9. **Pressure/Total on job-log lines:** Optional per line. Blank-by-default.
10. **Item search:** By item no. or description substring. Behavioral suggestions = one at a time, per-client history.
10a. **NULL unit_cost display:** 110 price-list rows have NULL unit_cost (quoted per job). App MUST display "Quoted Separately" or the descriptive text — NEVER 0.00. This affects Ops Review, Print Preview, and Excel generation.
11. **Back navigation:** Visible button treatment everywhere, not plain text links.
12. **Original vs. Copy sheets:** Exact duplicates. No "COPY" stamp.
13. **Signature block (rows 41–50):** Do not touch. No pre-filled names.
14. **Row caps:** Service Ticket items = 24 rows. Job Log events = 25 rows. Overflow -> pagination or manual trim.
15. **Permissions:** Per-user overrides with role defaults as fallback. 4 locked ON + 9 workflow + 13+ cosmetic. **Auto-adopt every new feature in the SAME commit.**
16. **Font:** Local Inter. NO Google Fonts CDN.
17. **Architecture:** Direct Supabase + RLS. Edge Functions admin-only.

### 5.2 Item Ordering Rules
18. **Default order:** Transport -> Engineer -> Tool 1st Day -> Tool Add Day -> Surcharge -> Discount.
19. **Exception:** Ops Manager may drag-and-drop reorder items. Persisted via `ticket_items.order_index`.
20. **Surcharge always second-to-last, Discount always last** in default mode.

### 5.3 Notifications Rules
21. **Events that trigger notifications:**
    - Technician "Job Done" -> Ops Manager
    - Ops Manager "Approve" -> Technician (includes ticket number, "ready to generate/download")
    - Observer adds note to approved ticket -> Ops Manager (to acknowledge)
22. **Transport:** Web Push (VAPID) + Supabase Realtime + in-app bell.
23. **Storage:** `notifications` table in Supabase. NOT localStorage-only.

### 5.4 Notes System Rules
24. **Who can add:** Observer and Admin only.
25. **Target:** Approved tickets only.
26. **Acknowledgment:** Ops Manager must acknowledge. Sets `acknowledged_by` + `acknowledged_at`.
27. **Read-only after acknowledgment.** No editing after ack.
28. **Trigger:** Adding a note pushes a notification to the Ops Manager.

### 5.5 Permissions System Rules
29. **Per-user overrides:** `user_permissions` table takes precedence over role defaults.
30. **Auto-adoption:** Every new feature MUST register a permission toggle in the SAME commit.
31. **Audit trail:** Every permission change writes to `audit_log` with `{ permission_key, old_value, new_value, changed_by, target_user_id }`.
32. **Observer Activity Tab:** `observer_activity_status_only` (default) shows only status changes. `observer_activity_full` shows all `audit_log` entries.

### 5.6 Cross-Feature Linkage Rules
33. **Golden Rule:** Change Feature A -> update Feature B in same commit if B reads from A.
34. **Pre-flight:** Read `FEATURE_LINKS.md` before editing. Search for existing patterns.
35. **Post-flight:** Grep for references, run end-to-end, delete orphaned code, update `FEATURE_LINKS.md`.

### 5.7 Cost-Efficiency Rules
36. **One-Touch Rule:** Each file edited once per feature.
37. **Dependency-First:** Build foundations before dependents.
38. **Shared Utilities:** Extract `auditLog()`, `notify()`, `hasPermission()`, `fmt()`, `money()` into helpers.
39. **No Speculative Code:** Build exactly what the task requires.

### 5.8 Repo Docs Rules
40. **`docs/agent/*.md` are source code.** Update and commit them with every task.
41. **`FEATURE_LINKS.md` is the canonical dependency map.** Read before editing. Update after every commit.

---

## 6. BLIND SPOTS & RISKS

| ID | Risk | Severity | Mitigation Phase |
|----|------|----------|------------------|
| B1 | No Arabic/RTL support — Market is Libya | 🔴 Critical | P2.4 |
| B2 | No data backup for lost phones — Unsynced tickets gone forever | 🔴 Critical | Post-launch |
| B3 | No battery optimization — GPS + sync + push = dead battery | 🟡 High | P3.6 |
| B4 | No rate limiting — 50 techs at 6PM = overload | 🟡 High | P3.5 |
| B5 | No conflict resolution — Two Ops can approve same ticket | 🟡 High | P3.4 |
| B6 | Push notification delivery unreliable in low-signal areas | 🟡 Medium | P2.7 + P3.3 |
| B7 | No session timeout — Unlocked phone = exposed | 🟡 Medium | Post-launch |
| B8 | No offline map tiles — GPS captured but no map view | 🟡 Medium | Future |
| B9 | `backdrop-filter: blur(20px)` janks on low-end Android | 🟡 Low | P1.2 CSS |
| B10 | Drag-and-drop may not work well on small phone screens for Ops | 🟡 Low | P2.0 UX test |
| B11 | Permissions system not built yet — new features will lack gates | 🟡 High | P1.8 |
| B12 | Feature Link Map not documented — risk of orphaned changes | 🟡 Medium | P1.0 (this file) |
| B13 | Number reservation not built — risk of duplicate ticket numbers | 🟡 High | P1.9 |
| B14 | Per-user permissions not built — two Observers cannot have different access | 🟡 High | P1.8 |
| B15 | **No failure mode registry — reactive debugging burns tokens** | 🟡 High | **BLINDSPOTS.md** |
| B16 | **localStorage quota exceeded — ticket loss at well site** | 🔴 Critical | P1.3 + BLINDSPOTS B-1.1 |
| B17 | **Race condition on ticket numbering — duplicate numbers** | 🔴 Critical | P1.9 + BLINDSPOTS B-3.1 |
| B18 | **Audit log write fails silently — compliance gap** | 🔴 Critical | BLINDSPOTS B-8.2 |
| B19 | **Push subscription expires — Ops misses urgent tickets** | 🟡 High | P2.7 + BLINDSPOTS B-6.1 |
| B20 | **dc-runtime ternary in {{ }} — silent render failure** | 🟡 High | BLINDSPOTS B-9.1 |
| B21 | **Signed document upload accepts non-PDF — security risk** | 🔵 Critical | BLINDSPOTS B-12.1 |
| B22 | **Orphan files in Supabase Storage — DB record deleted, file remains** | 🟡 High | BLINDSPOTS B-12.3 |
| B23 | **Outstanding tasks list stale — shows ticket as missing doc when uploaded** | 🟡 High | BLINDSPOTS B-12.5 |
| B24 | **Storage bucket public — anyone with URL accesses signed documents** | 🔵 Critical | BLINDSPOTS B-12.4 |
| B25 | **NULL unit_cost displays as 0.00 on client invoice** | 🔴 Critical | P1.1 + BLINDSPOTS B-13.1 |
| B26 | **Waha code conflicts resolved with invented numbers** | 🔴 Critical | BLINDSPOTS B-13.2 |
| B27 | **Price list import drops quoted-separately rows** | 🔴 Critical | BLINDSPOTS B-13.3 |

---

## 7. SCHEMA EXTENSIONS NEEDED


### `ticket_documents` table (NEW — Signed Document Archive)
```sql
CREATE TABLE ticket_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) NOT NULL,
  file_name text NOT NULL,
  storage_path text NOT NULL,  -- Supabase Storage bucket path
  file_size int NOT NULL,
  mime_type text NOT NULL CHECK (mime_type = 'application/pdf'),
  created_at timestamptz DEFAULT now()
);
-- RLS: uploaders (Tech + Ops) can INSERT. viewers (Admin + Ops + Observer) can SELECT.
-- Technicians can only SELECT their own uploads (not view others' archives).
```
**Dependents:** Ops Review, Outstanding Tasks, Admin Archive, Observer view

### `notifications` table (P1.6)
```sql
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid REFERENCES auth.users(id) NOT NULL,
  sender_id uuid REFERENCES auth.users(id),
  ticket_id uuid REFERENCES tickets(id),
  type text NOT NULL CHECK (type IN ('ticket_done','ticket_approved','ticket_note','system')),
  title text NOT NULL,
  body text NOT NULL,
  read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
-- RLS: recipient can read their own; admin can read all
```

### `ticket_notes` table (P2.6)
```sql
CREATE TABLE ticket_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE NOT NULL,
  author_id uuid REFERENCES auth.users(id) NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  acknowledged_by uuid REFERENCES auth.users(id),
  acknowledged_at timestamptz
);
-- RLS: Technicians cannot see. Ops/Admin/Observer can see.
```

### `price_list_items` schema (Updated 2026-08-20)
```sql
-- unit_cost is now nullable (110 rows are "quoted separately")
-- App MUST display "Quoted Separately" or descriptive text, NEVER 0.00
-- Ten Waha code conflicts parked in backup.price_list_conflicts_20260820
```

### `ticket_items` column addition (P2.0)
```sql
ALTER TABLE ticket_items ADD COLUMN order_index int;
-- NULL = use default category sort
-- SET = use custom drag-and-drop order
```

### `push_subscriptions` table (P2.7)
```sql
CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, endpoint)
);
```

### `permissions` table (P1.8)
```sql
CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  category text NOT NULL CHECK (category IN ('locked','workflow','cosmetic')),
  default_values jsonb NOT NULL DEFAULT '{}',
  -- default_values: { "technician": true, "ops_manager": true, "admin": true, "observer": false }
  created_at timestamptz DEFAULT now()
);
```

### `user_permissions` table (P1.8) — PER-USER OVERRIDES
```sql
CREATE TABLE user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  permission_key text REFERENCES permissions(key) NOT NULL,
  value boolean NOT NULL,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id),
  UNIQUE(user_id, permission_key)
);
-- RLS: users can read their own. Admins can read/write all.
```

### `numbering_series` column additions (P1.9) — NUMBER RESERVATION
```sql
ALTER TABLE numbering_series ADD COLUMN reserved_by uuid REFERENCES auth.users(id);
ALTER TABLE numbering_series ADD COLUMN reserved_at timestamptz;
ALTER TABLE numbering_series ADD COLUMN used boolean DEFAULT false;
-- reserved_by + reserved_at = temporary reservation
-- used = true = permanently assigned to an approved ticket
-- If reserved_at > 24 hours ago and used = false, auto-release
```

### `audit_log` extension for permissions (P1.8)
```sql
-- audit_log already exists. Ensure event_type includes 'permission_changed'.
-- When a permission changes, insert:
-- event_type: 'permission_changed'
-- details: { permission_key, old_value, new_value, changed_by, target_user_id }
-- target_user_id is NULL for role-default changes, SET for user-level overrides
```

---

## 8. BEFORE -> NOW -> NEXT

**BEFORE (Phase 0):**
- Static HTML demo with inline styles
- Demo role-switcher (no real auth)
- No offline capability
- No real price lists
- Paper tickets only

**NOW (End of Phase 0 / Start of Phase 1):**
- Supabase backend production-grade (15 tables, 44 RLS policies)
- 2,274 real price-list items imported
- Prototype has all 16 UX edits verified
- Vercel deploy live but `app/` is still static demo
- Real auth working but app/ uses demo fallback
- **New:** 8 requirements added (notifications, notes, drag-and-drop, permissions per-user, number reservation, activity tab granularity, linkage, cost-efficiency)

**NEXT (Phase 1 -> 2 -> 3 -> 4):**
1. Port all 16 prototype edits into `app/` (P1.1)
2. Build permissions foundation — `permissions` + `user_permissions` tables, `hasPermission()`, `data-perm-*` (P1.8)
3. Build number reservation system — atomic reservation, auto-cleanup (P1.9)
4. Build notification schema + in-app bell (P1.6–P1.7)
5. Inject responsive theme CSS with local Inter font (P1.2)
6. Migrate offline storage to IndexedDB (P1.3)
7. Add Background Sync API to Service Worker (P1.4)
8. Build drag-and-drop item reordering (P2.0)
9. Build Part B: Excel/PDF generation from real template (P2.1–P2.2)
10. ~~Add Arabic text rendering (P2.4)~~ — UI mirroring cancelled 2026-08-26; Arabic content shipped. **Build order now lives in HANDOFF §7, ranked with dependencies.**
11. Build notes system + push notifications (P2.6–P2.7)
12. Retroactively auto-adopt permissions for all P1 features (P2.8)
13. Build Observer Activity Tab granularity (P2.9)
14. Harden: conflict detection, rate limiting, battery audit (P3)
15. Field test -> Launch (P4)


---

## 8. AGENT METHODOLOGY & TOOLING

### 8.1 CLAUD.md — The First File
Every agent session MUST start by reading `docs/agent/CLAUD.md`. It contains:
- **Project persona** — Libyan oilfield services, offline-first, Arabic/RTL future
- **Methodology** — Graphify knowledge graph, one-touch rule, dependency-first ordering
- **Skills registry** — installed AI skills and how to invoke them
- **Environment** — Node version, Supabase CLI, dev server commands
- **Architecture rationale** — why static HTML, why dc-runtime, why direct Supabase + RLS

**CLAUD.md is updated every task.** If you discover a new pattern, add it. If a skill proves useless, remove it.

### 8.2 Graphify Knowledge Graph
We maintain a Graphify knowledge graph of the entire repo:
- **Build:** `/graphify .` (or `graphify . --update` for incremental)
- **Query:** `/graphify query "<question>"` — scoped subgraph answers
- **Path:** `/graphify path "FeatureA" "FeatureB"` — trace dependencies
- **Explain:** `/graphify explain "Concept"` — understand any node

**When to use Graphify:**
- Before editing a feature you haven't touched before
- When investigating cross-file dependencies
- When refactoring shared utilities
- When onboarding to a new subsystem

**When NOT to use Graphify:**
- For trivial one-line changes in a single file
- When the change is already fully described in HANDOFF.md
- For tasks that take <5 minutes

### 8.3 Skills from External Registry
The project references skills listed at https://x.com/VaibhavSisinty/article/2063290847723192610. These are evaluated on merit:
- Install only if they directly improve the Makaman workflow
- Register every installed skill in `CLAUD.md`
- Remove skills that become obsolete or unused
- Prefer skills that reduce token usage or improve code quality

---



---

## 9. FAILURE-FIRST DEVELOPMENT

### 9.1 What is Failure-First Development?
Instead of building features and then fixing bugs, we **derive failure modes from the architecture first**, encode them in `BLINDSPOTS.md`, and prevent them during implementation.

### 9.2 The Process
```
1. Design the feature
2. Ask: "How can this fail?" → Derive 3+ failure modes
3. Append failure modes to BLINDSPOTS.md
4. Code the feature with Prevention Rules applied
5. Run Post-Flight Detection Methods
6. Commit with diagnostic note
```

### 9.3 Why This Speeds Up Development
- **No reactive debugging loops.** The agent doesn't spend 500 tokens analyzing a crash.
- **Binary verification.** Grep commands give PASS/FAIL in 10 tokens.
- **Cumulative immunity.** Each failure mode added makes the system stronger. The registry is the project's immune system.

### 9.4 BLINDSPOTS.md in the Agent Loop
| File | Purpose | Read Order |
|------|---------|------------|
| CLAUD.md | Context & methodology | 1st |
| HANDOFF.md | Current state & next task | 2nd |
| CONSTRAINTS.md | Hard rules | 3rd |
| FEATURE_LINKS.md | Dependencies | 4th |
| **BLINDSPOTS.md** | **Failure modes for your task** | **5th (if touching risky subsystem)** |

---

