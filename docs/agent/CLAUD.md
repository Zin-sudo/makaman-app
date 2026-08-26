# Makaman PWA — Agent Context & Methodology (CLAUD.md)
> **READ THIS FILE FIRST. Every session starts here.**
> **Last updated:** 2026-08-24
> **Update this file EVERY task** — add skills, methodology shifts, architecture notes.

---

## 1. PROJECT PERSONA

### Who We Are Building For
**Makaman** is a Libyan oilfield services company. Their technicians work at remote well sites with unreliable connectivity. The PWA replaces paper Service Tickets and Job Logs.

### What Success Looks Like
- Technician creates a ticket offline, syncs when signal returns
- Ops Manager reviews, assigns ticket number, approves
- Finance downloads Excel that matches the paper ticket exactly
- Observer (formerly "Founder") monitors live activity and adds follow-up notes
- Admin manages users, price lists, numbering series, and permissions

### Critical Context
- **Market:** Libya — Arabic/RTL support is mandatory (P2.4)
- **Connectivity:** Offline-first. No network at wellhead.
- **Devices:** Technicians use phones. Ops uses desktop. Admin uses any.
- **Data sensitivity:** Ticket numbers must never duplicate. Audit trail is legally required.
- **Deployment:** Vercel static site from `app/` directory. Git-based deploy only.

---

## 2. METHODOLOGY

### 2.1 The One-Touch Rule
Each file is edited **once per feature**. If you find yourself returning to the same file for the same feature, stop and consolidate.

### 2.2 Dependency-First Ordering
Never build a dependent feature before its foundation:
1. Schema/tables first
2. Shared utilities (`fmt()`, `money()`, `auditLog()`, `notify()`, `hasPermission()`) first
3. UI components that depend on utilities
4. Features that depend on components

### 2.3 Shared Utilities Over Inline
If the same logic appears in 2+ places, extract it to `app/support.js`.

### 2.4 No Speculative Code
Build exactly what the current task requires. The Feature Registry and Link Map will tell you when a foundation is needed for a future task.

### 2.5 Cross-Feature Linkage
**Golden Rule:** Change Feature A → update Feature B in the same commit if B reads from A. No exceptions. No "I'll come back to it."

### 2.6 Failure-First Development (BLINDSPOTS.md)
Instead of reactive debugging, we derive failure modes *before* they happen:
- **Pre-Flight:** Before coding, check `BLINDSPOTS.md` for failure modes in your subsystem.
- **Prevention:** Apply Prevention Rules proactively.
- **Post-Flight:** Run Detection Method greps (binary PASS/FAIL, ~10 tokens).
- **Append:** If you discover a new failure mode, add it to the registry immediately.

**Why this saves tokens:** A grep check costs 10 tokens. Debugging a production crash costs 500+ tokens. Prevention is 100× cheaper.

### 2.7 Graphify Knowledge Graph
We use Graphify to understand the codebase before editing:
- **Build:** `/graphify .` or `/graphify . --update`
- **Query:** `/graphify query "what depends on <feature>?"`
- **Path:** `/graphify path "ConceptA" "ConceptB"`
- **Explain:** `/graphify explain "Concept"`

**When to use:** Before major refactors, when investigating dependencies, when onboarding to a new subsystem.
**When NOT to use:** Trivial one-line changes, tasks fully described in HANDOFF.md.

---

## 3. SKILLS REGISTRY

### 3.1 Installed Skills

| Skill | Source | Status | Install Command | When to Use |
|-------|--------|--------|-----------------|-------------|
| **graphify** | https://github.com/Graphify-Labs/graphify | ✅ Required | `uv tool install graphifyy && graphify install --project` | Before refactors, dependency analysis |
| **claude-mem** | https://github.com/thedotmack/claude-mem | ✅ Installed | `npx claude-mem install` | Cross-session memory, prevents re-explanation — daily sessions |
| **ponytail** | — | ❌ Rejected | — | Conflicts with BLINDSPOTS.md security rules. Not needed |
| **code-review** | (external) | ❌ Rejected | — | Agent-spawning bug, duplicates BLINDSPOTS.md. Not needed |
| **obsidian** | https://obsidian.md | ❌ Rejected | — | Wrong category, duplicates `docs/agent/*.md`. Not needed |

**claude-mem exclusions** (protect the token budget — configure at install):
`graphify-out/`, `node_modules/`, `app/vendor/`. Tag observations by type:
`decision`, `bugfix`, `architecture`, `blindspot`.

