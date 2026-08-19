# Deploying this PWA

This folder **is** the app — the Claude Design build (`Job Ticket System.dc.html`).
It is fully static: React/ReactDOM/Babel load from unpkg at runtime, everything
else here is local. No build step, no npm install.

## Vercel settings

- **Root Directory: `prototype`**  ← the only setting that matters
- Framework Preset: **Other** (do not pick Vite)
- Build Command: none / empty
- Output Directory: leave empty (serves this folder as-is)

> Do **not** point Vercel at `app/`. That folder is a separate, older React
> rewrite that does not have any of the Claude Design work in it.

## ⚠ Keep index.html in sync

`index.html` is a byte-for-byte copy of `Job Ticket System.dc.html`. The `.dc.html`
is the file Claude Design edits; `index.html` is what the web server serves at `/`.

**After any Claude Design edit, re-copy:**

```sh
cd prototype && cp "Job Ticket System.dc.html" index.html
```

Verify they match: `cmp "Job Ticket System.dc.html" index.html && echo ok`
