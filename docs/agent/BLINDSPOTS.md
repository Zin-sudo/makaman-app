# Makaman — Blind Spots & Failure Mode Registry
> **Pre-mortem analysis: every failure mode we can derive before it happens in production.**
> **Read this BEFORE starting any task. Reference entries by ID in commit messages.**
> **Last updated:** 2026-08-24

---

## How to Use This File

### For Agents (Before Every Task)
1. Check if your task touches any subsystem listed below.
2. Read the failure modes for that subsystem.
3. Apply the **Prevention Rule** proactively.
4. After coding, run the **Detection Method** to verify you didn't introduce the failure.

### For Humans (Reviewing Agent Output)
If an agent's commit touches a subsystem with 🔴 or 🟡 severity below, verify the Detection Method was run.

---

## Severity Legend
| Icon | Level | Meaning |
|------|-------|---------|
| 🔴 | **Crash** | App becomes unusable. Data loss possible. |
| 🟡 | **Bug** | Feature broken or data incorrect. Workaround may exist. |
| 🟠 | **Performance** | App slows, battery drains, or memory leaks. |
| 🔵 | **Security** | Unauthorized access or data exposure. |
| ⚪ | **UX** | Confusing behavior. No data loss. |

---

## 1. OFFLINE STORAGE (`localStorage` → IndexedDB)

### B-1.1 🔴 localStorage 5MB Quota Exceeded
**Symptom:** App crashes on ticket creation. `QuotaExceededError` in console. Unsynced tickets lost.
**Root Cause:** Price list cache (2,274 items) + ticket queue + audit log buffer exceeds 5MB. `localStorage` has no eviction policy.
**Prevention Rule:**
- NEVER store price lists in `localStorage`. Cache in memory only, or use IndexedDB (P1.3).
- NEVER store `audit_log` entries locally. They are server-only.
- Monitor `JSON.stringify(localStorage).length` before every write. If >4MB, alert user.
**Detection Method:**
```bash
# Grep for localStorage.setItem without size check
grep -n "localStorage.setItem" app/support.js app/index.html
# If found without preceding length check → FAIL
```
**Linked Rule:** CONSTRAINTS.md §6 (Offline-first)

### B-1.2 🔴 Data Corruption on Write Interruption
**Symptom:** Ticket appears in list but is missing lines/items. Or `JSON.parse()` throws on load.
**Root Cause:** Browser crash/tab close during `localStorage.setItem()` leaves partial write.
**Prevention Rule:**
- ALWAYS write to a temp key first, then atomic rename:
  ```js
  localStorage.setItem('makaman.temp', JSON.stringify(data));
  localStorage.setItem('makaman.jobtickets.v2', localStorage.getItem('makaman.temp'));
  localStorage.removeItem('makaman.temp');
  ```
- NEVER write directly to the primary key.
**Detection Method:**
```bash
grep -n "localStorage.setItem.*makaman" app/support.js
# If any line writes directly to primary key without temp key → FAIL
```

### B-1.3 🟡 Queue Grows Unbounded During Long Offline Period
**Symptom:** App takes 30+ seconds to open. Sync never completes. Out of memory.
**Root Cause:** Technician offline for 3 days accumulates 50+ tickets. Each sync attempt retries ALL 50.
**Prevention Rule:**
- Queue must have a MAX_SIZE (e.g., 100 tickets). When exceeded, force user to sync or delete old drafts.
- Sync must be chunked: max 10 tickets per batch.
**Detection Method:**
```bash
grep -n "queue" app/support.js | grep -i "length\|size\|batch\|chunk"
# If no max length or batching logic found → FAIL
```

---

## 2. SUPABASE RLS & AUTH

### B-2.1 🔵 RLS Policy Silently Returns Empty Instead of Error
**Symptom:** Ticket list is empty. User thinks there are no tickets. Actually, RLS is misconfigured.
**Root Cause:** RLS `USING` clause is too restrictive. No error is thrown — just empty result.
**Prevention Rule:**
- Every SELECT query in app MUST check `data.length === 0` and distinguish "no data" from "no permission."
- If `data.length === 0` AND user has permission, show "No tickets found." If permission missing, show "Access denied."
**Detection Method:**
```bash
grep -n "\.select\|\.from" app/support.js app/index.html | head -20
# For each SELECT, check if result handling distinguishes empty vs denied → if not → FAIL
```

### B-2.2 🔴 Auth Token Refresh Failure in Background
**Symptom:** User clicks "Save" and nothing happens. No error shown. Token expired 2 hours ago.
**Root Cause:** Supabase auto-refresh fails silently in background tab. App doesn't detect stale token.
**Prevention Rule:**
- EVERY write operation MUST check `supabase.auth.getSession()` before executing.
- If session is null or expires in <5 min, redirect to login with "Session expired. Please log in again."
- NEVER assume the session is valid because the user is "logged in."
**Detection Method:**
```bash
grep -n "getSession\|onAuthStateChange" app/support.js app/index.html
# If no getSession guard found before writes → FAIL
```

### B-2.3 🟠 Realtime Subscription Drops Without Error
**Symptom:** Ops Manager doesn't see new tickets. Notifications stop. No error in console.
**Root Cause:** Supabase Realtime channel times out or hits max connections. No reconnect logic.
**Prevention Rule:**
- EVERY Realtime subscription MUST have `.on('system', ...)` handler for `disconnected` / `error` events.
- MUST implement exponential backoff reconnect (max 5 retries, then show "Connection lost" banner).
**Detection Method:**
```bash
grep -n "supabase.channel\|Realtime" app/support.js app/index.html
# If no 'system' event handler or reconnect logic → FAIL
```

### B-2.4 🟠 429 Rate Limiting at 6PM (B4 in MINDMAP.md)
**Symptom:** All 50 technicians get "Something went wrong" at shift end. Supabase returns 429.
**Root Cause:** Everyone presses "Job Done" simultaneously. No client-side rate limiting.
**Prevention Rule:**
- Implement client-side request queue with debounce (max 1 req/sec per user).
- Show "Syncing..." spinner with queue position if backed up.
- NEVER fire multiple Supabase requests in parallel from the same user action.
**Detection Method:**
```bash
grep -n "Promise.all\|await.*await" app/support.js | head -10
# If parallel Supabase calls found without throttling → FAIL
```

---

## 3. TICKET NUMBERING & RESERVATION

### B-3.1 🔴 Race Condition: Two Ops Click "Take Next" Simultaneously
**Symptom:** Two tickets get the same number. Finance finds duplicates. Legal issue.
**Root Cause:** "Take next" reads `next_number`, increments, writes back — non-atomic in client-side JS.
**Prevention Rule:**
- "Take next" MUST use Supabase RPC or Edge Function with `SELECT ... FOR UPDATE` or atomic increment.
- NEVER implement "take next" as read-then-write in client JS.
**Detection Method:**
```bash
grep -n "take next\|next_number\|reserved_by" app/support.js app/index.html
# If "take next" logic is client-side read-then-write → FAIL
```

### B-3.2 🟡 Reservation Not Released on Browser Crash
**Symptom:** Number sequence has gaps. "Next" number jumps ahead. Unused reservations pile up.
**Root Cause:** Ops Manager reserves a number, browser crashes before approve/cancel. `reserved_by` stays set.
**Prevention Rule:**
- Auto-cleanup MUST be server-side (Supabase cron job or Edge Function), NOT client-side.
- Cleanup runs every hour: `UPDATE numbering_series SET reserved_by = NULL WHERE reserved_at < now() - interval '1 hour' AND used = false`.
- Client can trigger cleanup on load, but MUST NOT rely on it.
**Detection Method:**
```bash
grep -n "reserved_at\|auto.*clean\|cron" app/support.js supabase/
# If cleanup logic is client-side only (setTimeout, interval) → FAIL
```

### B-3.3 🟡 Number Assigned but Ticket Never Approved
**Symptom:** Number MKN-1882 is "used" but no approved ticket exists. Sequence gap.
**Root Cause:** Ticket gets number, then Ops Manager reopens it (status → `awaiting_review`), then abandons it.
**Prevention Rule:**
- Reopening a ticket MUST release the number reservation (set `reserved_by = NULL`, `used = false`).
- Number becomes "used = true" ONLY on approval, not on assignment.
**Detection Method:**
```bash
grep -n "reopen\|release.*number\|used = true" app/support.js
# If reopen logic doesn't release number → FAIL
```

---

## 4. ITEM ORDERING & DRAG-AND-DROP

### B-4.1 🟡 Touch DnD Conflicts with Scroll on Mobile
**Symptom:** Ops Manager tries to drag item on tablet, but page scrolls instead. Item doesn't move.
**Root Cause:** Touch event handlers for DnD intercept scroll gestures. No `touch-action: pan-y` or threshold.
**Prevention Rule:**
- DnD touch handlers MUST use a 10px movement threshold before initiating drag.
- CSS must set `touch-action: pan-y` on the container so vertical scroll isn't blocked.
- Test on actual tablet, not just Chrome DevTools.
**Detection Method:**
```bash
grep -n "touchstart\|touchmove\|touch-action" app/support.js app/theme.css
# If touch handlers exist without threshold or touch-action → FAIL
```

