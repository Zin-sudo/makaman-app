// The whole table, not the first page of it.
//
// The app asked PostgREST for price_list_items with a plain select and no range. PostgREST
// answers a plain select with at most db-max-rows — 1,000 by default — and says nothing
// about what it withheld. The price lists hold 2,610 rows, and rows are grouped onto their
// client by id, so a customer whose rows fell past the cut had NO ITEMS AT ALL. Measured
// against the live database, a capped fetch delivered Waha 689/689, HOO 311/421, and
// AGOCO, Sirte and Zueitina zero of 245, 372 and 883.
//
// Worse than a fixed truncation, it drifted: an unordered select returns rows in heap
// order and any UPDATE rewrites that row to the end of the heap, so correcting one price
// silently changed which items existed for everyone. That is why some items could be
// missing from search one day and present the next.
//
// So the fixture is deliberately bigger than one page, split unevenly across five
// customers in the same proportions as the real lists, and the fake server truncates
// every page exactly the way the real one does.
//
// WHERE THE PAGER LIVES NOW. These rows no longer come down at sign-in. Migration 0045
// refuses price_list_items to anyone outside the office and the client stopped pulling
// them for everybody; a single customer's list is fetched when the office opens something
// that needs it (ensurePriceList → pageAll). That is a change of caller, not of pager —
// the same count-driven fan-out, and the same way to get it wrong — so the fixture, the
// caps and every count below are unchanged. Only the line that asks has moved.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

const { TECH, OPS, makeDB, STUB, assertStubParses } = require('./cloudstub.js');

// Five customers, 2,610 items, in the real proportions.
const SHAPE = [
  ['Waha Oil Company', 689], ['Zueitina Oil Company', 883], ['Harouge Oil Operations (HOO)', 421],
  ['Sirte Oil Company (SOC)', 372], ['AGOCO', 245],
];
function bigDB() {
  const db = makeDB();
  db.clients = [];
  db.price_list_items = [];
  let n = 0;
  SHAPE.forEach(([name, count], ci) => {
    const id = 'c' + ci + '0000000-0000-4000-8000-00000000000' + ci;
    db.clients.push({ id: id, name: name, currency: name.indexOf('Sirte') >= 0 ? 'LYD' : 'USD' });
    for (let i = 0; i < count; i++) {
      n++;
      db.price_list_items.push({
        // Zero-padded so the id sort the app now applies is a stable total order rather
        // than a lexicographic surprise at the 1000 mark.
        id: 'p' + String(n).padStart(5, '0'),
        client_id: id, item_number: 'MKN-' + String(n).padStart(5, '0'),
        description: name.split(' ')[0] + ' line ' + (i + 1), uom: 'Day',
        unit_cost: 100 + i, unit_cost_additional: null, currency: 'USD', has_valid_code: true,
      });
    }
  });
  return db;
}

(async () => {
  const DB = bigDB();
  assertStubParses(DB);
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 950 }, serviceWorkers: 'block' });

  const open = async (maxRows) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
      status: 200, contentType: 'application/javascript', body: STUB(DB),
    }));
    await p.addInitScript((cap) => {
      window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
      window.__DRAIN_TEST_MS = 120;
      window.__maxRows = cap;
    }, maxRows);
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    const i = p.locator('input');
    await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('whatever');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(2600);
    return p;
  };
  // Every customer's list, fetched the way the office fetches them — one at a time, on
  // demand. Sequentially rather than all at once, so a shortfall belongs to one request
  // and not to five racing each other.
  const counts = (p) => p.evaluate(() => {
    const app = window.__mkApp;
    const names = (app.state.data.clients || []).map(c => c.name);
    return names.reduce((chain, n) => chain.then(() => app.ensurePriceList(n)),
      Promise.resolve())
      .then(() => (app.state.data.clients || [])
        .map(c => c.name + ':' + (c.items || []).length));
  });

  // ── The fixture really is bigger than one page ───────────────────────────
  {
    const total = SHAPE.reduce((n, x) => n + x[1], 0);
    check('the fixture is larger than a single page', total === 2610 && total > 1000, total + ' rows');
  }

  // ── Nothing arrives uninvited ────────────────────────────────────────────
  //
  // The first thing to be sure of, now that the office asks: that nobody was handed the
  // pricing without asking. A phone at a wellhead holding 2,610 priced lines is the fault
  // migration 0045 exists to close, and a client-side regression would put them back.
  {
    const p = await open(1000);
    const atSignIn = await p.evaluate(() =>
      (window.__mkApp.state.data.clients || []).reduce((n, c) => n + (c.items || []).length, 0));
    check('signing in brings no price-list rows at all', atSignIn === 0, atSignIn + ' rows');
    await p.close();
  }

  // ── Under the real cap, every customer arrives whole ─────────────────────
  {
    const p = await open(1000);
    const got = await counts(p);
    check('every customer is present', got.length === 5, JSON.stringify(got));
    SHAPE.forEach(([name, count]) => {
      check('  ' + name + ' has all ' + count + ' items',
        got.indexOf(name + ':' + count) >= 0,
        (got.find(x => x.indexOf(name + ':') === 0) || 'missing'));
    });
    // The ones the user actually reported empty.
    check('AGOCO is not empty — the reported symptom', got.indexOf('AGOCO:245') >= 0);
    check('Zueitina is not empty — the reported symptom', got.indexOf('Zueitina Oil Company:883') >= 0);

    // And an item from the far end of the table can be found, which is what "some Waha
    // items would not come up in search" was really about.
    const last = await p.evaluate(() => {
      const cs = window.__mkApp.state.data.clients || [];
      const c = cs[cs.length - 1];
      const items = c.items || [];
      return items.length ? { client: c.name, code: items[items.length - 1].code } : null;
    });
    check('the last item of the last customer exists', !!last && !!last.code, JSON.stringify(last));
    await p.close();
  }

  // ── A tighter cap changes nothing, because it is paged ───────────────────
  //
  // If the fix were "ask for more rows" rather than "keep asking", a smaller page would
  // break it again. 250 forces four round trips for the largest customer.
  {
    const p = await open(250);
    const got = await counts(p);
    check('with a 250-row page the counts are identical',
      SHAPE.every(([name, count]) => got.indexOf(name + ':' + count) >= 0),
      JSON.stringify(got));
    await p.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
