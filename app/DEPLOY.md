# Deploying this PWA

This folder **is** the app. `index.html` is what the browser loads; it is a
byte-for-byte copy of `Job Ticket System.dc.html`, which is the file Claude Design
edits. Everything is static — no build step, no npm install. React, ReactDOM,
Babel and the fonts are self-hosted in `vendor/`, so the app boots with no
network at all.

## Vercel settings

| Setting | Value |
|---|---|
| **Root Directory** | **`app`** |
| **Production Branch** | **`claude/makaman-app`** |
| Framework Preset | Other |
| Build Command | empty |
| Install Command | empty |
| Output Directory | empty |

`vercel.json` already pins framework/build/install to null, so the dashboard
presets cannot override them. Root Directory and Production Branch are the two
settings `vercel.json` cannot set for you — they must be right in the dashboard.

> Earlier revisions of this file said Root Directory should be `prototype` and
> warned against `app/`. That was true when the repo held two copies of the app.
> The `prototype/` folder no longer exists; `app/` is the real one.

## Checking which build is live

The build stamp is printed on the login screen, bottom centre, and again at the
bottom of Settings. Compare it against `BUILD` in `Job Ticket System.dc.html`.
If they differ, the browser is showing a cached or older deployment, not the
current one.

## Redeploying

A push to `claude/makaman-app` builds automatically. In the dashboard, use
**Redeploy on the newest deployment** — redeploying an older one rebuilds *that
commit*, which is the usual reason a redeploy appears to change nothing.

Untick "Use existing Build Cache" if a redeploy still serves stale files.

## ⚠ Keep index.html in sync

**After any edit to the `.dc.html`, re-copy:**

```sh
cd app && cp "Job Ticket System.dc.html" index.html
```

Verify: `cmp "Job Ticket System.dc.html" index.html && echo ok`