### B-4.2 🟡 order_index Collisions After Multiple Reorders
**Symptom:** Items appear in wrong order after several drag-and-drop operations. Sort is unstable.
**Root Cause:** Dragging item between two others sets `order_index = (prev + next) / 2`. After many operations, floats collide or precision is lost.
**Prevention Rule:**
- `order_index` MUST be integer. After any reorder operation, renumber ALL items sequentially (0, 1, 2, 3...) in a single transaction.
- NEVER use fractional indices.
**Detection Method:**
```bash
grep -n "order_index" app/support.js
# If order_index is set to a non-integer or fractional value → FAIL
```

---

## 5. EXCEL / PDF GENERATION

### B-5.1 🔴 Memory Crash on Large Ticket Export
**Symptom:** App freezes, then tab crashes with "Out of Memory" when generating Excel for 24-item ticket.
**Root Cause:** SheetJS or similar loads entire workbook into memory. 24 items × formulas × styling = 50MB+ heap.
**Prevention Rule:**
- Excel generation MUST be streamed or offloaded to Edge Function.
- If client-side, use lightweight library (not full SheetJS). Or use Edge Function + `xlsx-template`.
- NEVER generate Excel in the main thread for >10 items.
**Detection Method:**
```bash
grep -n "xlsx\|SheetJS\|excel\|workbook" app/support.js app/index.html
# If full SheetJS is imported and used client-side for >10 items → FAIL
```

### B-5.2 🟡 Arabic Text Rendering as Gibberish in Excel
**Symptom:** Arabic customer names appear as `????` or squares in downloaded Excel.
**Root Cause:** Excel template font doesn't support Arabic. Or JS string encoding issue.
**Prevention Rule:**
- Template MUST use a font with Arabic glyphs (e.g., Arial, Tahoma, or Noto Sans Arabic).
- All text MUST be UTF-8 encoded. Test with `encodeURIComponent(arabicText)` before write.
**Detection Method:**
```bash
grep -n "UTF-8\|arabic\|Noto\|Tahoma" app/support.js reference/
# If no Arabic font or encoding check found → FLAG (not fail — P2.4)
```

### B-5.3 🟠 Blob URL Memory Leak
**Symptom:** App slows over time. Memory profiler shows detached Blob URLs accumulating.
**Root Cause:** `URL.createObjectURL()` called for every download, but `URL.revokeObjectURL()` never called.
**Prevention Rule:**
- EVERY `createObjectURL()` MUST have a matching `revokeObjectURL()` within 30 seconds or on `beforeunload`.
**Detection Method:**
```bash
grep -n "createObjectURL" app/support.js app/index.html
# Count createObjectURL vs revokeObjectURL. If counts don't match → FAIL
```

---

## 6. NOTIFICATIONS & PUSH

### B-6.1 🟡 Push Subscription Expires Silently
**Symptom:** Notifications stop arriving. User doesn't know. Ops Manager misses urgent tickets.
**Root Cause:** VAPID subscription expires after ~30 days. No re-subscription logic.
**Prevention Rule:**
- On every app load, check `pushManager.getSubscription()`. If null or expired, re-subscribe.
- Store subscription `expirationTime` in `localStorage`. Check daily.
**Detection Method:**
```bash
grep -n "getSubscription\|expirationTime\|pushManager" app/support.js app/sw.js
# If no expiration check or re-subscription logic → FAIL
```

### B-6.2 🟠 Notification Flood on Bulk Approve
**Symptom:** Ops Manager approves 20 tickets at once. Technician gets 20 push notifications. Phone vibrates for 2 minutes.
**Root Cause:** Each approve triggers independent notification. No batching.
**Prevention Rule:**
- Notifications MUST be batched: if >3 notifications for same recipient within 60 seconds, send single "3 tickets approved" summary.
- Use Supabase `pg_cron` or Edge Function to aggregate before insert.
**Detection Method:**
```bash
grep -n "notify\|notification" app/support.js supabase/
# If notify() is called in a loop without batching guard → FAIL
```

### B-6.3 🔴 Service Worker Update Kills Old Push Handlers
**Symptom:** After app update, push notifications stop. SW is new but push subscription points to old handler.
**Root Cause:** New `sw.js` is installed but old push event listeners are gone. Subscription still points to old endpoint logic.
**Prevention Rule:**
- `sw.js` MUST handle `push` event in EVERY version. Never remove it.
- On SW update, re-register push subscription to ensure endpoint is current.
**Detection Method:**
```bash
grep -n "push" app/sw.js
# If sw.js has no 'push' event listener → FAIL
```

---

## 7. PERMISSIONS SYSTEM

### B-7.1 🔵 hasPermission() Returns Stale Cached Value
**Symptom:** Admin disables a permission for a user. User still sees the feature until hard refresh.
**Root Cause:** `hasPermission()` caches role defaults in `localStorage` or memory. No invalidation on permission change.
**Prevention Rule:**
- `hasPermission()` MUST query `user_permissions` from Supabase on every app load.
- Cache in memory only (not `localStorage`). TTL = 5 minutes max.
- After Admin changes a permission, broadcast Realtime event to force refresh.
**Detection Method:**
```bash
grep -n "hasPermission\|localStorage.*permission\|permission.*cache" app/support.js
# If permissions are cached in localStorage without TTL → FAIL
```

### B-7.2 🔵 Role Change Doesn't Invalidate JWT
**Symptom:** User is promoted to Admin. Still has old Technician JWT. Can access admin features via old token.
**Root Cause:** JWT contains `role` claim. Supabase doesn't auto-refresh JWT on role change.
**Prevention Rule:**
- After ANY role change, force sign-out and re-login.
- RLS policies MUST check `profiles.role` (DB lookup) NOT `auth.jwt()->>role` (stale claim).
**Detection Method:**
```bash
grep -n "jwt.*role\|auth.jwt" supabase/migrations/
# If RLS uses JWT role claim instead of DB lookup → FAIL
```

---

## 8. AUDIT LOG

### B-8.1 🟠 Audit Log Grows Unbounded → DB Bloat
**Symptom:** Supabase queries slow down. `audit_log` table is 500MB+.
**Root Cause:** Every timestamp edit, item add, price override writes a row. No retention policy.
**Prevention Rule:**
- Implement tiered retention: keep 90 days in hot table, archive older to Supabase Storage (CSV).
- Add `created_at` index. Partition by month if possible.
**Detection Method:**
```bash
grep -n "audit_log\|retention\|archive" supabase/migrations/
# If no retention or partitioning strategy → FLAG (not fail — post-launch)
```

### B-8.2 🔴 Audit Log Write Fails but Main Transaction Succeeds
**Symptom:** Ticket is approved but no audit entry. Compliance gap.
**Root Cause:** `auditLog()` is called after the main UPDATE. If audit INSERT fails, main transaction already committed.
**Prevention Rule:**
- Audit log MUST be written in the SAME database transaction as the main operation.
- Use Supabase RPC or Edge Function that wraps both in a single transaction.
- NEVER call `auditLog()` as a separate client-side INSERT after the main write.
**Detection Method:**
```bash
grep -n "auditLog\|audit_log" app/support.js
# If auditLog() is called as separate supabase.from('audit_log').insert() after main write → FAIL
```

---

## 9. DC-RUNTIME & STATIC HTML

### B-9.1 🔴 Inline Ternary in {{ }} Binding Causes Silent Render Failure
**Symptom:** Part of the page is blank. No error in console. dc-runtime silently skips the binding.
**Root Cause:** dc-runtime doesn't support ternaries inside `{{ }}`. `{{ isAdmin ? 'Admin' : 'User' }}` fails silently.
**Prevention Rule:**
- NEVER use ternaries in `{{ }}`. Precompute in JS and bind to a plain variable.
- Use `data-perm-*` attributes for conditional visibility, not template logic.
**Detection Method:**
```bash
grep -n '{{.*?' app/index.html | grep -E '\?.*:'
# If any {{ }} contains ? and : → FAIL
```

### B-9.2 🔴 Missing Data Property Causes "undefined" to Render
**Symptom:** Page shows "undefined" or "[object Object]" in random places.
**Root Cause:** dc-runtime binds to `data.fieldName` but `fieldName` is undefined or missing in the data object.
**Prevention Rule:**
- EVERY data object passed to dc-runtime MUST be validated with a schema check before render.
- Use `data.fieldName || ''` as fallback in JS, not in template.
**Detection Method:**
```bash
grep -n "data\..*=" app/support.js | head -20
# If data objects are built without default values for all bound fields → FLAG
```

### B-9.3 🟠 Template Re-Render Wipes DOM Event Listeners
**Symptom:** Button clicks stop working after data update. No error.
**Root Cause:** dc-runtime re-renders template, replacing DOM nodes. Event listeners attached directly to old nodes are lost.
**Prevention Rule:**
- ALWAYS use event delegation (`document.addEventListener('click', ...)` with selector check) or re-attach listeners after every render.
- NEVER attach `element.onclick = ...` to nodes inside a dc-runtime template.
**Detection Method:**
```bash
grep -n "\.onclick\|\.addEventListener" app/support.js app/index.html | grep -v "document"
# If event listeners are attached directly to template elements → FAIL
```

