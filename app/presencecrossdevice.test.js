// Live report, 2026-09-09: "Awhida saw his name plate online as operation manager but
// when he hit refresh tab his name plate disappeared and only technicians were shown."
//
// The presence heartbeat added earlier this session (for the online/idle badge) called
// syncPresence(this.state.actingAs || null) from refreshCore() — the SAME path an
// ordinary Force Refresh runs. `active_view` is server-side state shared across every
// device signed in as one account; `state.actingAs` is device-local. An ops manager
// swapped into Work as Technician on one device, then simply refreshed on a SECOND
// device signed into the same account that had never itself swapped — and that second
// device's own (unswapped) `null` overwrote the first device's `active_view: 'tech'`,
// un-swapping him everywhere the instant anyone touched Refresh, anywhere.
//
// One page stands in for two devices: syncPresence('tech') is called directly first,
// exactly the write "device A" (the one that actually swapped) would have made, without
// touching this page's own state.actingAs — then this page (unswapped, standing in for
// "device B") runs an ordinary refresh and the swap has to survive it.
const { chromium } = require('playwright-core');
const { OPS, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const DB = makeDB();
  assertStubParses(DB);
  const ctx = await b.newContext({ viewport: { width: 1300, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: STUB(DB) }));
  await p.addInitScript(() => {
    window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
  });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('whatever');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1500);

  check('this page never swapped — standing in for a second, unswapped device',
    await p.evaluate(() => !window.__mkApp.state.actingAs));

  // "Device A" swaps in — the write that actually happened, on a device this page never
  // touches or knows about.
  await p.evaluate(() => window.__mkApp.syncPresence('tech'));
  await p.waitForTimeout(300);
  let row = await p.evaluate(([id]) => window.__db.presence.find(r => r.profile_id === id), [OPS]);
  check('device A\'s swap lands', row && row.active_view === 'tech', JSON.stringify(row));

  // "Device B" (this page, still unswapped) does an entirely ordinary refresh.
  await p.getByRole('button', { name: 'Refresh current tab' }).click();
  await p.waitForTimeout(800);

  row = await p.evaluate(([id]) => window.__db.presence.find(r => r.profile_id === id), [OPS]);
  check('an unrelated device\'s own ordinary refresh does not un-swap the account everywhere',
    row && row.active_view === 'tech', JSON.stringify(row));
  check('but the heartbeat itself still landed — updated_at moved',
    !!(row && row.updated_at), JSON.stringify(row));

  // The real swap-out, on the device that actually holds it, still works exactly as before.
  await p.evaluate(() => window.__mkApp.syncPresence(null));
  await p.waitForTimeout(300);
  row = await p.evaluate(([id]) => window.__db.presence.find(r => r.profile_id === id), [OPS]);
  check('a genuine swap-out still clears it — this is not a heartbeat that can never be undone',
    row && row.active_view === null, JSON.stringify(row));

  await ctx.close();
  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
