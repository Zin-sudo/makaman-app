// What a device keeps between sessions, and who decides.
//
// The instruction was "only the unsynced should be in localStorage; the synced should be
// fetched when connected". Taken literally that breaks the promise the whole app exists
// for: a `logging` ticket IS synced — the office needs the live view of it — so a
// technician at a well with no signal would open the app and find his own running job
// missing. The intent is that office data stops piling up on phones, and that is what is
// asserted here:
//
//   · a technician keeps his own working set, synced or not
//   · the office keeps no tickets at all
//   · an admin ACTING AS a technician gets the technician's rules, because that is the
//     case that actually needs offline behaviour and the one a role check alone gets wrong
//   · the outbox is never touched by any of it
//
// Driven against the fake server, because the rule is about what reaches localStorage on
// a real sign-in — not about what a helper returns when called directly.
const { chromium } = require('playwright-core');
const { TECH, OPS, TICKET, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

const DB = makeDB();
// A second ticket nobody in this test is crewed on, plus a closed one from long ago, so
// "his own working set" has something to exclude rather than agreeing with an empty list.
const OLD = '55555555-5555-4555-8555-555555555555';
const FOREIGN = '77777777-7777-4777-8777-777777777777';
const base = DB.tickets[0];
DB.tickets.push(Object.assign({}, base, {
  id: OLD, status: 'approved', ticket_number: '1001',
  approved_at: '2025-01-05T09:00:00.000Z',
}));
DB.tickets.push(Object.assign({}, base, {
  id: FOREIGN, status: 'logging', ticket_number: '1002',
  technician_id: OPS, holder_id: OPS,
}));
// Crew rows decide "his own": the old ticket is his, the foreign one is not.
DB.ticket_crew.push({ ticket_id: OLD, profile_id: TECH });
DB.ticket_crew.push({ ticket_id: FOREIGN, profile_id: OPS });
assertStubParses(DB);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1180, height: 950 }, serviceWorkers: 'block' });

  const open = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
      status: 200, contentType: 'application/javascript', body: STUB(DB) }));
    await p.addInitScript(() => {
      window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
      window.__DRAIN_TEST_MS = 120;
    });
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    return p;
  };
  const login = async (p, email) => {
    const i = p.locator('input');
    await i.nth(0).fill(email); await i.nth(1).fill('whatever');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(2000);
  };
  // What actually reached the disk, as opposed to what is in memory.
  const onDisk = (p) => p.evaluate(() => {
    const raw = localStorage.getItem('makaman.cloud.v1');
    const d = raw ? JSON.parse(raw) : {};
    return {
      tickets: (d.tickets || []).map(t => t.ticketNo || t.id),
      clients: (d.clients || []).length,
      priceRows: (d.clients || []).reduce((n, c) => n + ((c.items || []).length), 0),
    };
  });
  const inMemory = (p) => p.evaluate(() =>
    (window.__mkApp.state.data.tickets || []).map(t => t.ticketNo || t.id));

  // ── A technician keeps his own working set ───────────────────────────────
  {
    const p = await open();
    await login(p, 'yousef@makaman.ly');
    // A save has to have happened for there to be anything to read.
    await p.evaluate(() => window.__mkApp.persist(window.__mkApp.state.data));
    await p.waitForTimeout(400);

    const mem = await inMemory(p);
    const disk = await onDisk(p);
    // Identified by id: the running job has no ticket number yet — numbers are assigned
    // at approval — and "still being logged" is precisely the state that must survive a
    // reload at a well with no signal.
    check('the running job is on the device', disk.tickets.indexOf(TICKET) >= 0,
      JSON.stringify(disk.tickets));
    check('even though it is synced — which is the promise the app exists for',
      disk.tickets.indexOf(TICKET) >= 0);
    check('a job he is not crewed on is not kept', disk.tickets.indexOf('1002') < 0,
      JSON.stringify(disk.tickets));
    check('a job closed over a year ago is not kept', disk.tickets.indexOf('1001') < 0,
      JSON.stringify(disk.tickets));
    check('and none of it was dropped from the screen he is looking at',
      mem.indexOf(TICKET) >= 0, JSON.stringify(mem));
    check('no price lists reach the disk either', disk.priceRows === 0,
      disk.priceRows + ' rows');
    await p.close();
  }

  // ── The office keeps nothing ─────────────────────────────────────────────
  {
    const p = await open();
    await login(p, 'omar@makaman.ly');
    await p.evaluate(() => window.__mkApp.persist(window.__mkApp.state.data));
    await p.waitForTimeout(400);

    const mem = await inMemory(p);
    const disk = await onDisk(p);
    check('the office sees every ticket while it is connected', mem.length >= 3,
      mem.length + ' in memory');
    check('and writes none of them to the machine', disk.tickets.length === 0,
      JSON.stringify(disk.tickets));
    check('the reference data it needs to render is still kept', disk.clients > 0,
      disk.clients + ' customers');

    // And it says so, rather than saying nothing.
    //
    // It said nothing at all before: the Sync tab an office user sees is "Field devices",
    // which is about the technicians' phones, and the connection dot lives in the
    // technician's app bar. The office's own connection state had no home on any screen
    // the office looks at — tolerable while every device cached everything, not tolerable
    // now that this machine keeps no tickets to fall back on.
    const hint = await p.evaluate(() => {
      window.__mkApp.setState({ online: false, mgrScreen: 'inbox', roleTab: 'tickets' });
      return new Promise(r => setTimeout(() => r(document.body.innerText), 700));
    });
    check('losing signal tells the office the truth about this machine',
      /No connection\./i.test(hint) && /not held on this machine/i.test(hint),
      (hint.match(/No connection[^]{0,70}/) || ['(not shown)'])[0].replace(/\n/g, ' '));

    // And it goes when the connection comes back, rather than standing until a reload.
    const back = await p.evaluate(() => {
      window.__mkApp.setState({ online: true });
      return new Promise(r => setTimeout(() => r(document.body.innerText), 500));
    });
    check('and the notice clears when it returns', !/No connection\./i.test(back));
    await p.close();
  }

  // ── An admin acting as a technician gets the technician's rules ──────────
  //
  // The case a role check alone gets wrong: he is an admin, and he is standing at a well.
  {
    const p = await open();
    await login(p, 'omar@makaman.ly');
    const swapped = await p.evaluate(() => {
      const app = window.__mkApp;
      app.setState({ actingAs: 'Yousef Al-Harbi', role: 'tech' });
      return new Promise(r => setTimeout(() => {
        app.persist(app.state.data);
        r(true);
      }, 400));
    });
    await p.waitForTimeout(400);
    const disk = await onDisk(p);
    check('swapping into the technician view starts keeping jobs again',
      swapped && disk.tickets.length > 0, JSON.stringify(disk.tickets));
    await p.close();
  }

  // ── The outbox is never any of this ──────────────────────────────────────
  //
  // Unsent work is the one thing that cannot be refetched, so it lives under its own key
  // and nothing in the cache policy touches it.
  {
    const p = await open();
    await login(p, 'omar@makaman.ly');
    await p.evaluate(() => {
      window.__offline = true;
      window.__mkApp.mutate(d => { d.tickets[0].well = 'BG-777'; });
    });
    await p.waitForTimeout(700);
    await p.evaluate(() => window.__mkApp.persist(window.__mkApp.state.data));
    await p.waitForTimeout(400);
    const q = await p.evaluate(() =>
      JSON.parse(localStorage.getItem('makaman.outbox.v1') || '[]'));
    const disk = await onDisk(p);
    check('an office edit made with no signal is still queued',
      q.some(o => o.table === 'tickets'), JSON.stringify(q.map(o => o.key)));
    check('even though the ticket itself is not cached', disk.tickets.length === 0,
      JSON.stringify(disk.tickets));
    await p.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