### B-9.4 🟠 Service Worker Serves Stale index.html After Deploy
**Symptom:** User sees old UI but new Supabase schema. Forms submit to non-existent columns. Errors everywhere.
**Root Cause:** `sw.js` caches `index.html` aggressively. New deploy doesn't invalidate cache.
**Prevention Rule:**
- `sw.js` MUST include `Cache-Control: no-cache` for `index.html`.
- On app load, check `fetch('/version.json')` against cached version. If mismatch, force reload.
- NEVER cache `config.js` — it contains Supabase keys that may rotate.
**Detection Method:**
```bash
grep -n "cache\|Cache" app/sw.js
# If sw.js caches index.html or config.js without version check → FAIL
```

---

## 10. GENERAL APP ARCHITECTURE

### B-10.1 🔴 One JS Error Kills Entire App (No Error Boundaries)
**Symptom:** White screen. Nothing works. User must reload.
**Root Cause:** Static HTML has no React error boundaries. One unhandled exception stops all JS.
**Prevention Rule:**
- EVERY async function MUST have `.catch()` or `try/catch`.
- Wrap `dc-runtime` render calls in `try/catch`. On error, show "Something went wrong. Please reload." instead of white screen.
- Use `window.onerror` and `window.onunhandledrejection` to log to `audit_log` or console.
**Detection Method:**
```bash
grep -n "try\|catch\|onerror\|unhandledrejection" app/support.js app/index.html | wc -l
# If <5 occurrences in a 427KB file → FAIL
```

### B-10.2 🔵 Hardcoded Keys in config.js Committed to Repo
**Symptom:** Supabase keys leaked. Security incident.
**Root Cause:** `config.js` contains `VITE_SUPABASE_ANON_KEY`. Committed to GitHub.
**Prevention Rule:**
- `config.js` MUST read from environment variables at build time, or use `.env` file excluded from Git.
- NEVER commit actual keys. Use placeholder values in repo.
**Detection Method:**
```bash
grep -E "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9|supabase.*key" app/config.js
# If real-looking key is present → FAIL
```

### B-10.3 🟠 No Session Timeout → Unlocked Phone = Exposed
**Symptom:** Technician leaves phone unlocked at well site. Anyone can access all tickets.
**Root Cause:** No auto-lock or session timeout.
**Prevention Rule:**
- Implement idle timeout: after 5 minutes of no interaction, blur screen and require PIN/biometric.
- Store last activity timestamp in `localStorage`. Check on every route change.
**Detection Method:**
```bash
grep -n "idle\|timeout\|lastActivity\|blur" app/support.js
# If no idle timeout logic → FLAG (post-launch)
```

---



---

## 11. TIMESTAMP EDITING (Technician + Ops/Admin)

> **Standing Decision #7 (Updated 2026-08-24):** Auto-captured by default. Technician MAY optionally edit ticket-level AND line-level timestamps before pressing "Job Done". After "Job Done", timestamps are locked. Ops/Admin can edit at any time. Every edit -> `audit_log` with old→new values, editor role, and reason.

### B-11.1 🔴 Technician Edits Timestamp After "Job Done"
**Symptom:** Approved ticket has timestamps that don't match rig records. Compliance audit fails.
**Root Cause:** UI doesn't lock timestamp fields after "Job Done" is pressed. Or RLS policy allows `timestamp_edited` events on `status != 'logging'` tickets.
**Prevention Rule:**
- Timestamp input fields MUST be `disabled` when `ticket.status != 'logging'`.
- RLS policy on `audit_log` MUST reject `timestamp_edited` events where `ticket.status != 'logging'` AND `editor_role = 'technician'`.
- Client-side check is NOT enough — RLS must enforce.
**Detection Method:**
```bash
grep -n "timestamp.*disabled\|status.*logging\|timestamp_edited" app/support.js app/index.html
# If no disabled state tied to status check → FAIL
grep -n "timestamp_edited\|editor_role" supabase/migrations/
# If RLS doesn't restrict technician timestamp edits by status → FAIL
```
**Linked Rule:** CONSTRAINTS.md §7, MINDMAP.md §5.1 #7

### B-11.2 🔴 Future Timestamp Submitted
**Symptom:** Ticket shows arrival time of 2027-01-01. Impossible. Data integrity compromised.
**Root Cause:** No validation that edited timestamp is not in the future.
**Prevention Rule:**
- EVERY timestamp edit (by any role) MUST validate `new_timestamp <= now()`.
- If future timestamp entered, show error: "Timestamp cannot be in the future."
- Validation MUST be on client AND server (RLS or trigger).
**Detection Method:**
```bash
grep -n "Date.now\|new Date\|<= now\|future" app/support.js
# If no future-date validation found → FAIL
```

### B-11.3 🔴 Timestamp Before Ticket Creation
**Symptom:** Ticket created at 14:00 but shows arrival at 08:00 (before creation). Logical impossibility.
**Root Cause:** No validation that `arrival_at >= created_at` or that line timestamps are within ticket window.
**Prevention Rule:**
- `arrival_at` MUST be >= `ticket.created_at`.
- `start_job_at` MUST be >= `arrival_at`.
- `end_job_at` MUST be >= `start_job_at`.
- Line-level timestamps MUST be within `arrival_at` and `end_job_at`.
- Validation on client AND server.
**Detection Method:**
```bash
grep -n "created_at\|arrival_at\|start_job_at\|end_job_at" app/support.js | grep -i "valid\|check\|>=\|<=" | head -10
# If no chronological validation logic → FAIL
```

### B-11.4 🔵 Technician Edits Without Audit Trail
**Symptom:** Compliance audit shows timestamp changed but no `audit_log` entry. Who changed it? When? Why?
**Root Cause:** `auditLog()` call is forgotten in the technician timestamp edit flow.
**Prevention Rule:**
- Timestamp edit UI MUST call `auditLog()` BEFORE the Supabase UPDATE returns success.
- `auditLog()` MUST include: `{ field, old_value, new_value, editor_role: 'technician', reason: user_provided_reason }`.
- NEVER allow timestamp update without corresponding audit log entry.
**Detection Method:**
```bash
grep -n "timestamp.*edit\|timestamp.*update\|auditLog" app/support.js
# For every timestamp edit path, verify auditLog() is called in same function → if not → FAIL
```

### B-11.5 🟡 Line-Level Timestamps Don't Match Ticket-Level Window
**Symptom:** Ticket says job ran 08:00–16:00, but a line item shows 18:00. Inconsistent data.
**Root Cause:** Line-level timestamp editing doesn't validate against ticket-level `arrival_at` / `end_job_at`.
**Prevention Rule:**
- When editing a `ticket_lines.timestamp`, validate it falls within `ticket.arrival_at` and `ticket.end_job_at`.
- If outside window, warn user: "This timestamp is outside the ticket time window. Continue?"
**Detection Method:**
```bash
grep -n "ticket_lines.*timestamp\|line.*timestamp" app/support.js | grep -i "valid\|check\|window\|arrival\|end_job"
# If no window validation for line timestamps → FLAG
```

### B-11.6 🟠 Offline Device Syncs Stale Timestamp Edit
**Symptom:** Technician edits timestamp offline. Meanwhile, Ops Manager approves ticket online. Sync resolves with old timestamp, overwriting approval-time data.
**Root Cause:** No conflict resolution for timestamp edits on approved tickets.
**Prevention Rule:**
- If ticket status on server is `approved` or `awaiting_review`, reject any client-side timestamp edits from technician.
- Sync logic MUST check server status before applying local timestamp changes.
- If conflict detected, show user: "Ticket was updated by Ops Manager. Your timestamp edit was not applied."
**Detection Method:**
```bash
grep -n "sync\|conflict\|approved.*edit\|status.*check" app/support.js | grep -i "timestamp\|line"
# If sync logic doesn't check server status before applying timestamp edits → FLAG
```

### B-11.7 ⚪ Technician Forgets to Edit, Auto-Stamp Is Wrong
**Symptom:** Technician intended to align with rig records but forgot to edit. Auto timestamp is off by 2 hours. Ops Manager rejects ticket.
**Root Cause:** No visual reminder that timestamp is auto-captured and MAY need adjustment.
**Prevention Rule:**
- Timestamp field MUST show visual indicator: "Auto-captured — tap to edit if needed".
- If timestamp is edited, show "Edited by technician" badge.
- If NOT edited, show "Auto — verify" badge in subtle color.
**Detection Method:**
```bash
grep -n "auto.*timestamp\|tap to edit\|verify\|badge" app/support.js app/index.html | grep -i "timestamp"
# If no visual indicator for auto vs edited timestamp → FLAG (UX, not crash)
```

---



---

## 12. SIGNED DOCUMENT ATTACHMENT (PDF Upload & Outstanding Tasks)

> **Standing Decision #26 (Added 2026-08-24):** After technician downloads sheets and obtains physical signature/stamp, either technician or ops manager may attach a scanned PDF of the signed documents to the approved ticket. PDF format only. Stored in Supabase Storage with DB reference. Accessible by Admin, Ops Manager, and Observer. Technicians and Ops Managers can view an "Outstanding Tasks" list showing approved tickets missing signed documents.

### B-12.1 🔵 Non-PDF File Upload Accepted
**Symptom:** Malicious `.exe` or `.html` file uploaded as "signed document." User opens it, malware executes.
**Root Cause:** Client-side validation only (checking file extension). Server accepts any MIME type.
**Prevention Rule:**
- `mime_type` column MUST have `CHECK (mime_type = 'application/pdf')` at database level.
- Supabase Storage bucket MUST have file type filter configured.
- Client MUST check `file.type === 'application/pdf'` before upload.
- NEVER rely on file extension alone.
**Detection Method:**
```bash
grep -n "mime_type\|application/pdf\|file.type" app/support.js app/index.html supabase/migrations/
# If no DB-level CHECK constraint on mime_type → FAIL
# If client only checks file extension (endsWith('.pdf')) → FAIL
```

