// 2026-09-11, owner's report, with a live incident: "I logged to Awhida's account via the
// PC and encountered a series of bugs... ticket was duplicated x4 times, one was approved
// by ops and 3 still in-progress status causing the errors and having the same exact
// metadata and logs as the original this was caused by a Google Chrome extension named
// 'Mobile View — Mobile Simulator & Preview' which treated the user as 4 different users...
// it should not be allowed to submit the same actions simply by using multiple previews
// from different devices or using extensions for testing. this is a breach door and also a
// cause for spam and errors on the server please set guards around it."
//
// Traced live (ticket 1885): four createTicket() calls, same technician/customer/field/
// well/rig, 2.3 seconds apart — then every log line after the first landing on the
// surviving ticket four times over, seconds apart. Two client-side guards close this off
// (claimTicketCreate, isDuplicateLogLine), and a third change stops the resulting
// tickets_ticket_number_key conflict from being retried seventeen times before anyone
// notices it can never succeed. The database-level backstop (migration 0075) is proven
// live in supabase/checks/regression_guards.sql — this file is the client half.
const { chromium } = require('playwright-core');
const { makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

// The first call for a given context clears storage and signs in for real, seeding the
// demo and this device's session key. Every later call on the SAME context is the mirrored-
// extension shape itself: a fresh page (its own in-memory app, own JS realm — exactly like
// one of the four device-preview iframes), navigating to a session ALREADY sitting in this
// origin's shared localStorage, with nothing of its own to log in with.
async function bootLocal(ctx, email, ms, fresh, logLineMs) {
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(([testMs, lineMs]) => {
    window.MAKAMAN_CONFIG = { authMode: 'local' };
    if (testMs) window.__DUP_TICKET_CREATE_TEST_MS = testMs;
    if (lineMs) window.__DUP_LOG_LINE_TEST_MS = lineMs;
  }, [ms, logLineMs]);
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  if (fresh) {
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    const i = p.locator('input');
    await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(1200);
  } else {
    await p.waitForTimeout(900); // already signed in via this origin's shared localStorage
  }
  return p;
}
const fillNewTicket = (p, well) => p.evaluate((w) => {
  window.__mkApp.setState({ techScreen: 'new', draft: {
    arrival: new Date().toISOString(), tech: (window.__mkApp.state.session || {}).name,
    customer: 'Waha Oil Company', field: 'FIELD-11', well: w, rig: 'RIG-11',
  }});
}, well);
const ticketCount = (p, well) => p.evaluate((w) =>
  (window.__mkApp.state.data.tickets || []).filter(t => t.well === w).length, well);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── Two independent copies of the app, same account, same localStorage — exactly the
  //    mirrored-extension shape — both try to create the identical ticket ──────────────
  {
    const ctx = await b.newContext();
    await bootLocal(ctx, 'yousef@makaman.ly', 3000, true); // seed the account key first
    const p1 = await bootLocal(ctx, 'yousef@makaman.ly', 3000, false);
    const p2 = await bootLocal(ctx, 'yousef@makaman.ly', 3000, false);

    await fillNewTicket(p1, 'DUP-WELL-1');
    await p1.evaluate(() => window.__mkApp.renderVals().createTicket());
    await p1.waitForTimeout(300);
    check('the first copy creates its ticket', await ticketCount(p1, 'DUP-WELL-1') === 1);

    await fillNewTicket(p2, 'DUP-WELL-1');
    await p2.evaluate(() => window.__mkApp.renderVals().createTicket());
    await p2.waitForTimeout(300);
    check('the second copy — same content, moments later — refuses rather than duplicating',
      /already started|not creating a second/i.test(await p2.innerText('body')));
    check('and it never created a ticket of its own for that well',
      await ticketCount(p2, 'DUP-WELL-1') === 0, 'p2 has its own in-memory copy, so this checks p2 did not push one');

    // A genuinely different well, same instant, must NOT be blocked.
    await fillNewTicket(p2, 'DUP-WELL-2');
    await p2.evaluate(() => window.__mkApp.renderVals().createTicket());
    await p2.waitForTimeout(300);
    check('a genuinely different well is never blocked by the guard',
      await ticketCount(p2, 'DUP-WELL-2') === 1);

    // Past the window, the same content is a legitimate new job and goes through.
    await p1.waitForTimeout(3000);
    await fillNewTicket(p1, 'DUP-WELL-1');
    await p1.evaluate(() => window.__mkApp.renderVals().createTicket());
    await p1.waitForTimeout(300);
    check('once the window has passed, the same job can genuinely be opened again',
      await ticketCount(p1, 'DUP-WELL-1') === 2, '2nd is a legitimate later visit, not the race');
    await ctx.close();
  }

  // ── The same mirrored input duplicating every log line after the ticket itself ──────
  {
    const ctx = await b.newContext();
    const p = await bootLocal(ctx, 'yousef@makaman.ly', 0, true, 2000);
    const id = await p.evaluate(() =>
      (window.__mkApp.state.data.tickets || []).find(t => t.status === 'logging').id);
    const eventCount = () => p.evaluate((tid) =>
      (window.__mkApp.state.data.tickets.find(t => t.id === tid).events || []).length, id);
    const before = await eventCount();

    await p.evaluate((tid) => window.__mkApp.setState({ activeId: tid, techScreen: 'log', newEventText: 'MAKEUP 7" PKR' }), id);
    await p.evaluate(() => window.__mkApp.renderVals().addEvent());
    await p.waitForTimeout(150);
    check('the first submission of a line is logged', await eventCount() === before + 1);

    // Mirrored input fires the identical submission again, moments later.
    await p.evaluate(() => window.__mkApp.setState({ newEventText: 'MAKEUP 7" PKR' }));
    await p.evaluate(() => window.__mkApp.renderVals().addEvent());
    await p.evaluate(() => window.__mkApp.setState({ newEventText: 'MAKEUP 7" PKR' }));
    await p.evaluate(() => window.__mkApp.renderVals().addEvent());
    await p.evaluate(() => window.__mkApp.setState({ newEventText: 'MAKEUP 7" PKR' }));
    await p.evaluate(() => window.__mkApp.renderVals().addEvent());
    await p.waitForTimeout(150);
    check('three more identical, immediate resubmissions add nothing — not four lines for one action',
      await eventCount() === before + 1, 'count=' + await eventCount());
    check('and says so, rather than silently dropping them',
      /not added again/i.test(await p.innerText('body')));

    // A genuinely different line right after is never blocked.
    await p.evaluate(() => window.__mkApp.setState({ newEventText: 'RIH & SET @ 5000ft' }));
    await p.evaluate(() => window.__mkApp.renderVals().addEvent());
    await p.waitForTimeout(150);
    check('a genuinely different line logs normally', await eventCount() === before + 2);

    // Past the window, the exact same text is presumably a real second occurrence.
    await p.waitForTimeout(2600);
    await p.evaluate(() => window.__mkApp.setState({ newEventText: 'RIH & SET @ 5000ft' }));
    await p.evaluate(() => window.__mkApp.renderVals().addEvent());
    await p.waitForTimeout(150);
    check('once the window has passed, the same text can genuinely be logged again',
      await eventCount() === before + 3);
    await ctx.close();
  }

  // ── A duplicate-key refusal is terminal on the first try, not retried seventeen times ─
  {
    const DB = makeDB();
    assertStubParses(DB);
    const ctx = await b.newContext({ viewport: { width: 1180, height: 950 }, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
      status: 200, contentType: 'application/javascript', body: STUB(DB) }));
    await p.addInitScript(() => {
      window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
      window.__DRAIN_TEST_MS = 100;
    });
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    const i = p.locator('input');
    await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('x');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(1700);

    await p.evaluate((msg) => {
      window.__failInsert = 'tickets';
      window.__failMessage = msg;
      const acct = (window.__mkApp.state.session || {}).email;
      const k = 'makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : '');
      localStorage.setItem(k, JSON.stringify([
        { key: 'tickets:dupnum', table: 'tickets', action: 'upsert_ticket', seq: 1, acct: acct,
          row: { id: 'dupnum', version: 1, technician_id: '00000000-0000-4000-8000-0000deadbeef', ticket_number: '1885' } },
      ]));
    }, 'duplicate key value violates unique constraint "tickets_ticket_number_key"');

    await p.evaluate(() => window.__mkApp.refresh().catch(() => {}));
    await p.waitForTimeout(900);

    const dead = await p.evaluate(() => {
      const acct = (window.__mkApp.state.session || {}).email;
      return JSON.parse(localStorage.getItem(
        'makaman.outbox.refused.v1' + (acct ? '.' + acct.toLowerCase() : '')) || '[]');
    });
    check('a duplicate ticket number is set aside on the FIRST refusal, not retried',
      dead.length === 1, JSON.stringify(dead.map(d => d.op && d.op.key)));
    check('and marked as something that can never be sent by trying again',
      dead.length === 1 && dead[0].terminal === true, JSON.stringify(dead));
    check('the queue is empty rather than stuck retrying it',
      (await p.evaluate(() => {
        const acct = (window.__mkApp.state.session || {}).email;
        return JSON.parse(localStorage.getItem(
          'makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : '')) || '[]');
      })).length === 0);
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
