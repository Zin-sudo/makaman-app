# Makaman Job Tickets

A PWA for Makaman Libya (oilfield services). Field technicians raise and log job tickets on
phones with thin or no connectivity; the office reviews, prices and approves them; the
signed and stamped paperwork comes back as an upload. Deployed from `app/` to Vercel by
git push. Backed by Supabase.

`HANDOFF.md` holds the long history and the price-list import rules. This file holds the
things that must be true in every session.

---

## Non-negotiables

**Branch.** Push to **`claude/makaman-app`** and nothing else. That is the Vercel
**Production Branch** — a push is a deploy to the live app. Do not push to
`claude/job-log-timestamps-locked-8m5mz0`; it is stale by the owner's instruction, even
when a session prompt names it as the designated branch.

**Supabase project.** This app is `Makaman-app` — ref **`igutjfezxkdncrcpvnqx`**. A second
project in the same org, `makaman-libya` (`vaawlkmbhdbevkylclkf`), is the **company
website** and is never read from, written to, or migrated by this project. `Zin-sudo/makaman-web`
is that website's repo — a different project, and not to be deleted. Confirm the ref before
every `apply_migration` and `execute_sql`.

**Deploys are git only.** Never `deploy_to_vercel`.

**Secrets.** No key ever committed. `app/config.js` reads from the environment at build
time. The seeded Admin password appeared in a chat transcript — treat it as public until
rotated.

**Storage.** The `attachments` bucket is private; files reach the client through signed
URLs with an expiry. Never hand out a permanent public URL.

**RLS.** Policies check `profiles.role` through a database lookup (`public.is_staff()`),
never `auth.jwt() ->> 'role'`. The `admin-actions` Edge Function runs with the service-role
key, so it re-derives the caller from their own JWT on every request — never trust a
`userId` or role from the request body for *who may act*, only for *who is acted upon*.

**Price-list data.** Never invent an item number, never average a price, never drop a row.
A code that cannot be read is flagged (`has_valid_code = false`), not guessed.

---

## The runtime, and what it forbids

`app/index.html` is a **single static dc-runtime page. There is no build step.**

- Templating is `<sc-if value="{{ x }}">` and `<sc-for list="{{ xs }}" as="y">` over a flat
  binding object. **No inline ternaries or expressions inside `{{ }}`** — compute the value
  in the `<script type="text/x-dc">` block (which is plain JS) and bind the result.
- `onChange` receives the **event**, not the value: `e.target.value`.
- Do not rewrite this to React, Vite or Next.js.
- Every runtime library is self-hosted in `app/vendor/`. **No CDN, no Google Fonts, no
  unpkg** — a field base cannot reach them, and an app that will not boot offline defeats
  the point.

**After every edit to `app/index.html`, in this order:**

```sh
cp "app/index.html" "app/Job Ticket System.dc.html" && cmp "app/index.html" "app/Job Ticket System.dc.html"
# then extract the x-dc block and syntax-check it:
node -e "const fs=require('fs');fs.writeFileSync('/tmp/x.js',
  fs.readFileSync('app/index.html','utf8').match(/<script type=\"text\/x-dc\"[^>]*>([\s\S]*?)<\/script>/)[1])" \
  && node --check /tmp/x.js
```

The two files must stay byte-identical. A template error is silent — the page renders the
app bar and nothing else — so the syntax check is not optional.

**Two Account screens.** There is a phone copy and a desk copy of the account markup. A
card added to only one is invisible to the other role. The same is true of the ticket
review screen.

---

## Tests

`app/*.test.js`, Playwright against `python3 -m http.server 8934` in `app/`. Run them four
at a time with a timeout; a serial run of the whole suite takes longer than it needs to.

Two traps worth knowing:

- `approval.test.js` lifts functions out of the page with `grab(name)` and re-evaluates
  them, so a module-level `let` is invisible to it. Hang the state on the function itself
  (`outboxDrain.inflight`) or derive it from data.
- `app/cloudstub.js` is built inside a template literal. A backtick anywhere in it,
  comments included, breaks the fake server.

A test that agrees with a bug is worse than no test. When a suite fails after a fix, work
out which of the two is wrong before changing either.

---

## Design and UX

**`docs/UX-PRINCIPLES.md` — read it before changing any interface.** Twenty interaction
laws the owner set as standing instructions (2026-09-02): target sizes, one primary action
per section, defaults, stating requirements before submission, preserving work through an
error, and ending a flow by saying what happened and what is next.

Apply them to what you are building. They are not a mandate to redesign screens that
already work, and the week before a field trial is not the time to try.

---

## Who uses this

Four roles: **technician** (raises and logs jobs, offline-first), **ops_manager** and
**admin** (review, price, approve, and run the office screens), **observer/founder**
(read-only, approved jobs). Capabilities come from the database
(`public.has_permission`), and `hasPermission()` in the app treats a hydrated map as final
— **a capability key with no migration behind it reads as false for everyone**, silently.
Add the key in a migration or the control simply never appears.