### B-12.2 🔴 Large PDF Upload Crashes Browser Tab
**Symptom:** Technician selects 50MB scan. Browser freezes, then "Aw, snap!" Tab reloads, ticket data lost.
**Root Cause:** File is read entirely into memory before upload. No size limit or chunking.
**Prevention Rule:**
- MAX file size: 10MB. Check `file.size` before upload. Show error if exceeded.
- Use chunked upload (resumable) for files >5MB.
- Show progress bar so user knows upload is in progress.
- NEVER read entire file into a base64 string in memory.
**Detection Method:**
```bash
grep -n "file.size\|MAX_SIZE\|10MB\|chunk" app/support.js app/index.html
# If no size validation or chunking logic → FAIL
```

### B-12.3 🟡 Orphan File in Supabase Storage (DB Record Deleted, File Remains)
**Symptom:** Storage bucket grows to 50GB. Admin sees files with no linked tickets. Cannot clean up safely.
**Root Cause:** Ticket is deleted (or document record deleted) but Supabase Storage file is not removed. No cascade delete.
**Prevention Rule:**
- `ON DELETE CASCADE` on `ticket_id` FK deletes the DB record, but NOT the Storage file.
- MUST implement a Supabase trigger or Edge Function that deletes the Storage object when `ticket_documents` row is deleted.
- OR use a periodic cleanup job that finds Storage objects with no DB reference.
**Detection Method:**
```bash
grep -n "storage\|delete.*file\|remove.*object" app/support.js supabase/migrations/ supabase/functions/
# If no Storage cleanup logic on ticket/document deletion → FAIL
```

### B-12.4 🔵 Storage Bucket Is Public — Anyone with URL Can Access
**Symptom:** Signed document URL is leaked. Competitor or unauthorized party views confidential rig data.
**Root Cause:** Supabase Storage bucket has `public` access policy. No signed URLs or RLS.
**Prevention Rule:**
- Storage bucket MUST be `private`.
- Files MUST be served via signed URLs with expiration (e.g., 1 hour).
- `ticket_documents` RLS MUST restrict SELECT to Admin, Ops Manager, Observer (and uploaders for their own).
- NEVER return a permanent public URL to the client.
**Detection Method:**
```bash
grep -n "public.*bucket\|publicUrl\|signedUrl\|createSignedUrl" app/support.js app/index.html
# If public URLs are used instead of signed URLs → FAIL
# If bucket is configured as public → FAIL
```

### B-12.5 🟡 Outstanding Tasks List Shows Ticket as Missing Doc When It Has One
**Symptom:** Ops Manager sees ticket in "Outstanding" list. Clicks it — signed PDF is already there. Wastes time.
**Root Cause:** Outstanding tasks query uses stale cache or incorrect JOIN. Race condition between upload completion and list refresh.
**Prevention Rule:**
- Outstanding tasks MUST query `tickets` where `status = 'approved'` AND `NOT EXISTS (SELECT 1 FROM ticket_documents WHERE ticket_id = tickets.id)`.
- NO client-side caching of the outstanding list. Always fresh query.
- After upload, invalidate outstanding tasks cache immediately.
**Detection Method:**
```bash
grep -n "outstanding\|missing.*doc\|ticket_documents" app/support.js | grep -i "cache\|localStorage\|stored"
# If outstanding list is cached in localStorage without invalidation → FAIL
```

### B-12.6 🔴 Upload Succeeds but DB Record Fails — File Exists but Not Linked
**Symptom:** File is in Storage. Ticket shows no attachment. User re-uploads. Now two orphan files exist.
**Root Cause:** Storage upload succeeds, but `ticket_documents` INSERT fails (network error, RLS rejection). No transaction rollback.
**Prevention Rule:**
- Upload and DB insert MUST be in a single atomic operation.
- Use Supabase RPC or Edge Function: upload to Storage → get path → INSERT into `ticket_documents` → return success/failure.
- If DB insert fails, delete the Storage object immediately.
- NEVER do Storage upload and DB insert as two separate client-side calls.
**Detection Method:**
```bash
grep -n "upload\|storage\|ticket_documents.*insert" app/support.js
# If upload and insert are separate async calls without rollback → FAIL
```

### B-12.7 🟡 Multiple Uploads for Same Ticket — No Version Control
**Symptom:** Technician uploads scan, then Ops Manager uploads better scan. Two PDFs exist. Which is the "official" one?
**Root Cause:** No restriction on number of uploads per ticket. No "latest" or "primary" flag.
**Prevention Rule:**
- Allow multiple uploads (for corrections), but UI MUST show upload history with timestamp and uploader.
- Most recent upload is displayed as "current." Older uploads are in "History."
- OR: restrict to 1 upload per ticket, with replace (delete old, upload new) + audit log.
**Detection Method:**
```bash
grep -n "multiple.*upload\|version\|history\|replace.*doc" app/support.js app/index.html
# If no upload history or replacement logic → FLAG (not fail — design choice)
```

### B-12.8 🟠 Technician Cannot See Their Own Upload in Archive
**Symptom:** Technician uploads signed doc. Wants to verify it uploaded correctly. Cannot view it. Confused.
**Root Cause:** RLS restricts SELECT on `ticket_documents` to Admin/Ops/Observer. Technician who uploaded cannot view.
**Prevention Rule:**
- Technicians MUST be able to view `ticket_documents` they uploaded (their own uploads only).
- RLS: `SELECT ... WHERE uploaded_by = auth.uid()` for technicians.
- Admin/Ops/Observer can view all.
**Detection Method:**
```bash
grep -n "ticket_documents.*SELECT\|uploaded_by.*auth" supabase/migrations/
# If technician cannot SELECT their own uploads → FAIL
```

### B-12.9 ⚪ Outstanding Tasks Badge Never Clears
**Symptom:** Technician uploads signed doc. Navigates back to dashboard. Badge still shows "1 outstanding." Hard refresh required.
**Root Cause:** Badge count is computed on page load, not updated after upload. No real-time subscription to `ticket_documents`.
**Prevention Rule:**
- Outstanding tasks count MUST update via Supabase Realtime when `ticket_documents` changes.
- OR: decrement badge count client-side immediately after successful upload.
- NEVER require manual refresh to clear a notification/badge.
**Detection Method:**
```bash
grep -n "outstanding.*count\|badge\|realtime\|subscription" app/support.js | grep -i "document\|upload"
# If no realtime or immediate client-side update → FLAG (UX)
```

---



---

## 13. PRICE LIST & "QUOTED SEPARATELY" DISPLAY

> **Standing Decision #27 (Added 2026-08-20):** 110 price-list rows have NULL `unit_cost` (quoted per job, e.g., "as per third party company invoice", "50% from first day charge"). The app MUST display "Quoted Separately" or the descriptive text — NEVER 0.00. This affects Ops Review, Print Preview, and Excel generation. Do NOT invent prices for these items.

### B-13.1 🔴 NULL unit_cost Displays as 0.00 on Client Invoice
**Symptom:** Client receives Excel/PDF showing $0.00 for chargeable work that should be "Quoted Separately." Client refuses to pay. Business relationship damaged.
**Root Cause:** `money()` or `itemTotal()` helper treats NULL as 0. No special handling for NULL unit_cost.
**Prevention Rule:**
- `money()` helper MUST check for NULL/undefined before formatting. If NULL, return "Quoted Separately" (or localized equivalent).
- `itemTotal()` MUST skip NULL-cost items in subtotal calculation. Do NOT add 0.00.
- Print Preview and Excel generation MUST use the same logic.
- NEVER format NULL as 0.00. NEVER.
**Detection Method:**
```bash
grep -n "money\|itemTotal\|unit_cost\|0.00" app/support.js
# If money() doesn't handle NULL/undefined → FAIL
# If NULL unit_cost is formatted as 0.00 anywhere → FAIL
```

### B-13.2 🔴 Invented Numbers Used for Waha Code Conflicts
**Symptom:** Invoice shows MKN100-710 at $45,970 (average of $68,200 and $23,740). Real item is $68,200. Company undercharges by $22,230 per job.
**Root Cause:** Agent "resolves" conflict by inventing a new code or averaging prices instead of waiting for real codes from Makaman.
**Prevention Rule:**
- The 10 Waha conflicts are PARKED in `backup.price_list_conflicts_20260820`.
- NEVER invent item numbers. NEVER average prices. NEVER drop rows.
- If a conflicted code is searched/used, show: "Code ambiguous — contact admin for resolution."
- Admin UI must show the backup table for manual resolution.
**Detection Method:**
```bash
grep -n "price_list_conflicts\|invent\|average\|MKN100-710" app/support.js supabase/migrations/
# If any code invents numbers or averages prices → FAIL
# If conflicts table is not referenced in admin UI → FLAG
```