> **Note for remote sessions:** the Claude Code container is ephemeral and rebuilt per
> session, so `npx claude-mem install` does not persist here. Run it on the machine you
> work from; this table is the durable record of the decision either way.

### 3.2 Skills to Evaluate (from https://x.com/VaibhavSisinty/article/2063290847723192610)

The following repos are referenced from the article above. **Do NOT install blindly.** Evaluate each against the criteria below. Install only worthy ones.

**Evaluation Criteria (3+ must be YES):**
1. Reduces token usage on repetitive tasks?
2. Improves code quality or catches bugs?
3. Does NOT duplicate something we already have?
4. Actively maintained and well-documented?
5. Compatible with our stack (static HTML, Supabase, Vercel)?

**Worthy Categories for Makaman:**
- PWA/offline development utilities
- Supabase schema management tools
- Static HTML/dc-runtime helpers
- Excel/PDF generation libraries
- RTL/Arabic text handling tools
- Push notification testing tools

**Current Evaluation Queue:**
| Repo | Category | Evaluated | Worthy? | Notes |
|------|----------|-----------|---------|-------|
| (from article) | — | ⏳ No | — | Review article, evaluate repos |

**Rule:** After evaluating, update this table. If installed, add to Section 3.1. If rejected, note why.

---

## 4. ENVIRONMENT SETUP

### 4.1 Required Tools
| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | Static validation (`npx serve app/`) |
| Python | 3.10+ | Graphify |
| uv | latest | Python tool management (Graphify) |
| Git | 2.40+ | Version control |

### 4.2 Repository
- **Repo:** `Zin-sudo/makaman-app`
- **Branch:** `claude/makaman-app` ONLY
- **Deploy target:** Vercel project `makaman-app`, Root Directory = `app/`

### 4.3 Supabase
- **Project ref:** `igutjfezxkdncrcpvnqx` (`Makaman-app`)
- **Forbidden project:** `makaman-libya` (`vaawlkmbhdbevkylclkf`) — company website, NEVER touch

### 4.4 Local Dev Commands
```bash
# Serve app locally
npx serve app/

# Build Graphify knowledge graph
/graphify .

# Run Playwright overflow check
# (see HANDOFF.md Section 6 for verification script)
```

---

## 5. ARCHITECTURE RATIONALE

### 5.1 Why Static HTML (not React/Vite/Next.js)
- The prototype is already built in dc-runtime static HTML
- Porting to React = 2 rewrites (static first, then migrate)
- `app/` is 427KB single-file — manageable
- dc-runtime bindings (`{{ }}`) are simple and proven

### 5.2 Why Direct Supabase + RLS (not Edge Functions for everything)
- Edge Functions bypass RLS and replicate auth logic
- Direct client + RLS = lower latency, simpler security
- Edge Functions are admin-only (`admin-actions`)

### 5.3 Why localStorage (for now, not IndexedDB yet)
- IndexedDB migration is P1.3 — queued, not skipped
- Current `localStorage` (`makaman.jobtickets.v2`) works for demo
- Migration must be zero-data-loss

### 5.4 Why Graphify
- 71.5× token reduction on codebase queries
- Deterministic AST parsing — no LLM hallucination
- Cross-file dependency tracing
- Surfaces "god nodes" (shared utilities like `auditLog()`, `hasPermission()`)

---

## 6. CHANGE LOG

