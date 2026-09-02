# Cleanup review — after v1.0.0

Written at the v1.0.0 release, after every edit in the launch batch had landed. Nothing
here is urgent and nothing here is a defect. It is the list of things that are heavier or
more duplicated than they need to be, with what it would cost to remove each.

**The rule applied while writing this: launch week is not the time.** Two dead bindings
that this batch itself created were removed, because they are provably mine and provably
unreferenced. Everything else is documented and left alone — deleting live-looking code to
satisfy a tidiness pass two days before technicians are trained on it is a bad trade, and
the risk is not symmetric: a missed cleanup costs nothing, a wrong deletion costs a trial.

---

## Done in this batch

| what | why it was unnecessary | risk taken |
|---|---|---|
| `awaitingDocsLabel` | the counting sentence for the awaiting-paperwork banner, orphaned when the banner became a tile. Its one consumer went with the banner. | none — single definition, zero references |
| `awaitingFilterOn` | added with the filter and never read; the tile and the strip each compute their own label. | none — same |
| `app/vendor/babel.min.js` (3.0 MB) | deliberately not loaded since the CDN removal. Kept only so the decision could be reversed; git history reverses it just as well. | none — the loader is lazy and no `x-import` in this app ends in `.jsx`/`.tsx`. `git log --diff-filter=D` finds it. |
| `reference/` (1.3 MB, 19 files) | three superseded CSS snapshots from the v2 theme migration, plus the source workbook. The workbook is still the source of truth for the sheet layout, so the two comments that named its path now say where in history it went instead. | none — recoverable; nothing in `app/` reads it at runtime |

---

## Candidates, deliberately left

### Bindings with no consumer in the markup

Found by extracting every `name:` at the top level of `renderVals()` and every identifier
inside `{{ }}`, then differencing. Verified individually rather than trusted — the first
pass reported 58 and most were false positives, consumed through a loop alias
(`{{ t.presenceDot }}`) which the naive regex read as `t`.

These four survive that check with a single definition and no reference anywhere:

- `showSuggested` — superseded by `showSuggestedEditable`, which adds the `!locked` test.
- `goTeam` — the Team screen is reached from the counter tiles now.
- `closeDialog` — every dialog closes through its own `confirm`/`cancel`.
- `hasAssets` — the asset panel tests `(t.assets || []).length` inline.

**Impact of removing:** four lines. **Risk:** low but not zero — the dc-runtime resolves
bindings by name at render time, so a name assembled at runtime would not appear in the
markup as a literal and this method cannot see it. Worth one grep each before deleting.
**Plan:** delete after the trial, one commit, with the suites run between each.

Not on this list, though the first pass flagged them: `cancelJob`, `withdrawTicket`,
`restoreTicket`, `deleteUser`, `setUserPassword`, `deletePriceRow`, `reopenTech`. Those are
dialog keys reached through `dialogs[S.dialog]`, which is exactly the dynamic case above.
`notifications_read_at`, `share_location`, `total_cost` and `autoRefreshToken` are database
columns and library options, not bindings at all.

### The duplicated Account and review markup

There is a phone copy and a desk copy of the Account screen and of the ticket review
screen. Roughly 400 lines each, and the duplication is a live hazard rather than a
cosmetic one: a card added to one is invisible to the other role, which has happened twice
in this project — the error-log card went into the office-only branch, and the sheet
preview into the phone one.

**Impact of unifying:** removes the class of bug entirely. **Risk: high.** The two copies
are not the same layout with different widths; they differ in field order, in what is
shown at all, and in which controls are offered. Unifying them means re-deciding those
differences, on the two screens every role uses, with no visual regression suite to catch
a mistake. **Plan:** not before there are screenshots to diff against. After the trial,
starting with the Account screen, which differs least.

### The two counter-tile arrays

`mgrStats` and `founderStats` build the same shape from different data and render through
two near-identical `sc-for` blocks. **Impact:** perhaps 20 lines. **Risk:** low. **Plan:**
fold into one helper when the next tile is added, not before — the duplication costs
nothing until something has to change in both.

### `S.role` versus `session.roleKey` versus `actingAs`

Three ways to ask who is using the app, and the cache policy had to consult all three to
get the swapped-admin case right. Not wrong, but it is the kind of thing that is wrong
eventually. **Plan:** one `who()` helper returning `{ role, acting, effective }`, after
the trial.

---

## Deferred database work, unchanged

- **20 `auth_rls_initplan` policies.** Each re-evaluates `auth.uid()` per row instead of
  once per query. Invisible at this volume — the largest table anyone selects is 2,610
  rows, and only the office reads it. Mechanical to fix, and touching twenty policies is
  not a launch-week change.
- **15 unindexed foreign keys.** Same reasoning: no table is large enough for the planner's
  choice to matter yet.

Both are worth doing in the first quiet week after the trial, together, with the advisor
re-run afterwards to confirm the count went to zero.