### B-13.3 🔴 Price List Import Drops Quoted-Separately Rows
**Symptom:** 110 items that should be "quoted separately" are missing from the price list. Ops Manager cannot find them when building a ticket.
**Root Cause:** Import script filters out rows with NULL unit_cost to avoid the 0.00 display problem. Or RLS prevents reading NULL-cost items.
**Prevention Rule:**
- ALL price-list rows MUST be imported, including NULL unit_cost rows.
- `price_list_items` table MUST allow NULL `unit_cost`.
- Item search MUST return NULL-cost items. Display must show "Quoted Separately."
- NEVER filter out NULL-cost rows at the database or import level.
**Detection Method:**
```bash
grep -n "unit_cost.*NOT NULL\|unit_cost.*!=.*null\|unit_cost.*IS NOT NULL" supabase/migrations/
# If any constraint or query excludes NULL unit_cost → FAIL
```

### B-13.4 🟡 "Quoted Separately" Text Not Localized for Arabic
**Symptom:** Arabic-speaking client sees "Quoted Separately" in English on an otherwise Arabic invoice. Unprofessional.
**Root Cause:** Hardcoded English string. No i18n framework.
**Prevention Rule:**
- Even without full i18n, "Quoted Separately" MUST be a configurable string in `org_defaults` or `localStorage` settings.
- Default Arabic: "السعر حسب العرض" or similar (user-provided).
- NEVER hardcode English business terms in display logic.
**Detection Method:**
```bash
grep -n "Quoted Separately\|quoted separately" app/support.js app/index.html
# If hardcoded English string found → FLAG (P2.4 Arabic support)
```

### B-13.5 🟡 Ops Manager Accidentally Adds "Quoted Separately" Item with Qty > 1
**Symptom:** Ticket shows "Quoted Separately × 3 = Quoted Separately." Nonsensical. Client confused.
**Root Cause:** NULL-cost items allow quantity entry but quantity is meaningless without a unit price.
**Prevention Rule:**
- For NULL-cost items, qty field SHOULD be disabled or hidden.
- OR: qty is always 1 for NULL-cost items, enforced by UI and DB.
- Display: "Quoted Separately" (no qty, no total column).
**Detection Method:**
```bash
grep -n "qty\|quantity\|NULL.*cost\|quoted" app/support.js | grep -i "disable\|hide\|enforce"
# If NULL-cost items allow arbitrary qty without restriction → FLAG
```

### B-13.6 🟠 Excel Formula Breaks on "Quoted Separately" Text in Numeric Cell
**Symptom:** Excel shows `#VALUE!` error because "Quoted Separately" was written to a cell expected to contain a number.
**Root Cause:** Excel template has formulas (e.g., `=B8*C8`) that expect numeric cost. Text breaks the formula.
**Prevention Rule:**
- Excel generation MUST handle NULL cost as empty cell or text in a separate column — NOT in the numeric cost column.
- If the template formula references the cost cell, the formula must handle text gracefully (e.g., `=IF(ISNUMBER(B8), B8*C8, "Quoted Separately")`).
- OR: Use a separate "Remarks" column for quoted-separately items.
**Detection Method:**
```bash
grep -n "Excel\|xlsx\|template\|formula" app/support.js reference/
# If Excel generation writes text to numeric cells → FAIL
```

---

## Token-Efficient Diagnostic Protocol

### Pre-Flight (Before Writing Code) — 30 seconds
```
1. Does my task touch any subsystem in BLINDSPOTS.md? [Y/N]
2. If Y, read the failure modes for that subsystem.
3. Apply Prevention Rules proactively.
4. Note the Blind Spot IDs in commit message: "Fixes B-3.1, prevents B-3.2"
```

### Post-Flight (After Writing Code) — 60 seconds
```
1. Run Detection Method grep for each touched subsystem.
2. If FAIL → fix before commit.
3. If FLAG → note in commit message for human review.
4. Update BLINDSPOTS.md if you discovered a NEW failure mode.
```

### Commit Message Format
```
P1.1: Port Settings screen
- Pre-flight: touches Settings (no blind spots), Nav (B-9.3 check)
- Post-flight: B-9.3 PASS (event delegation used)
- No new blind spots discovered.
```

---

## 14. PRIVILEGED WRITES & THE OUTBOX (added 2026-08-26, from a live bug)

> Both of these were **found in production behaviour, not theorised**. The signup approval
> silently reverted, and the cause turned out to be two separate faults compounding.

### B-14.1 🔵 [FIXED] A Client Write to `profiles` Is Refused, and the Refusal Is Invisible
**Symptom:** An admin approves a pending sign-up. The row shows active. The person still
cannot log in, and after a refresh the account is pending again.
**Root Cause:** `profiles` has RLS enabled with **SELECT policies only** — no INSERT,
UPDATE or DELETE for any signed-in client, deliberately (CONSTRAINTS §4). The approval was
a local `mutate()`, which `diffOps()` turned into an ordinary `profiles` upsert. Postgres
refused it, `mutate()` never blocks on send errors, and the next `hydrate()` adopted the
database's unchanged row.
**Prevention Rule:**
- Any table whose writes are privileged must be **absent from the `diffOps` pair list**.
  Route it through the `admin-actions` Edge Function via `adminAction()` instead.
- Never "fix" this by adding an UPDATE policy to `profiles`. A staff member who can write
  their own row can promote themselves to Admin.
- Optimistic local writes are correct for a technician's own data and wrong for anything
  the server may refuse. Where the server decides, wait for its answer, then `refresh()`.
**Detection Method:**
```bash
# Reading profiles is fine - hydrate() does it. Only the outbox pair list matters.
sed -n '/const pairs = ./,/.;/p' app/index.html | grep -c "'profiles'"
# 0 = PASS. Above 0 → FAIL: profile writes are back on the queue.
```
**Fixed:** 2026-08-26 — `adminAction()` + `profiles` removed from the pair list.

### B-14.2 🔴 [FIXED] One Permanently-Refused Op Freezes Every Later Write
**Symptom:** A device stops syncing entirely. No error, no banner. Tickets pile up unsent
long after the connection came back.
**Root Cause:** `outboxDrain()` stopped at the first failure to preserve ordering — right
for a dropped connection, fatal for a refusal that will never succeed. The rejected op kept
its place at the head of the queue forever, and everything behind it with it. The comment
above the function claimed failures did *not* block later ops; the code did the opposite.
**Prevention Rule:**
- A retry loop over a queue must be **bounded**. Distinguish "not yet" from "never".
- After `OUTBOX_TRIES` (5) attempts, set the op aside into `makaman.outbox.refused.v1` and
  let the queue advance. Keep it — a record of what the database would not take is the
  first thing worth having when a device and the office disagree.
- Never discard a refused op silently, and never skip an op *early* — the ops behind it may
  depend on it (tickets before their children).
**Detection Method:**
```bash
grep -n "tries" app/index.html | grep -i outbox
# No attempt counter in the drain loop → FAIL
```
**Fixed:** 2026-08-26 — bounded retry + `outboxSetAside()`. Covered by `app/approval.test.js`.

### B-14.3 ⚪ A Button That Performs a Write the Server Will Undo
**Symptom:** A user is deleted, disappears from the list, and reappears after a refresh.
**Root Cause:** The same shape as B-14.1 — a local-only mutation to a privileged table.
`admin-actions` has no `delete_user` action, so nothing was ever sent.
**Prevention Rule:** When a privileged action has no server-side counterpart yet, **say so
in the UI**. Do not perform the local half. A control that appears to work and silently
does not is worse than one that explains itself.
**Status:** Dialog now states it plainly in cloud mode. Wiring `delete_user` is tracked in
HANDOFF §1.3.

---

## 15. PERMISSION REGISTRY (added 2026-08-26)

### B-15.1 🔵 [FIXED] A Definer Function Taking Someone Else's Id Is Reachable by `anon`
**Symptom:** None visible. `POST /rest/v1/rpc/has_permission` with any user id, no
Authorization header, answers truthfully.
**Root Cause:** `SECURITY DEFINER` plus a uuid argument plus Postgres's default `EXECUTE`
grant to `public`. RLS protects tables, not functions — a definer function is a hole
straight through it, and adding one is easy to do without noticing.
**Prevention Rule:**
- After creating **any** definer function, run the security advisor. Do not skip it
  because "the tables have RLS".
- `revoke execute ... from anon, public`, then grant only what is needed.
- A function that takes a subject id must also *check* the caller may ask about that
  subject. Restricting who can call it is not the same as restricting what they can ask.
- Prefer a no-argument, self-scoped variant for what the app actually calls
  (`my_permissions()`), so the call site has nothing to point wrongly.
**Detection Method:**
```bash
# In an agent session, via the Supabase MCP:
#   get_advisors(type='security')
# Any anon_security_definer_function_executable lint → FAIL
```
**Fixed:** migration 0015.

### B-15.2 🟡 A Registry Nothing Reads Is Decoration
**Symptom:** An admin grants someone a capability. The screen shows the exception. The app
behaves exactly as before.
**Root Cause:** The permission tables, the helper and the admin page can all be correct
while every actual gate still asks `S.role === 'admin'`. The registry then describes
intent, not behaviour — and the screen is actively misleading, because it implies a change
that did not happen.
**Prevention Rule:**
- A permission is not "built" until a gate reads it. Ship the registry and the conversion
  of at least one real gate together, or state plainly in HANDOFF which gates are still
  role-based.
- When converting, do it subsystem by subsystem with a suite each. A single sweep over
  twenty-eight call sites cannot be reviewed.
