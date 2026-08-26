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
| 2026-08-26 | **Agent-loop files re-synced against the repo.** `HANDOFF.md` was a copy of the root session log describing a Vite/React `app/` that does not exist; replaced with a living-state file. MINDMAP §0 corrected (P1.1 is done, not a blocker). FEATURE_LINKS link matrix rewritten with real statuses + the suite covering each feature, and a `profiles` data contract added. BLINDSPOTS §14 added from a live bug. | Claude Code |
| 2026-08-26 | Signup approval fixed: `profiles` is SELECT-only under RLS, so approvals now go through the `admin-actions` Edge Function (`adminAction()`); `profiles` removed from the outbox pair list; `outboxDrain()` retry bounded so a refused op cannot freeze the queue. New suite `app/approval.test.js` (12 assertions). | Claude Code |
| 2026-08-26 | Skills registry updated: claude-mem accepted; ponytail, code-review and obsidian rejected with reasons. | User |
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
- **Permissions:** the registry is live but the app's 28 `S.role === 'x'` gates still bypass it (P1.8b). Read `hasPermission(key)`, never compare roles, in anything new.
- **Price list context:** 2,610 items live. 110 rows have NULL unit_cost ("quoted separately"). App must display "Quoted Separately" not 0.00. Ten Waha code conflicts parked in backup table — do NOT invent numbers.

---

*This is a living document. Update it after every task. Do not let it drift.*
