#!/usr/bin/env python3
"""Geometry checks on the two PDFs wellgeo.test.js leaves behind.

The browser half can prove the coordinates are *in* the files. It cannot prove they are
readable, because a PDF whose columns overlap is still a valid PDF that downloads without
complaint — the damage only shows when somebody opens it. So the words are read back with
their coordinates and checked for collisions against the column that follows them.

Run wellgeo.test.js first; it writes the PDFs this reads.
"""
import sys, zipfile, pymupdf

TMP = '/tmp/claude-0/-home-user-makaman-app/d91117f5-d40f-52d2-8052-784fa32d1e1b/scratchpad/wellgeo'
ok = fails = 0


def check(name, passed, extra=''):
    global ok, fails
    if passed:
        ok += 1
    else:
        fails += 1
    print('  %s  %s%s' % ('PASS' if passed else 'FAIL', name, '   ' + extra if extra else ''))


def line_of(words, y, tol=4.0):
    """Words sharing a baseline, left to right. Grouped by y1 (the baseline) rather than
    y0, because the footnote is set smaller and so has a higher top edge than the value
    it sits beside — grouping on y0 would put them on different lines."""
    return sorted([w for w in words if abs(w[3] - y) < tol], key=lambda w: w[0])


# ── the overview bundle: Well column must not reach the Rig column ──────────
doc = pymupdf.open(TMP + '/bundle.pdf')
page = doc[0]
words = page.get_text('words')
heads = {w[4]: w for w in words if w[4] in ('Well', 'Rig')}
check('the overview still has Well and Rig columns', len(heads) == 2)
if len(heads) == 2:
    well_l, rig_l = heads['Well'][0], heads['Rig'][0]
    incol = [w for w in words
             if w[3] > heads['Well'][3] + 2 and well_l - 2 <= w[0] < rig_l - 1]
    # Grouped with a tolerance rather than on an exact key. The footnote is set at 5.6pt
    # beside an 8pt value, and a word's reported bottom edge includes its descender — so
    # two things drawn on the same baseline report different y, and an exact key would
    # split every row in two and then report half of them as missing coordinates.
    rows = []
    for w in sorted(incol, key=lambda w: w[3]):
        if rows and abs(w[3] - rows[-1][0]) < 4:
            rows[-1][1].append(w)
        else:
            rows.append((w[3], [w]))
    # -inf, not 0: seeding the worst case at zero means a run in which every row clears
    # the column comfortably still reports zero clearance and fails.
    worst = float('-inf')
    found_coords = 0
    for _, ws in rows:
        worst = max(worst, max(w[2] for w in ws) - (rig_l - 1))
        if any(w[4].startswith('[') for w in ws):
            found_coords += 1
    check('every well row carries its coordinates', found_coords == len(rows),
          '%d of %d rows' % (found_coords, len(rows)))
    check('and none of them reaches the Rig column', worst < 0,
          'closest approach %.1f pt' % -worst)

# ── the sheets: footnote must not reach the right-hand label ────────────────
def scan(zip_name):
    """Returns (sheets, with_coords, collisions) for one per-ticket zip."""
    z = zipfile.ZipFile(TMP + '/' + zip_name)
    sheets = withc = coll = 0
    for n in z.namelist():
        d = pymupdf.open(stream=z.read(n), filetype='pdf')
        for pi, pg in enumerate(d):
            ws = pg.get_text('words')
            anchor = [w for w in ws if w[4] == 'Well']
            if not anchor:
                continue
            sheets += 1
            row = line_of(ws, anchor[0][3])
            coords = [w for w in row if w[4].startswith('[') or w[4].endswith(']')]
            if not coords:
                continue
            withc += 1
            note_right = max(w[2] for w in coords)
            after = [w for w in row if w[0] > note_right + 0.5]
            if after and after[0][0] - note_right < 3:
                coll += 1
                print('     (%s %s p%d: footnote ends %.1f, next word starts %.1f)'
                      % (zip_name, n, pi, note_right, after[0][0]))
    return sheets, withc, coll


names = zipfile.ZipFile(TMP + '/ticket.zip').namelist()
check('the zip holds an originals PDF and a copies PDF',
      len(names) == 2 and any('ORIGINAL' in n for n in names) and any('COPY' in n for n in names),
      ', '.join(names))

sheets, withc, coll = scan('ticket.zip')
check('a normal well number gets its coordinates on all four sheets',
      sheets == 4 and withc == 4, '%d of %d sheets' % (withc, sheets))
check('and none of them collides with the next column', coll == 0, '%d collisions' % coll)

# The guard, exercised. A well number long enough to leave no room must lose the
# footnote rather than print it over the label beside it -- so the pass condition here
# is "no collision", and coordinates being absent is the guard doing its job, not a
# missing feature.
sheets_l, withc_l, coll_l = scan('ticket-longwell.zip')
check('an over-long well number never overlaps the next column',
      sheets_l == 4 and coll_l == 0, '%d sheets, %d with coords, %d collisions'
      % (sheets_l, withc_l, coll_l))

print('\n%d passed, %d failed' % (ok, fails))
sys.exit(1 if fails else 0)