**Status:** Open and documented — the Permissions screen gates itself through
`hasPermission()`; the other twenty-eight comparisons are tracked as P1.8b.

### B-15.3 ⚪ A Toggle That Stores the Answer the Role Already Gives
**Symptom:** "0 exceptions" becomes "1 exception" after a toggle that changed nothing.
**Root Cause:** Writing an override row whenever a control is touched, without comparing
the new value to what the role would say. The count then measures clicks, not exceptions.
**Prevention Rule:** An override equal to the default is a **delete**, not an upsert.
Anything that counts "exceptions" must count differences from the default, not rows.
**Fixed:** `setPermissionOverride()` deletes when the new value matches the role default.
Covered by `app/permissions.test.js`.

### B-15.4 ⚪ Playwright Clicking "the first button that says Yes"
**Symptom:** A test fails and blames the app. The app was right; the test clicked a
different row.
**Root Cause:** On a screen of repeated rows, `find(b => /^Yes$/.test(b.textContent))`
picks whichever row sorts first — not the one the test just acted on. An earlier version of
`permissions.test.js` toggled `report.generate` and asserted about `ticket.approve`.
**Prevention Rule:** On repeated rows, locate by the row's own label and take the button
*within* that row (`:scope > button`). Never index into a global list of identical
controls. Joins the existing harness traps: `newPage()` shares storage with its context,
`innerText` applies `text-transform`, and input *values* never appear in `innerText`.

---

### B-15.5 🔵 A Capability Named Too Broadly Grants More Than It Says

**Symptom:** Converting a role comparison to `hasPermission()` changes behaviour when it
should not. Somebody can suddenly see or do something they could not before.
**Root Cause:** The registry was seeded *from* the role comparisons, so it inherits their
imprecision. `activity.view_all` was seeded to `ops_manager, admin, founder` and then used
for two different gates — "see every ticket's activity" (Observer: yes) and "see the edit
trail and tool custody" (Observer: **no**). Pointing the second gate at that key silently
handed the Observer the edit history.
**Why it is a security finding, not a UX one:** the failure direction is always *wider*.
A key that is too coarse never denies something it should allow; it allows something it
should deny, and does it quietly.
**Prevention Rule:**
- Before converting a gate, ask which roles it currently produces `true` for and compare
  that to the key's `default_roles`. **If they differ for even one role, the key is wrong
  for that gate** — split it rather than widening the role set.
- One key per gate is safer than one key per noun. `activity.view_all` and
  `activity.view_edits` are both about activity and are not the same capability.
- Convert with the suites running. Zero behaviour change is the expected result, so any
  failure is signal — do not "fix" it by loosening the permission.
**Detection Method:**
```bash
# For each converted gate, the roles it used to be true for must equal the key's roles.
# There is no grep for this; it is a reading. The suites are the real detector —
# run the role-shaped ones (roles, observer, office, claim) after every conversion.
```
**Found:** 2026-08-26, by the observer suite, during P1.8b. Fixed in migration 0016.

### B-15.6 ⚪ Gating Presentation on a Permission Makes a Blank Screen Possible
**Symptom:** An admin revokes a capability and a user can no longer navigate — no page
renders, or the wrong shell does.
**Root Cause:** Treating every `S.role === 'x'` as a capability. Routing (`showMgrPage`,
`showAdminPage`, `showFounderPage`), shell choice (`deskTabs`, `showDeskNav`), identity
flags and screen titles are **not** capabilities. They decide how the app is presented to
a role, and there is no sensible answer to "what if this is off".
**Prevention Rule:** Convert a role comparison only when it answers *what may this person
do*. If it answers *how does the app look to this person*, leave it. In this codebase the
split is 11 converted, 18 kept — the kept ones are listed in HANDOFF §2c and should not be
"finished".

---

### B-15.7 🔵 Fixing a Leak in One Place Leaves It Open in Another
**Symptom:** A capability gate is corrected, the suite goes green, and the same data is
still readable somewhere else.
**Root Cause:** `activity.view_edits` was applied to the Activity tab. The per-ticket audit
panel in Review read the same data, was ungated, and the Observer reaches that screen —
`showMgrPage` admits `founder` at `mgrScreen === 'review'`. Two surfaces onto one dataset,
and fixing the first told you nothing about the second.
**Prevention Rule:**
- When gating a capability, **grep for every other surface onto the same data** before
  calling it done. Here: `grep -n "audit" app/index.html` would have found both.
- Name the gate once (`const curAuditDeep = this.hasPermission(...)`) and let the rows, the
  empty state and the scope line all read that one binding, so they cannot drift apart.
**Detection Method:**
```bash
# For each gated dataset, count the surfaces that render it and the gates that guard them.
grep -cn "curAudit\|activityFeed" app/index.html
# Surfaces without a gate → FAIL
```
**Found:** 2026-08-26, while building the Review log. Same root as B-15.5, second location.

### B-15.8 ⚪ A Negative Assertion Passes on a Blank Page
**Symptom:** A test asserting "X is not shown" goes green, and the feature is reported
fixed. Nothing was shown at all — including the thing that should have been.
**Root Cause:** `check('the edit is withheld', !/mileage changed/.test(text))` is true when
`text` is empty. The first run of `reviewlog.test.js` reported the Observer leak as closed
while the review screen had not rendered, because the seed had silently failed.
**Prevention Rule:**
- Every "is not shown" check must be conditional on the container actually being present:
  `check(..., !!panel && !/thing/.test(panel))`.
- Pair each negative with a positive on the same surface. Here: the Observer must see the
  *stage* entry and not the *edit* — if the stage entry is missing, the negative proves
  nothing.
**Found:** 2026-08-26, in the first run of `reviewlog.test.js`.

### B-15.9 ⚪ Two Harness Traps, Both Cost Real Time
**The store is not written until the first mutation.** Seeding through `localStorage`
before one has happened writes into nothing and reads back null. Use `window.__mkApp` —
`app.mutate(d => ...)` then `app.setState({ activeId, mgrScreen: 'review' })`. This is the
handle `forced.test.js` already established.

**Body-text search finds prose before headings.** The Review screen says "every change is
written to the audit trail" in explanatory text above the panel, so
`innerText.indexOf('AUDIT TRAIL')` lands there and reads the ticket header as though it
were the log. Locate a panel by its DOM node, not by searching page text.

Joins the existing traps: `newPage()` shares storage with its context (`newContext()`
isolates), `innerText` applies `text-transform`, input *values* never appear in
`innerText`, and on repeated rows locate the button *within* the row (B-15.4).

---

## 16. DESTRUCTIVE OPERATIONS (added 2026-08-26)

### B-16.1 🔵 "Delete the user" Erases the Audit Trail, or Is Refused
**Symptom:** Either the delete fails with a foreign-key error for every real user, or it
succeeds and the record of who worked a job quietly changes.
**Root Cause:** `profiles` is referenced by `tickets` (technician_id, holder_id, closed_by,
approved_by) and `audit_log.changed_by` with **NO ACTION**, and by `ticket_crew.profile_id`
with **CASCADE**. So a delete is impossible for anyone who has worked, and destructive
where it is possible.
**Prevention Rule:**
- **Read the FK delete rules before implementing any delete.** They are the schema telling
  you what the data means: NO ACTION says "this record is referenced and must survive";
  CASCADE says "this row is part of its parent".
- For an actor referenced by history, withdraw access by **status**, never by removing the
  row. Accounts, in this app, are never deleted.
