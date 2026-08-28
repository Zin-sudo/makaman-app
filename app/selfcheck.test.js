// The self-check, checked.
//
// A diagnostic that always says "all good" is worse than no diagnostic: it converts an
// unknown into a false reassurance. So every assertion here is about it reporting the
// TRUTH — including the cases where the truth is bad. It is driven against the fake
// server, once healthy and once broken, and the two runs have to disagree.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

const { OPS, makeDB, STUB, assertStubParses } = require('./cloudstub.js');

function db(itemsPerClient) {
  const d = makeDB();
  d.clients = [];
  d.price_list_items = [];
  let n = 0;
  [['Waha Oil Company', itemsPerClient], ['AGOCO', 40]].forEach(([name, count], ci) => {
    const id = 'cc' + ci + '00000-0000-4000-8000-00000000000' + ci;
    d.clients.push({ id: id, name: name, currency: 'USD' });
    for (let i = 0; i < count; i++) {
      n++;
      d.price_list_items.push({ id: 'q' + String(n).padStart(5, '0'), client_id: id,
        item_number: 'MKN-' + n, description: 'line ' + i, uom: 'Day',
        unit_cost: 10, unit_cost_additional: null, currency: 'USD', has_valid_code: true });
    }
  });
  return d;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  const run = async (DB, opts) => {
    const ctx = await b.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
      status: 200, contentType: 'application/javascript', body: STUB(DB) }));
    // The Edge Function is a plain fetch, so it is intercepted here rather than in the stub.
    await p.route('**/functions/v1/admin-actions', r =>
      (opts && opts.edgeDown) ? r.abort() : r.fulfill({ status: 401, body: 'no' }));
    await p.addInitScript((o) => {
      window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
      window.__DRAIN_TEST_MS = 120;
      if (o && o.cap) window.__maxRows = o.cap;
    }, opts || {});
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    const i = p.locator('input');
    await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('whatever');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(2200);
    const rows = await p.evaluate(() => window.__mkApp.runSelfCheck());
    await ctx.close();
    return rows;
  };
  const find = (rows, name) => rows.find(r => r.name === name) || { ok: null, detail: 'not reported' };

  // ── A healthy deploy reports healthy ─────────────────────────────────────
  {
    const rows = await run(db(30));
    check('it produces a report', Array.isArray(rows) && rows.length > 5, (rows || []).length + ' lines');
    check('it names the build', find(rows, 'Build').detail.length > 3, find(rows, 'Build').detail);
    check('it confirms cloud mode', find(rows, 'Mode').ok, find(rows, 'Mode').detail);
    check('it reaches the project', find(rows, 'Reachable').ok, find(rows, 'Reachable').detail);
    check('it asks the server who you are', find(rows, 'Signed in (server)').ok,
      find(rows, 'Signed in (server)').detail);
    check('it resolves capabilities from the database', find(rows, 'Capabilities').ok,
      find(rows, 'Capabilities').detail);
    check('it reports the price lists complete', find(rows, 'Price lists complete').ok,
      find(rows, 'Price lists complete').detail);
    check('it counts what RLS actually returns',
      /\d+ ticket\(s\)/.test(find(rows, 'Tickets visible').detail),
      find(rows, 'Tickets visible').detail);
    check('it checks the edge function is deployed and refusing', find(rows, 'Edge function').ok,
      find(rows, 'Edge function').detail);
    // The service worker is deliberately blocked in this harness (the stub is served by
    // page.route, and a worker's fetch is invisible to it), so its check correctly
    // reports a failure here and is not part of the healthy-deploy claim.
    const ignore = ['Service worker'];
    check('nothing else is reported as a problem',
      rows.filter(r => !r.ok && ignore.indexOf(r.name) < 0).length === 0,
      JSON.stringify(rows.filter(r => !r.ok).map(r => r.name)));
    check('and the service worker check itself is honest about being off',
      find(rows, 'Service worker').ok === false, find(rows, 'Service worker').detail);
  }

  // ── A broken deploy reports broken ───────────────────────────────────────
  //
  // The check that matters most. If this passed while the edge function was unreachable,
  // the whole screen would be decoration.
  {
    const rows = await run(db(30), { edgeDown: true });
    check('an unreachable edge function is reported as a failure',
      find(rows, 'Edge function').ok === false, find(rows, 'Edge function').detail);
    check('and the rest of the report still completes', rows.length > 5, rows.length + ' lines');
  }

  // ── And it would have caught the bug that was actually reported ──────────
  //
  // The paging fault: the server holds more rows for a customer than the device received.
  // Run with paging defeated and the report must say so, per customer, with the shortfall.
  {
    const DB = db(30);
    const ctx = await b.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
      status: 200, contentType: 'application/javascript', body: STUB(DB) }));
    await p.route('**/functions/v1/admin-actions', r => r.fulfill({ status: 401, body: 'no' }));
    await p.addInitScript(() => {
      window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
      window.__DRAIN_TEST_MS = 120;
    });
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    const i = p.locator('input');
    await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('whatever');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(2200);
    // Throw away half of one customer's items on the device, exactly as a truncated
    // fetch would have left them, and ask the check what it thinks.
    const rows = await p.evaluate(() => {
      window.__mkApp.mutate(d => { d.clients[0].items = d.clients[0].items.slice(0, 10); });
      return window.__mkApp.runSelfCheck();
    });
    await ctx.close();
    const verdict = find(rows, 'Price lists complete');
    check('a short price list is caught', verdict.ok === false, verdict.detail);
    check('and the report names the customer and the shortfall',
      /Waha Oil Company short by 20/.test(verdict.detail), verdict.detail);
    // The number has to be a number. "short by NaN" reads as a finding and is an absence
    // of one — the same plausible-wrong-value trap that has bitten this project before.
    check('and never prints a fabricated figure', !/NaN|undefined/.test(verdict.detail), verdict.detail);
    check('the per-customer line shows got-of-server',
      /10 of 30/.test(find(rows, '  Waha Oil Company').detail),
      find(rows, '  Waha Oil Company').detail);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
