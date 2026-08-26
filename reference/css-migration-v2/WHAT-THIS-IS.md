# CSS migration package v2 — what it is, and what must not be done with it

Supplied 2026-08-26. **Stored, not applied.** Nothing in `app/` imports or reads anything
here. Read this before acting on the package's own README or IMPLEMENTATION_GUIDE.

## The one-line summary

The package is a **styled visual mockup plus a migration kit**. It is not a newer version
of this application, and its instructions to overwrite `index.html`, `support.js` and
`sw.js` would destroy the working app.

## What was checked

| Package file | Verdict |
|---|---|
| `makaman-responsive-theme-v2.css` | **Byte-identical** to `reference/makaman-responsive-theme-v2.css`, already analysed in HANDOFF §5. Duplicate deleted; the original stands. All three blockers unchanged. |
| `app/index.html` (43 KB) | A **mockup of four role screens**. Ours is 513 KB. It has **zero** `text/x-dc` blocks, and none of: numbering claim, office closure, outbox, Supabase, `sort_order`, co-op tickets, PDF export. `sheet` appears twice against our 122. Useful as a picture of the intended look. **Not an app.** |
| `app/support.js` (11 KB) | Its own header says "Add these functions to your existing support.js". Ours **is** the dc-runtime (69 KB, `evalDcLogic`, `loadReactUmd`). The guide's Path B says overwrite — that would stop the app booting at all. |
| `app/sw.js` | Cache **v5**. Ours is **v6** and precaches the Arabic face and the Excel template. Overwriting is a regression. |
| `app/manifest.webmanifest` | Different colours, for the package's palette. |
| `app/permissions.js` | A **third** permission model — 22 `can_*` toggles in three tiers, defaults hardcoded in JS. Live registry: 31 capabilities in Postgres, per-person grant **and** revoke, `hasPermission()`, RLS-backed (migrations 0013–0017). Incompatible vocabularies. This is HANDOFF §5 blocker 2, now with code attached. |
| `app/admin/permissions.html` | A standalone page. We already have this as a screen inside the app, driven by the live registry. |
| `migrations/*`, `docs/*` | **The genuinely useful part.** Find/replace patterns, before/after component examples, a console audit tool, and a step-by-step guide. |

## How to use it when Tier 6 comes

1. **Take the design, not the code.** Component examples and the token/spacing/breakpoint
   scale are the payload. `index.html`, `support.js`, `sw.js`, `manifest.webmanifest` and
   `permissions.js` are reference only.
2. **Never overwrite an `app/` file with a same-named file from here.** The names collide
   and the contents do not correspond.
3. **Resolve blocker 2 before any `data-perm-*` styling ships.** Either emit
   `data-perm-<key>` from `hasPermission()` using the registry's keys, or keep gating in
   the bindings and drop the CSS gating. Never both (B-15.2).
4. **Vendor Inter** and replace the Google Fonts `@import` first — CONSTRAINTS §5.
5. The printed sheet is sealed and tested (`mksheet.test.js`); a restyle cannot alter what
   customers sign. That was not true before 2026-08-26.
