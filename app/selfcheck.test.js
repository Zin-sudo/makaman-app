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
    // Fetch a customer's list the way the office does, then throw away two thirds of it
    // on the device — exactly as a truncated fetch would have left it — and ask the check
    // what it thinks.
    //
    // The fetch has to happen first now. Price lists no longer come down at sign-in
    // (0045 refuses them to anyone outside the office, and the client stopped pulling
    // them for everyone), so the check has nothing to compare until the office has asked
    // for one. That is also why it reports "none fetched yet this session" rather than
    // "short by 30" on a device that is behaving correctly — a red line on a healthy
    // device is worse than no line.
    const rows = await p.evaluate(() => {
      const app = window.__mkApp;
      return app.ensurePriceList(app.state.data.clients[0].name).then(() => {
        app.mutate(d => { d.clients[0].items = d.clients[0].items.slice(0, 10); });
        return app.runSelfCheck();
      });
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

  // ── And it would have caught the outbox bugs too ──────────────────────────
  //
  // A week of numbering-claim handovers going nowhere, and sixteen dead rows retried in a
  // loop, were both invisible to every version of this check before tonight — it asked
  // whether the app could reach the server and stopped there. These three drive the checks
  // added to close that: what is queued and does it look stuck, what has been given up on
  // and is any of it worth retrying, and does this device's own claim agree with the
  // server's row.

  // A healthy but MID-SYNC device — something queued, nothing stuck yet — must not read as
  // a problem. A red line on every device that just made an edit is worse than no line.
  {
    const rows = await run(db(30));
    check('a freshly-queued op reads as healthy, not stuck',
      find(rows, 'Outbox').ok === true, find(rows, 'Outbox').detail);
  }

  // A queued op that has already failed a few times — the starvation shape, before it is
  // bad enough to be set aside.
  {
    const DB = db(30);
    const ctx = await b.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
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
    const rows = await p.evaluate(() => {
      const acct = (window.__mkApp.state.session || {}).email;
      const key = 'makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : '');
      localStorage.setItem(key, JSON.stringify([
        { key: 'audit_log:a1', table: 'audit_log', action: 'upsert', seq: 1,
          acct: acct, tries: 3, row: { id: 'a1', ticket_id: 'ttt', text: 'stuck' } },
      ]));
      return window.__mkApp.runSelfCheck();
    });
    await ctx.close();
    const verdict = find(rows, 'Outbox');
    check('an op retried several times without succeeding is caught',
      verdict.ok === false, verdict.detail);
    check('and the count and the retry number are both in plain words',
      /1 op\(s\) queued/.test(verdict.detail) && /3 time\(s\)/.test(verdict.detail), verdict.detail);
  }

  // A set-aside pile with both a terminal (dead job) and a retryable entry — the exact
  // split the banner now makes, named the same way.
  {
    const DB = db(30);
    const ctx = await b.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
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
    const rows = await p.evaluate(() => {
      const acct = (window.__mkApp.state.session || {}).email;
      const key = 'makaman.outbox.refused.v1' + (acct ? '.' + acct.toLowerCase() : '');
      localStorage.setItem(key, JSON.stringify([
        { at: new Date().toISOString(), why: 'the job is gone', n: 1, terminal: true,
          op: { key: 'audit_log:dead1', table: 'audit_log',
            row: { id: 'dead1', ticket_id: 'deleted-job-1' } } },
        { at: new Date().toISOString(), why: 'a policy since corrected', n: 1, terminal: false,
          op: { key: 'clients:c1', table: 'clients', row: { id: 'c1' } } },
      ]));
      return window.__mkApp.runSelfCheck();
    });
    await ctx.close();
    const verdict = find(rows, 'Set aside');
    check('a non-empty pile is a red line', verdict.ok === false, verdict.detail);
    check('terminal entries are named as Dismiss-only, not retryable',
      /1 terminal/.test(verdict.detail) && /Dismiss/.test(verdict.detail), verdict.detail);
    check('and what is actually worth retrying is called out separately',
      /1 worth pressing Retry/.test(verdict.detail), verdict.detail);
  }

  // ── The numbering claim, checked against the server directly ─────────────
  //
  // The row that took three sessions of live impersonation probes to pin down: this
  // device's own idea of who holds the claim, asked whether it actually agrees with what
  // the server has, rather than assumed from what the screen shows.
  {
    const rows = await run(db(30));
    const verdict = find(rows, 'Numbering claim');
    check('a device whose claim matches the server says so, and names who holds it',
      verdict.ok === true && /Omar Al-Saleh/.test(verdict.detail), verdict.detail);
  }
  {
    const DB = db(30);
    const ctx = await b.newContext({ viewport: { width: 1200, height: 950 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
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
    // The server's row (fixture) still names Omar. This device is told, locally, that
    // somebody else holds it — the exact shape of a queued handover that never reached
    // the server, or a hydrate that has not run since it moved.
    const rows = await p.evaluate(() => {
      const app = window.__mkApp;
      const other = (app.state.data.users || []).find(u => u.email !== 'omar@makaman.ly');
      app.mutate((d) => {
        d.numbering = { holderEmail: other ? other.email : 'nobody@nowhere.ly',
          holderName: other ? other.name : 'Nobody', since: new Date().toISOString(), history: [] };
      });
      return app.runSelfCheck();
    });
    await ctx.close();
    const verdict = find(rows, 'Numbering claim');
    check('a local claim that disagrees with the server is caught',
      verdict.ok === false, verdict.detail);
    check('and both sides are named, not just "wrong"',
      /this device shows/.test(verdict.detail) && /the server shows/.test(verdict.detail),
      verdict.detail);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
