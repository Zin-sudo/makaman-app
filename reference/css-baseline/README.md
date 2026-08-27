# CSS baseline — the way back

A rollback point for the Tier 6 theme work, taken **before** any of it landed.

| File | What it is |
|---|---|
| `index.pre-v2.html` | The whole `app/index.html` at commit `169399b`. **This is the rollback point.** |
| `styles.pre-v2.css` | The two `<style>` blocks from that file, extracted. **Reading copy only.** |
| `restore.sh` | Puts `index.pre-v2.html` back and re-mirrors the `.dc.html`. |

## Why the backup is a whole HTML file and not a stylesheet

Most of this app's styling is **inline `style=` attributes on the elements**, not rules in
the `<style>` blocks. Those two blocks hold the design tokens, a handful of shared classes
(`.mk-ticket-card`, `.mk-stack`, `.mk-appbar`, `.mk-toast`) and the print rules — perhaps a
tenth of what you actually see on screen.

So restoring only the CSS would put back the tokens and leave every inline colour, size and
spacing wherever the theme pass had moved it: a mixture of two designs, which looks worse
than either. `styles.pre-v2.css` is here to *read* and to diff against, so you can see what
changed in the token layer without scrolling through six thousand lines. It is not a
restore path, and `restore.sh` deliberately ignores it.

## Rolling back

```sh
sh reference/css-baseline/restore.sh --check   # what would change, touching nothing
sh reference/css-baseline/restore.sh           # roll it back
```

It restores `app/index.html`, re-copies it over `app/Job Ticket System.dc.html`, and stops.
Nothing is committed, so you can look before you keep it — and `git checkout -- app/` undoes
the rollback itself.

## The other way back

Git holds the same bytes at commit `169399b`:

```sh
git checkout 169399b -- app/index.html "app/Job Ticket System.dc.html"
```

There is a local tag `css-baseline-pre-v2` on that commit, but **it is local only** — this
environment's git proxy accepts branch pushes and refuses tag pushes, so the tag does not
exist on the remote and a fresh clone will not have it. Use the commit hash, or use the
files in this directory.

That is the reason this directory exists at all rather than a tag alone: a way back that
depends on remote metadata is a way back that can quietly not be there.

## Keeping it honest

This baseline is a snapshot, not a mirror — it does **not** move as the theme work
continues. That is the point: it is where the app looked the way it looked before any of
this started. If a later pass produces a new "known good" worth keeping, add it beside this
one with its own date and commit rather than overwriting this file.

After any restore, re-run the suites before trusting it:

```sh
cd app && python3 -m http.server 8934 &
for t in *.test.js; do node "$t"; done
```