- If a confirmation dialog already describes the safe behaviour ("their name stays on any
  tickets they touched"), the dialog is the specification — implement that, do not build
  the destructive thing the button label implies.
**Detection Method:**
```sql
select tc.table_name, kcu.column_name, rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu using (constraint_name)
join information_schema.referential_constraints rc using (constraint_name)
join information_schema.constraint_column_usage ccu using (constraint_name)
where tc.constraint_type='FOREIGN KEY' and ccu.table_name='<parent>';
-- Any NO ACTION → a delete will be refused. Any CASCADE → a delete destroys history.
```

### B-16.2 🟡 A Second CHECK Constraint Silently Does Nothing
**Symptom:** A migration adds a CHECK permitting a new value, the migration succeeds, and
the new value is still rejected.
**Root Cause:** Multiple CHECK constraints on one column **all** apply — they AND together,
so the strictest wins. Migration 0018 added `profiles_status_known` allowing `disabled`
while `profiles_status_check` from 0001 still restricted the column to pending/active. The
new constraint looked like it worked and had no effect whatsoever.
**Prevention Rule:**
- Before adding a CHECK, list the ones already on that column and **replace** rather than
  add. One column, one statement of what may go in it.
- Test the new value end to end immediately after the migration. "Migration succeeded" is
  not evidence that the value is now accepted.
**Detection Method:**
```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = '<table>'::regclass and contype = 'c';
-- Two constraints naming the same column → FAIL
```
**Found:** 2026-08-26. Fixed by migration 0019.

### B-16.3 ⚪ Fixing Test Data Quietly Changes What a Role Can See
**Symptom:** Demo data is tidied up; a role's view of it narrows, and no test notices
because the change looks like a data fix.
**Root Cause:** Giving seeded audit entries an explicit `kind` to add attribution, and
labelling one `'edit'` because that read as more accurate. `auditKind()` had been inferring
`'lifecycle'` from its text, and the Observer is shown lifecycle only — so the entry would
have silently dropped out of their view.
**Prevention Rule:** When adding a classification field to existing data, set every value
to **what the inference already produced**, and verify it. Changing a classification changes
who sees what; that is a product decision, not a tidy-up, and it does not belong in a commit
about something else.

---

### B-16.4 🔵 A View Defaults to SECURITY DEFINER and Bypasses RLS
**Symptom:** None visible. A view over a protected table returns every row to every
signed-in user, no matter what RLS says on the table underneath.
**Root Cause:** Postgres views run with the *creator's* permissions unless
`security_invoker` is set. `master_export_rows` selects from `tickets`, which has RLS
restricting a technician to their own jobs — and the view handed all of them to anybody.
**Prevention Rule:**
- **Every view over an RLS-protected table gets `security_invoker = on`.** No exceptions;
  if the view genuinely needs elevated reads, that is a SECURITY DEFINER *function* with a
  guard, not a silently privileged view.
- Run the security advisor after adding any view or function. This one is an ERROR, not a
  warning, and it is invisible from the application.
**Detection Method:**
```sql
select c.relname,
       coalesce((select option_value from pg_options_to_table(c.reloptions)
                 where option_name='security_invoker'), 'off') as security_invoker
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='v';
-- Any view over a protected table reading 'off' → FAIL
```
**Found:** 2026-08-26, by the advisor, immediately after creating the view.

### B-16.5 🟡 A New Capability Added to the Database and Not to the Offline Defaults
**Symptom:** A feature gated on a brand-new capability never appears — for anyone, in the
demo store and offline — while the database says the permission exists and is granted.
**Root Cause:** `hasPermission()` answers from `PERMISSION_DEFAULTS` whenever there is no
hydrated map: the demo store, and the first render of a cloud session. A key that exists
only in the database is false everywhere that constant is the source.
**Prevention Rule:** Adding a capability is **two** edits — the migration and
`PERMISSION_DEFAULTS` — and they are one commit. The constant is not a convenience copy;
it is the offline half of the same registry.
**Detection Method:** `app/permissions.test.js` asserts that every key appearing in a
`hasPermission('…')` call exists in `PERMISSION_DEFAULTS`. Run it after adding a gate.
**Found:** 2026-08-26 — `export.master`, caught by its own feature's suite failing.

### B-16.6 ⚪ Scheduling a Rebuild Per Event Makes Events Race
**Symptom:** A shared generated file is occasionally an older version than the newest
event, for no reproducible reason.
**Root Cause:** A trigger firing an HTTP rebuild on every approval. Ten approvals start ten
rebuilds of the same object; they finish in whatever order the network gives them, and the
last *writer* wins rather than the last *event*.
**Prevention Rule:** For a single shared artifact, schedule a cheap check often rather than
a rebuild per event: "has anything changed since the last good build?" One rebuild at a
time, no races, and the cost when idle is one index lookup.

---

### B-16.7 🔵 Comparing a Bearer Token to a Key by String Equality
**Symptom:** A server-to-server call returns **401** with a message about an invalid
session, even though the caller was given the correct key. Nothing in the logs explains it.
**Root Cause:** The function did `if (token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))`.
Supabase fills that env var with the **legacy `eyJ…` JWT**, while a project configured with
the newer **`sb_secret_…`** format presents a different string for the same authority. Both
are valid; `===` cannot see that. The call then falls through to the user-token branch and
is rejected as a bad session — a misleading error for a key-format mismatch.
**Prevention Rule:**
- **Never authenticate a machine caller by string-comparing a platform key.** Key formats
  get migrated, and the failure is silent and misdiagnosable.
- Prefer proof the caller can only produce by having the access you actually care about: a
  single-use nonce written to a table no client can write, consumed on first use.
- Consume the nonce *before* checking its freshness, so an intercepted one is worth one
  attempt rather than a two-minute window of attempts.
- If a shared secret really is unavoidable, do not store a live credential in the database
  to keep in step with one the platform injects — that is two copies of one secret and they
  will drift.
**Detection Method:**
```bash
grep -rn "SERVICE_ROLE_KEY" supabase/functions/ | grep -v "createClient"
# A service key used for anything but constructing the privileged client → FLAG
```
**Found:** 2026-08-26, first live run of `master-export`. Fixed by migration 0023.

### B-16.8 ⚪ Diagnosing an Edge Function When Egress Is Blocked
The build container cannot reach `*.supabase.co`, so an Edge Function cannot be called or
curled from here. It can still be driven **from inside the database**: `pg_net` runs on the
right side of the wall.

```sql
select public.rebuild_master_export(true);          -- fire it
select status_code, content, error_msg              -- read the actual reply
from net._http_response order by created desc limit 1;
```

That is how the 401 above was found. Without it the only evidence was an absent
`export_runs` row, which says the function refused the call but not why.

---

---

*This is a living document. Every agent MUST append new failure modes discovered during development. Do not let it drift.*

---

## B-17 · The printed sheet (2026-08-26)

### B-17.1 🔴 The preview and the PDF are two renderers, and they drifted
**Symptom:** The A4 preview on screen shows the designed form — letterhead, Arabic company
block, boxed field grid, ticket-number panel, ruled item table. The PDF the customer
actually receives is a plain list of typed lines with no boxes and no logo. Nobody notices,
because nobody ever puts them side by side.
**Root Cause:** The sheet is drawn twice — HTML in the preview, jsPDF in the file — from two
independent sets of numbers. Only the preview was maintained. The code comment claimed
"the A4 preview and the PDF it produces are the same document", which was true when written
and had quietly stopped being true.
**Prevention Rule:**
- Both renderers MUST scale from one shared constant (`SHEET`), stated in the preview's own
  pixels. Never hardcode a measurement in `drawSheet` that is not derived from it.
- A test MUST render both and compare band positions and column shares. "It looked right"
  is not a check — the drift was invisible for weeks precisely because it looked right on
  the screen anyone was looking at.
**Detection Method:**
```bash
cd app && NODE_PATH=../node_modules node mksheet.test.js
# Any FAIL → the two have separated again. Fix SHEET, not one renderer.
```

### B-17.2 🔴 jsPDF shapes Arabic correctly and then cannot draw it
**Symptom:** An Arabic customer name prints on the client's ticket as `þ¨þ×þŽþÄþàþß`.
**Root Cause:** Two correct-looking halves. jsPDF *does* shape Arabic — it converts letters
to contextual presentation forms and reverses the run — so the right bytes reach the file.
But its built-in faces are the PDF standard-14, all WinAnsi, none of which has an Arabic
glyph. The text is present and undrawable. This is B-5.2, which predicted it.
**Prevention Rule:**
- An embedded font is mandatory. `/FontFile` absent means no Arabic, whatever the bytes say.
- The embedded subset MUST cover the presentation forms `U+FB50-FDFF` and `U+FE70-FEFC` —
  those are what jsPDF emits. A subset carrying only the base `U+0600` block embeds cleanly
  and still draws nothing.
- Latin must be in the same face, or a mixed name loses the half the font cannot draw.
**Detection Method:**
```bash
# The byte pattern is NOT the test — the broken and fixed files contain the same bytes.
grep -c 'FontFile' <(python3 -c "print(open('ticket.pdf','rb').read().decode('latin1'))")
# 0 → FAIL. Also assert /Subtype /Type0: only a composite font keys off two-byte codepoints.
```

### B-17.3 🟠 A row cap picked by hand overflows the page
**Symptom:** The signature block prints straight through the bottom of the item table.
**Root Cause:** `ITEM_ROW_CAP = 24` was a chosen number, not a derived one. 24 rows plus the
header bands exceeded the printable height. The preview hid it by scrolling inside its card;
the PDF, having no scrollbar, drew the signatures on top of the table.
**Prevention Rule:**
- Row caps MUST be computed from the page height less the bands above and the signature
  block below (`SHEET.rowsFor()`), never written as a literal. A band height that changes
  must not be able to leave a stale cap behind it.
**Detection Method:**
```bash
grep -n 'ROW_CAP = [0-9]' app/index.html
# Any numeric literal → FAIL. It must read SHEET.rowsFor(...).
```

### B-17.4 🟠 An embedded image at source resolution
**Symptom:** One ticket's PDF is 9 MB. A technician on a field connection cannot send it.
**Root Cause:** `canvas.toDataURL()` on the 2656px letterhead, embedded once per page, for a
mark drawn at 46 mm.
**Prevention Rule:** Downscale before embedding — 640px is already twice what 300 dpi needs
at that size. Assert an upper bound on exported file size in the test.
**Detection Method:** `mksheet.test.js` asserts the PDF is under 1.5 MB.

### B-17.5 🟡 An inline style silently kills a stylesheet rule
**Symptom:** `.mk-ticket-card { border-inline-start-width:3px }` has never rendered. Cards
draw their status stripe at 1px.
**Root Cause:** The card carries `style="border:1px solid …"` inline, and an inline style
beats any stylesheet rule regardless of specificity. The class looks live and is dead.
**Prevention Rule:** A class that styles an element which also carries an inline style for
the same property must use `!important` or move into the inline style. Left unfixed
deliberately — changing it alters every ticket card's appearance, which is a design decision.
**Detection Method:** Read the computed style, never the stylesheet, when asserting a design.

### B-17.6 🟡 A hardcoded line number makes a syntax check lie
**Symptom:** `node --check` reports SYNTAX OK on a file that was never written, or on a stale
extraction, because the `awk 'NR>2268'` that extracts the `<script type="text/x-dc">` block
was pinned to a line number that had since moved.
**Root Cause:** Extraction by line number, plus `&&` chaining that let a failed extraction
fall through to a check of the previous run's output.
**Prevention Rule:** Locate the tag, never the line (`scratchpad/extract.sh`). Delete the
output file before regenerating it, and assert it exists before checking it.

---

## B-18 · Exports (2026-08-26)

### B-18.1 🔴 A success toast and an audit entry over a no-op
**Symptom:** The audit trail — the record CLAUD.md calls legally required — carries
"4 sheets downloaded to this device" for exports nobody ever received. Same for
"4 sheets uploaded to OneDrive".
**Root Cause:** `exportExcel` logged and toasted *before* doing anything, and there was
nothing behind it. The cloud buttons did the same with no OAuth behind them at all.
**Prevention Rule:**
- **Log after the effect, never before it.** An audit entry is a claim that something
  happened; write it in the success branch only.
- A failed export MUST leave the trail untouched.
- A mocked capability MUST say it is not connected. It must never write a record.
**Detection Method:**
```bash
grep -n "this.log(.*downloaded\|this.log(.*uploaded" app/index.html
# Any such call not inside a .then() after the file exists → FAIL
```

### B-18.2 🔴 A template's own formulas recompute someone else's pricing
**Symptom:** The filled workbook's total disagrees with the PDF the customer signed.
**Root Cause:** `Autofill_ServiceTikcet_System.xlsx` was saved from a real ticket and kept
its arithmetic: `F24 = -(E24*0.6)` is a 60% discount, `F22 = E22*0.2` a 20% surcharge, and
`E22 = SUM(F16:F21)` sums only six of the twenty-four item rows. Fill the values and leave
the formulas and Excel recalculates to a different figure.
**Prevention Rule:**
- Write computed **values** into a filled template and drop the `<f>` element. The exported
  sheet is a record of what was agreed, not a calculator that may disagree with it.
- Then remove `xl/calcChain.xml` and its `[Content_Types].xml` override — a cached
  dependency graph pointing at cells that no longer compute is what triggers Excel's
  repair prompt.
**Detection Method:** `template.test.js` asserts zero `<f>` elements survive in the filled
sheets and that the grand total equals `ticketTotal()`.

### B-18.3 🟠 A generated lookalike instead of the customer's own form
**Symptom:** The client receives a workbook that resembles their service ticket but is not
it — different column widths, no logo, no print setup.
**Root Cause:** Building a new workbook with a spreadsheet library. SheetJS's community
build does not preserve styles on write, so "fill the template" silently becomes "recreate
something like it".
**Prevention Rule:** An `.xlsx` is a zip of XML. Patch **cell values only**, in place, and
every part that is not a filled sheet comes back byte-identical — styles, theme, drawings,
media, printer settings and the other tabs included. Keep each cell's `s=` style index;
that index is what carries its border, font and number format.
**Detection Method:** `template.test.js` compares the output to the template part by part
and fails on any change outside the four ticket sheets.

---

## B-19 · The device under field conditions (2026-08-26)

### B-19.1 🔴 A refused save, swallowed
**Symptom:** A technician writes a job-log line at a wellhead. It appears on screen. The
device is full, the write was refused, and the line exists only in memory. The next reload
loses it — hours from the office, with nothing on screen to suggest anything went wrong.
**Root Cause:** Every `localStorage` write in the app read
`try { setItem } catch (e) { /* quota */ }`. Five of them. The one that mattered was
`persist()`, which holds the tickets. This is MINDMAP B16, and it is the worst failure the
app has, because the person it happens to cannot tell it happened.
**Prevention Rule:**
- A failed write to the record MUST be surfaced. Silence is never an acceptable response.
- Say it in a **persistent** element, not a toast: a toast is for something that happened
  and is over; a full device is a condition that outlives the message.
- Show it above every screen for every role — a technician cannot be expected to notice a
  message on a tab he is not looking at.
- Recover automatically: shed what can be rebuilt, retry, and clear the warning the moment
  a write gets through.
**Detection Method:**
```bash
grep -n "catch (e) { /\* quota \*/ }" app/index.html
# Any write to the RECORD (tickets, outbox) with a swallowed quota error → FAIL.
# Swallowing is still fine for genuinely optional writes (session, dead-letter).
```

### B-19.2 🟠 Making room by throwing away the record
**Symptom:** The app frees space and the tickets are gone.
**Root Cause:** A shed that treats all keys alike.
**Prevention Rule:** Only shed what can be rebuilt from somewhere else — the store for the
mode the device is *not* in, and the capped set-aside pile of refused ops. **Never** the
tickets and **never** the outbox. A storage problem must not be allowed to become a data
problem.
**Detection Method:** `stress.test.js` asserts the shed drops the cache and the dead-letter
and leaves the store and the outbox byte-identical.

### B-19.3 🟡 Reading the DOM before React has painted
**Symptom:** A fix is in place and the test still reports the old failure.
**Root Cause:** The reproduction read `document.body.innerText` in the same synchronous
block as the `setState` that raises the warning. React had not re-rendered, so the test was
measuring the harness rather than the app — and would have reported a working fix as broken.
**Prevention Rule:** Assert state first, then wait, then assert the DOM. Any check on
something rendered *from* state needs a paint between the cause and the reading.

### B-19.4 🔴 A dead suite that still prints PASS
**Symptom:** `cloud.test.js` prints four green lines, then dies. The green lines are
meaningless — they assert against seeded defaults because the data they were meant to check
never arrived.
**Root Cause:** Hydration lands nothing, so every later assertion reads the seed. Checks
written as "this value is present" pass on a default that happens to match, and checks
written as "this value is absent" pass on absence caused by the failure itself. Same family
as B-15.8 (a negative assertion passing on a blank page).
**Prevention Rule:**
- A fixture value MUST be distinguishable from the seed. Assert `since === '2026-08-01…'`,
  never merely that a holder name is present — the seed has one too.
- A suite MUST fail loudly when its setup did not take. Assert the arrival of the fixture
  *first*, and stop if it is not there, rather than letting later checks read defaults.
- Treat a partial run as a failed run. "4 passed" before a crash is not partial credit.
**Detection Method:**
```bash
cd app && NODE_PATH=../node_modules node cloud.test.js 2>&1 | tail -3
# A suite that ends in a stack trace rather than a count → the count above it means nothing.
```

### B-19.5 🔴 A catch wide enough to hide a programming error
**Symptom:** `approval.test.js` went red on "the refusal is kept, not discarded silently".
The queue drained, the op was given up on, and the set-aside pile came back empty.
**Root Cause:** `outboxSetAside` computed its reason *inside* a `try` whose `catch` existed
for quota. When `refusalText` was unreachable in the suite's isolated evaluation, the
resulting `ReferenceError` was caught by that quota handler and the refusal was dropped —
while the drain reported success. A broad catch turned a coding mistake into silent data
loss, which is the exact failure the surrounding code exists to prevent.
**Prevention Rule:**
- A `try` guards **one** fallible operation. Compute everything else before it.
- A `catch` written for a specific failure (quota, network) must not be able to swallow a
  `ReferenceError` or `TypeError`. If the block can throw for more than one reason, either
  narrow it or re-throw what you did not mean to handle.
- When a suite evaluates extracted functions in isolation, every function they call must
  come with them — otherwise the suite fails for a reason unrelated to what it tests.
**Detection Method:**
```bash
grep -n -B6 "catch (e) { /\* quota \*/ }" app/index.html
# More than one statement that can throw inside the try → narrow it.
```

### B-19.6 🔴 A fake client that quietly stops keeping up
**Symptom:** `cloud.test.js` prints PASS for several assertions, then dies. The passes are
vacuous — they read seeded defaults, because hydration never landed.
**Root Cause:** Three faults, each hiding the next.
1. The stub had no `rpc` at all, while hydrate calls `c.rpc('my_permissions')` — added by
   the permission registry after the stub was written.
2. Given an `rpc`, it returned `{}`. `my_permissions()` is declared
   `returns table (permission_id, granted, source)`, so supabase-js yields an **array**;
   `(myPerms || []).reduce` on an object throws, and `{}` is truthy so the `|| []` guard
   never fires.
3. A backtick inside a comment in the stub's own template literal truncated the injected
   string, leaving the page with no `window.supabase` at all.
Each failure produced the same symptom — empty state — so fixing one revealed the next.
**Prevention Rule:**
- A hand-written fake MUST fail loudly when the app grows a call it does not implement.
  Returning `undefined` makes the suite lie rather than fail.
- Match the **declared** shape. `returns table` is an array of rows, not a map.
- Never put a backtick inside a template literal that is injected as source. Assert the
  generated string parses **before** launching a browser — `cloud.test.js` now does.
- When a suite's setup fails, later assertions read defaults. Assert the fixture arrived
  first, and stop if it did not (B-19.4).
**Detection Method:**
```bash
cd app && node -e "…build STUB(DB)…" && node --check /tmp/stub.js
# The suite now does this itself and exits 1 with one line if the stub will not parse.
```