| Date | What Changed | Updated By |
|------|-------------|------------|
| 2026-08-24 | File created. Added project persona, methodology, skills registry, environment, architecture rationale. | Kimi |
| 2026-08-24 | Added Failure-First Development methodology, BLINDSPOTS.md reference, diagnostic protocol. | Kimi |
| 2026-08-24 | Standing Decision #7 updated: Technician can optionally edit timestamps before "Job Done" (auto by default, audit trail for all edits). | User |
| 2026-08-24 | Standing Decision #26 added: Signed Document Attachment — PDF upload by Tech/Ops, archive for Admin/Ops/Observer, outstanding tasks tracking. | User |
| 2026-08-20 | Price list import complete: 2,610 rows (was 2,274). 336 recovered. unit_cost now nullable. 110 rows are "quoted separately" (display as text, not 0.00). Ten Waha code conflicts parked in backup.price_list_conflicts_20260820. | Claude Code |
| 2026-08-26 | **Notes / Observer follow-ups.** A real table this time, unlike notifications: a note carries its own words and its own state (raised, then answered), and there is nothing to derive that from. Raising and answering write audit entries, so notifications pick them up with no extra wiring. Anyone who can see a ticket may raise one; the office answers. |
| 2026-08-26 | **Notifications, built as a view over the audit trail rather than a table.** A notification is an audit entry you have not read yet, so the only thing stored is how far you have read — one timestamp on `user_settings`. One reducer serves both the Activity tab and the bell, so the count and the list cannot disagree, and the `activity.view_edits` gate is inherited rather than reimplemented. |
| 2026-08-26 | **Tier 4 closed with no migration.** The register listed three schema changes; checking each before building found migration 0002 recoverable verbatim from Supabase, `sort_order` already shipped and working, and the Q1 wording a one-word app change. The register's value was in forcing the check, not in being right. |
| 2026-08-26 | **Stub register (HANDOFF §8) + CONSTRAINTS §21.** Every deferral is registered with the tier it must close in, and a tier cannot be declared done while a row against it is open. Its first application caught a HANDOFF line still describing a stub that had been implemented two commits earlier. |
| 2026-08-26 | **A full device no longer loses a technician's work in silence.** Every localStorage write swallowed its quota error, so a refused save left the job-log line on screen and never on disk. `persist()` now reports, sheds what can be rebuilt, retries, and raises a standing banner on every screen until a write gets through. The shed never touches the tickets or the outbox. |
| 2026-08-26 | **The Excel export fills the real workbook.** It used to log "4 sheets downloaded" and download nothing. It now patches the template's cell values in place — 55 of 60 parts come back byte-identical, so the customer gets their own form, filled. The template's inherited 60% discount and 20% surcharge formulas are replaced by the app's figures so the workbook cannot disagree with the signed PDF. |
| 2026-08-26 | **Build order fixed, with dependencies** (HANDOFF §7). Seven tiers. Two rules encoded: screens before styles, engine before features. The CSS responsive theme v2 is Tier 6 — after every screen exists, gated on approved mockups. The "Apper" skill is Tier 7, explicitly after the PWA is finished. §6's theme-vs-RTL sequencing is retired: RTL was cancelled, so its premise is gone. |
| 2026-08-26 | **The PDF is the A4 preview again.** The two renderers had drifted — the preview grew the designed form, the PDF stayed a plain list of lines. Both now scale from one `SHEET` constant, and `mksheet.test.js` fails if they separate. The sheet is also sealed against the app's own stylesheets. |
| 2026-08-26 | **Arabic content, not an Arabic interface.** UI mirroring reverted on instruction (migration 0025 drops 0024's column). Noto Sans Arabic vendored and precached; `dir="auto"` on every free-text field; an embedded face so Arabic customer names stop printing as Latin-1 rubbish. |
| 2026-08-26 | **The technician's app fits the screen it is on.** The 760px column steps up to 1420px and the extra width buys more cards, not longer lines. |
| 2026-08-26 | **Agent-loop files re-synced against the repo.** `HANDOFF.md` was a copy of the root session log describing a Vite/React `app/` that does not exist; replaced with a living-state file. MINDMAP §0 corrected (P1.1 is done, not a blocker). FEATURE_LINKS link matrix rewritten with real statuses + the suite covering each feature, and a `profiles` data contract added. BLINDSPOTS §14 added from a live bug. | Claude Code |
| 2026-08-26 | Signup approval fixed: `profiles` is SELECT-only under RLS, so approvals now go through the `admin-actions` Edge Function (`adminAction()`); `profiles` removed from the outbox pair list; `outboxDrain()` retry bounded so a refused op cannot freeze the queue. New suite `app/approval.test.js` (12 assertions). | Claude Code |
| 2026-08-26 | Skills registry updated: claude-mem accepted; ponytail, code-review and obsidian rejected with reasons. | User |
| 2026-08-26 | Responsive theme v2 stored at `reference/makaman-responsive-theme-v2.css` — **not wired in**. Three blockers recorded in HANDOFF §5: a Google Fonts `@import` that breaks CONSTRAINTS §5, a `data-perm-*` vocabulary that does not match the permission registry, and a different accent palette. | User |
| 2026-08-26 | **Master workbook of approved jobs.** One row per approved ticket, defined as a *view* so finance's row shape is data not code; rebuilt (never appended) into a private Storage bucket by Edge Function `master-export`; served by a 60-second signed link; freshness from `export_runs`. Scheduled by a pg_cron watermark rather than a per-approval trigger, to avoid ten approvals racing to overwrite one file. Migrations 0020–0022. Advisor caught the view defaulting to SECURITY DEFINER (an RLS bypass) and the rebuild function being callable by any signed-in user — both fixed. **Verified end to end 2026-08-26**: 200/ok, a real 17,873-byte .xlsx in the bucket. The first attempt failed 401 because the function compared the caller's token to `SUPABASE_SERVICE_ROLE_KEY` (the *legacy* JWT) while the project uses the newer `sb_secret_` format — migration 0023 replaces the comparison with a single-use nonce, so **no credential is stored anywhere**. New suite `app/excel.test.js` (14). | Claude Code |
| 2026-08-26 | **Disable, not delete.** The schema refuses a profile delete (ticket/audit FKs are NO ACTION) and would erase crew rows where it succeeded (CASCADE), so access is withdrawn by `status='disabled'` and the row is kept — which is what the dialog had always promised. `set_user_status` on admin-actions v2, Admin only, master Admin and self refused server-side. `user.delete` → `user.disable`. Migrations 0018–0019; 0018's constraint was inert until 0019 retired the older CHECK on the same column. New suite `app/disable.test.js` (18). | Claude Code |
| 2026-08-26 | **Per-ticket log in Review.** The container existed but was ungated — and the Observer reaches that screen, so the edit history of every ticket leaked to them even after the Activity tab was fixed. Same capability, second place. Now gated on `activity.view_edits`, showing who made each entry (`by` was always stored, never displayed) and labelling Stage vs Edit. New suite `app/reviewlog.test.js` (15). | Claude Code |
| 2026-08-26 | **Role swap.** `user.act_as_technician` (migration 0017). The swap *narrows* capabilities to the acted role, the way back is keyed on being swapped rather than on a permission, attribution never leaves the real person, and nothing is written to `profiles`. Survives a reload; per device only. New helper `activeTechnicians()`, new suite `app/swap.test.js` (22). 217 assertions across 13 suites. | Claude Code |
| 2026-08-26 | **P1.8b — the gates now read the registry.** 11 capability gates converted to `hasPermission()`; 18 presentation/routing comparisons kept as roles deliberately. The conversion exposed that `activity.view_all` was two capabilities under one name — the Observer sees every ticket's stages but not the edit trail — so migration 0016 splits out `activity.view_edits`. 195 assertions across 12 suites, 0 failures. | Claude Code |
| 2026-08-26 | **P1.8 permission registry** — `permissions` (31 capabilities) + `user_permissions`, `has_permission()` / `effective_permissions()` / `my_permissions()`, `hasPermission()` in the app, admin Permissions page in Account. Migrations 0013–0015. Security advisor caught two definer functions reachable by `anon`; 0015 scopes them. New suite `app/permissions.test.js` (23). BLINDSPOTS §15 added. **The 28 existing role comparisons are not yet converted — tracked as P1.8b.** | Claude Code |

---

## 7. QUICK REFERENCE

### Before Every Task
1. Read this file (CLAUD.md)
2. Read HANDOFF.md for current state and next task
3. Read CONSTRAINTS.md for hard rules
4. Read FEATURE_LINKS.md for dependencies
5. **Read BLINDSPOTS.md if your task touches a failure-prone subsystem**
6. Query Graphify if cross-file impact is unclear

### After Every Task
1. Update CLAUD.md if methodology/skills/architecture changed
2. Update HANDOFF.md (mark done, set next task)
3. Update FEATURE_LINKS.md if dependencies changed
4. **Update BLINDSPOTS.md if you discovered a new failure mode**
5. Run Post-Flight Detection Methods (binary grep checks)
6. Commit all `docs/agent/*.md` files with code changes
7. Push to `claude/makaman-app`

### Emergency Contacts (Conceptual)
- **If stuck >30 min:** Check if duplicating existing code. Check FEATURE_LINKS.md. Query Graphify.
- **If breaking a constraint:** STOP. Log blocker. Do not proceed.
- **If unsure about a decision:** Check MINDMAP.md Standing Decisions. Do not re-derive.
- **Permissions:** live and honoured. Gate a **capability** with `hasPermission(key)`; a role comparison is still correct for **presentation and routing** (which page a role lands on, phone frame vs desk nav, screen titles). Converting those would let a permission toggle break navigation — see HANDOFF §2c.
- **Price list context:** 2,610 items live. 110 rows have NULL unit_cost ("quoted separately"). App must display "Quoted Separately" not 0.00. Ten Waha code conflicts parked in backup table — do NOT invent numbers.

---

*This is a living document. Update it after every task. Do not let it drift.*
