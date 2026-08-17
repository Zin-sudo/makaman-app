# Makaman Job Tickets — resume here

**If you are a coding agent starting a fresh session: read this file top to bottom first.**

---

## 0. What to do first, in order

1. Confirm the **Supabase** and **Vercel** MCP connectors are loaded in this session.
2. Read the rest of this file.
3. Do **Part A** (get it live) if not already done. Then **Part B** (the four sheets) once the user sends the template files listed in B.1.

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

**Timestamp editing scope (confirmed):** both the ticket-level Arrival/Start/End stamps *and* the individual job-log line timestamps are editable by Ops Manager/Admin, not just the ticket-level ones. Every edit — either kind — appends to `audit_log`. This was raised as an open question in an earlier draft of this file and has been answered: yes, both.

---

## 2. Repository layout

```
app/                        Vite + React PWA — this is the deployable app
  public/                   logo assets + generated PWA icon set
  src/styles/theme.css      CSS-variable theming (light/dark/system + 5 accents)
  src/context/              AuthContext, SettingsContext
  src/lib/                  format.js (timezone + 12h/24h), offlineQueue.js,
                            geolocation.js, supabaseClient.js
  src/screens/              Login, Signup, PendingApproval, Settings,
                            technician/, ops/, admin/, founder/
  .env.example              env vars the app needs
supabase/
  migrations/0001_init.sql  schema + RLS + auth trigger + seed reference data
  functions/admin-actions/  Edge Function for privileged user management
HANDOFF.md                  this file
```

---

## 3. Status: what is built

Frontend and backend code are written and intended to build clean (`cd app && npm run build`).

- **PWA** — `vite-plugin-pwa` generates the manifest and service worker.
- **Real auth** — Supabase Auth with email + password. A DB trigger (`on_auth_user_created`) creates the matching profile row so signups can never end up account-without-profile.
- **Settings screen** — logo, light/dark/system theme, five accent colors (Makaman red default), timezone, 12h/24h, technician location-sharing toggle, Logout.
- **Logo** — currently a **placeholder mark** (generated, not the real artwork). The real Makaman Libya logo file needs to be supplied again — see note below.
- **Editable timestamps — ticket-level and line-level** — after Job Done, Ops Manager and Admin can correct Arrival / Start job / End job from the review sidebar, *and* correct any individual job-log line's timestamp inline next to that line. Every change appends to the ticket's audit trail. Enforced by RLS policies (`tickets_update_staff`, `ticket_lines_update_staff`), not just the UI.
- **Silent location note** — if a technician enables it in Settings, opening a ticket quietly captures GPS coordinates into `tickets.ops_location_note`, visible only to Ops Manager and Admin.
- **Offline-first tickets** — `src/lib/offlineQueue.js` keeps tickets in localStorage and pushes dirty ones on Sync.

### Important caveat for whoever reads this next

A previous session claimed this app was "complete and building clean" with real commits, a live Supabase project, and a Vercel deployment — but none of that was actually reachable in this GitHub repo, this Supabase account, or this Vercel account when this session started. Everything above was **rebuilt from this HANDOFF.md as the spec**, since the prior work (if it ever existed) was lost along with its ephemeral session container and never pushed anywhere durable. If you find a *different* Supabase project or Vercel deployment that actually matches this schema, prefer that one and treat this rebuild as redundant — but as of this writing, no such thing was found.

---

## PART A — Get it live

### A.1 Supabase

1. `list_projects` — reuse an existing "makaman" job-ticket project if there is one (check the schema actually matches — `tickets`, `ticket_lines`, `user_settings`, not a different Makaman project), otherwise `create_project` (check cost and confirm with the user first).
2. Apply `supabase/migrations/0001_init.sql` via `apply_migration`.
3. Deploy `supabase/functions/admin-actions/` via `deploy_edge_function`.
4. **Turn OFF email confirmation** in Auth settings. Field technicians are issued accounts by their manager and may not have working email on a rig; leaving confirmation on means they create an account and then cannot log in. This is a required setting, not a preference.

### A.2 Seed the first Admin

- Email: **`Lateri@makaman.ly`**
- Password: supplied in chat by the user.
- Create the auth user, then `update profiles set role='admin', status='active'` for that id (the trigger will have already inserted the pending row).
- **Tell the user to change this password after first login** — it was typed into a chat transcript.

### A.3 Environment variables

From `get_project_url` and `get_publishable_keys`:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

Set both in the Vercel project **and** in `app/.env.local` for local build testing.

### A.4 Deploy to Vercel

- Root directory: `app`
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`

### A.5 Verify on the live URL

Walk the whole flow, do not just check that it loads:

1. Log in as the seeded Admin.
2. Create a Technician account, and separately sign up a test account and approve it as Ops Manager.
3. Log a ticket as that technician with the location setting on.
4. Press Job Done.
5. Review it as Ops Manager: set ticket number, mileage, job type, add an item.
6. **Edit a ticket-level timestamp AND an individual job-log line timestamp; confirm both appear in the audit trail.**
7. Change theme, timezone and 12h/24h in Settings; reload and confirm they persist.
8. Log out.

---

## PART B — The four sheets (not yet built)

Layout preview only (`app/src/screens/ops/PrintPreview.jsx`) — no real file is generated.

### B.1 What the user still needs to send

1. **`Service Ticket (Original).xlsx`**
2. **`Job Log (Original).xlsx`**
3. **The price list workbook** — real item numbers, descriptions, units of measure and rates, per client.
4. **Cell mapping**, if the templates are not self-evident.

The two **(Copy)** sheets are exact mirrors of the Originals, so they don't need separate templates.

### B.2 Decisions already made — do not re-ask

- **Delivery: download from the app.** No cloud credentials needed.
- **Format: both Excel and PDF.**
- **Structure: both per-ticket and a running master workbook.**

### B.3 Field mapping

**Service Ticket** — Technician Name, Customer, Field Name, Well No., Rig Name, Ticket Number, Start Job and End Job dates, then per line: item number → description (fetched, overridable), Qty, unit of measure, unit cost, total cost.

**Job Log** — partial header mirror (Customer, Field, Well, Rig, Technician, Arrival, Start/End Job, Job Type), plus logged event lines with date/time on the left.

**Mileage** entered one way, charged round trip (×2).

### B.4 Implementation note

Generation should be a Supabase Edge Function, not the browser.

---

## 4. Known gaps and deliberate scope decisions

- **Ticket numbering is manual** with a uniqueness check at entry. Not an auto-assigner.
- **Price list data is placeholder** until the real workbook arrives (see B.1).
- **Logo is a placeholder mark** until the real artwork is supplied again.

## 5. Security notes worth carrying forward

- The `admin-actions` Edge Function runs with the service-role key and therefore bypasses RLS. It re-derives the caller's identity from their own JWT and re-checks their role on every action — never let it trust a `userId` or role supplied in the request body.
- Role changes to Admin or Ops Manager are restricted to Admins inside that function, independently of what the UI shows.
- The seeded Admin password was shared in a chat transcript and should be rotated.
