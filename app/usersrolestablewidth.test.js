// "Users & roles" table (Team screen and Users & Customers screen), 2026-09-18, owner's
// report: "the Users & Customers ... columns like sync and last position are stacking
// which is ugly."
//
// The table was `.mk-table-plain { width:100%; ... }` with no floor, sitting in a
// `grid-template-columns:1fr 1fr` panel where `.mk-2col > * { min-width: 0 }` explicitly
// lets it shrink past its own content's natural size. The wrapper div carries
// `overflow-x:auto`, but that never triggered — the table just compressed instead, so six
// columns (Name, Role, Base, Sync, Last position, actions) squeezed into half the desk
// viewport, wrapping the Sync dot+text into the clogged stack that was reported.
// `.mk-table-roles { min-width: 900px }` gives the table a floor wide enough for the five
// data columns to render unwrapped (measured natural need: ~670px), leaving the
// already-`flex-wrap`-by-design actions cell (select + up to four buttons, ~320px
// unwrapped) free to wrap onto its own second line when it must — that was never the
// reported problem. The wrapper scrolls past this floor instead of squashing the data
// columns into it again. This proves the floor is actually in effect on both copies of the
// table, and that a narrow panel genuinely scrolls rather than silently going back to
// compressing.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function open(ctx) {
  const p = await ctx.newPage();
  // Narrow enough on a desk-width viewport that a genuine 1fr half of mk-2col is well
  // under 900px — the exact squeeze the report was about.
  await p.setViewportSize({ width: 1000, height: 900 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  return p;
}
const login = async (p, email) => {
  const i = p.locator('input');
  await i.nth(0).fill(email);
  await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1300);
};

async function measure(p) {
  return p.evaluate(() => {
    const table = Array.from(document.querySelectorAll('table.mk-table-roles'))[0];
    if (!table) return null;
    const wrap = table.parentElement;
    return {
      tableWidth: table.getBoundingClientRect().width,
      wrapScrollWidth: wrap.scrollWidth,
      wrapClientWidth: wrap.clientWidth,
    };
  });
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── Team screen (Ops Manager's own copy of the table) ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'omar@makaman.ly');
    await p.getByText('Account', { exact: true }).first().click();
    await p.waitForTimeout(400);
    await p.getByText('Team', { exact: true }).click();
    await p.waitForTimeout(500);

    const m = await measure(p);
    check('Team screen: the table has the min-width floor rather than compressing to the panel',
      !!m && m.tableWidth >= 899, m ? `table width ${m.tableWidth}px (want >=899)` : 'table not found');
    check('and its wrapper genuinely scrolls past that floor instead of squashing content into it',
      !!m && m.wrapScrollWidth > m.wrapClientWidth + 1,
      m ? `scrollWidth ${m.wrapScrollWidth} vs clientWidth ${m.wrapClientWidth}` : '');
    await ctx.close();
  }

  // ── Users & Customers screen (Admin's copy of the same table) ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'lateri@makaman.ly');
    await p.getByText('Account', { exact: true }).first().click();
    await p.waitForTimeout(400);
    await p.getByText('Users & Customers', { exact: false }).first().click();
    await p.waitForTimeout(500);

    const m = await measure(p);
    check('Users & Customers screen: the table has the min-width floor rather than compressing to the panel',
      !!m && m.tableWidth >= 899, m ? `table width ${m.tableWidth}px (want >=899)` : 'table not found');
    check('and its wrapper genuinely scrolls past that floor instead of squashing content into it',
      !!m && m.wrapScrollWidth > m.wrapClientWidth + 1,
      m ? `scrollWidth ${m.wrapScrollWidth} vs clientWidth ${m.wrapClientWidth}` : '');

    // The specific symptom reported: the Sync cell (a dot plus a timestamp, laid out as a
    // single flex row) must not wrap onto a second line — a squeezed column was forcing
    // exactly that.
    const syncRowHeight = await p.evaluate(() => {
      const table = document.querySelector('table.mk-table-roles');
      if (!table) return null;
      const cells = Array.from(table.querySelectorAll('tbody td')).filter(td =>
        td.querySelector('span[style*="border-radius"]'));
      return cells.length ? cells[0].getBoundingClientRect().height : null;
    });
    // A genuinely single-line cell (8px top+bottom padding, one line of 13px text) measures
    // ~37px here; the wrapped/broken version measured ~57-58px. 48 sits clearly between the
    // two, so this catches a real regression back to wrapping without being fooled by
    // ordinary padding.
    check('the Sync dot+timestamp cell stays on one line, not stacked',
      syncRowHeight !== null && syncRowHeight < 48, 'cell height: ' + syncRowHeight);
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
