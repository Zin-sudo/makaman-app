// Page sub-totals on a ticket that runs over one page.
//
// A page of ruled lines with no figure at the bottom is a page the customer cannot check.
// The point of printing sub-totals is that they are a column you can add up and compare
// against the Total — so the assertion that matters is not "a sub-total row exists" but
// "the sub-totals sum to the Total". A row showing a plausible wrong number would pass
// the first and fail the second.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function sheets(p, itemCount) {
  return p.evaluate((n) => {
    const app = window.__mkApp;
    const t = (app.state.data.tickets || []).find(x => x.status === 'approved') || app.state.data.tickets[0];
    app.mutate(d => {
      const x = d.tickets.find(y => y.id === t.id);
      x.items = Array.from({ length: n }, (_, i) => ({
        id: 'i' + i, code: 'MKN-' + (1000 + i), desc: 'Line ' + (i + 1),
        qty: 1, uom: 'Day', cost: 100 + i, kind: 'unit',
      }));
    });
    const SH = app.buildSheets(app.state.data.tickets.find(y => y.id === t.id));
    const num = (s) => Number(String(s).replace(/[^0-9.-]/g, ''));
    return {
      id: t.id,
      pages: SH.svcOriginal.length,
      cap: SH.itemCap,
      rows: SH.svcOriginal.map(pg => ({
        showSub: pg.showSubTotal, label: pg.subTotalLabel,
        sub: num(pg.subTotal), showTotal: pg.showTotal, total: num(pg.total),
        totalLabel: pg.totalLabel,
        realRows: pg.items.filter(r => r.code).length,
        // What this page actually prints, added up from the printed cells.
        ownRows: pg.items.filter(r => r.code).reduce((n, r) => n + num(r.total), 0),
      })),
      grand: num(SH.total),
    };
  }, itemCount);
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1100, height: 1200 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1500);

  // ── One page: no sub-total, because it would be the Total printed twice ──
  {
    const r = await sheets(p, 3);
    check('a short ticket is one page', r.pages === 1, r.pages + ' page(s), cap ' + r.cap);
    check('and shows no sub-total at all', r.rows.every(x => !x.showSub),
      JSON.stringify(r.rows.map(x => x.showSub)));
    check('just the Total', r.rows[0].showTotal && r.rows[0].total === r.grand,
      r.rows[0].total + ' vs ' + r.grand);
    check('labelled plainly — one page, no "all pages" qualifier needed',
      r.rows[0].totalLabel === 'Total =', r.rows[0].totalLabel);
  }

  // ── Over one page: a sub-total on every page, and they add up ────────────
  {
    const r = await sheets(p, 55);
    check('a long ticket splits into pages', r.pages > 1, r.pages + ' pages of ' + r.cap);
    check('every page carries a sub-total', r.rows.every(x => x.showSub),
      JSON.stringify(r.rows.map(x => x.showSub)));
    check('each one says which page it is', r.rows.every((x, n) =>
      x.label === 'Sub-total, page ' + (n + 1) + ' of ' + r.pages),
      JSON.stringify(r.rows.map(x => x.label)));
    // 2026-09-04, owner's request: a page separated from the others used to carry a
    // sub-total with nothing to check it against unless it happened to be the last one —
    // every page now repeats the running Grand Total alongside its own sub-total.
    check('every page carries the Total now, not only the last',
      r.rows.every(x => x.showTotal), JSON.stringify(r.rows.map(x => x.showTotal)));
    check('and it is the same grand figure on every page, not a per-page running sum',
      r.rows.every(x => Math.abs(x.total - r.grand) < 0.005),
      JSON.stringify(r.rows.map(x => x.total)));
    check('labelled as covering every page, since it now appears on more than one',
      r.rows.every(x => x.totalLabel === 'Grand Total (all pages) ='),
      JSON.stringify(r.rows.map(x => x.totalLabel)));

    // The claim that matters.
    const sum = r.rows.reduce((n, x) => n + x.sub, 0);
    check('the sub-totals add up to the Total', Math.abs(sum - r.grand) < 0.005,
      sum + ' vs ' + r.grand);
    check('and no page sub-total is just the grand total repeated',
      r.rows.slice(0, -1).every(x => Math.abs(x.sub - r.grand) > 0.005),
      JSON.stringify(r.rows.map(x => x.sub)));
    // The stronger claim, and the one that catches a plausible wrong number: each page's
    // figure is the sum of the rows printed on THAT page. An earlier version of this
    // assertion compared a full page against a part page and expected the full one to be
    // larger — which is only true if every line costs the same, and these rise, so a
    // 15-line page of dearer items out-totalled a 20-line page of cheaper ones. That was
    // a wrong assumption dressed as a test.
    check('each page sub-totals its own rows and nobody else\'s',
      r.rows.every(x => Math.abs(x.sub - x.ownRows) < 0.005),
      JSON.stringify(r.rows.map(x => x.sub + '/' + x.ownRows)));
    check('the first page is full and the last is not',
      r.rows[0].realRows === r.cap && r.rows[r.rows.length - 1].realRows < r.cap,
      r.rows.map(x => x.realRows).join(' + '));
  }

  // ── It reaches the printed page, not just the model ──────────────────────
  {
    const r = await sheets(p, 55);
    await p.evaluate((tid) => window.__mkApp.setState({ activeId: tid, mgrScreen: 'print' }), r.id);
    await p.waitForTimeout(1600);
    const seen = await p.evaluate(() => {
      const sheets = Array.from(document.querySelectorAll('.mk-sheet'));
      return {
        onPage: sheets.map(s => (s.innerText.match(/Sub-total, page \d+ of \d+/g) || []).length),
        firstLabel: (document.body.innerText.match(/Sub-total, page 1 of \d+/) || [''])[0],
      };
    });
    check('the sub-total is printed on the sheet itself',
      seen.onPage.filter(n => n > 0).length >= 2, JSON.stringify(seen.onPage));
    check('worded the same on the page as in the model', /Sub-total, page 1 of/.test(seen.firstLabel),
      seen.firstLabel);
    // And the sheet is still square and sealed — this edit went inside the seal.
    const shape = await p.evaluate(() => {
      const all = Array.from(document.querySelectorAll('.mk-sheet, .mk-sheet *'));
      return Array.from(new Set(all.map(e => getComputedStyle(e).borderRadius)));
    });
    check('and the sheet is still square', shape.length === 1 && shape[0] === '0px', JSON.stringify(shape));
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
