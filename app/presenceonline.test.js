// Online/idle presence badge on Field Devices. 2026-09-09, owner's request: "Online
// status detected automatically — and its status should be also refreshed when a user
// hits the refresh tab button their status should be switched from idle or red badge to
// green online badge on the Fields in Device menu so people can know that they are
// active on the app. When they're idle for over 1 hour their badge goes back to Red
// Idle/Offline."
//
// This is about the ACCOUNT being on the app at all, which matters even for a
// swapped-in office account with no ticket of its own — and, 2026-09-09, owner's
// follow-up report, it is now also what "Last contact" itself reads: a device whose
// position had just updated (a fresh log line, well within the online window) still
// showed a stale Last Contact, because that field used to come from ticket syncedAt
// alone, and a geo update is not a "sync" the way Job Done or a manual upload is. One
// shared derivation (fieldDevices) feeds both the technician's own "Devices on field"
// and the office's "Field devices" screen, so this only needs to prove it once.
const { chromium } = require('playwright-core');
const { TECH, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const DB = makeDB();
  assertStubParses(DB);
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: STUB(DB) }));
  await p.addInitScript(() => {
    window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
    // Sped up so "over an hour idle" can actually be observed in a test.
    window.__PRESENCE_ONLINE_TEST_MS = 3000;
  });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill('yousef@makaman.ly'); await i.nth(1).fill('whatever');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1500);

  // Logging in is itself a pull through refreshCore — "detected automatically," no
  // Force Refresh or swap needed for the very first heartbeat to land.
  let row = await p.evaluate(([id]) => window.__db.presence.find(r => r.profile_id === id), [TECH]);
  check('signing in writes a presence heartbeat on its own',
    !!(row && row.updated_at), JSON.stringify(row));
  check('with no view recorded — this account never swapped, only ever itself',
    row && row.active_view == null, JSON.stringify(row));

  await p.getByRole('button', { name: /^Sync$/i }).last().click();
  await p.waitForTimeout(500);
  let body = await p.innerText('body');
  check('freshly signed in reads as Online on Field Devices',
    /Online/.test(body) && !/Idle\/Offline/.test(body), (body.match(/Online|Idle\/Offline/) || [''])[0]);
  // The bug this heartbeat was actually asked to fix: this account has never synced a
  // ticket (cloudstub's fixture starts unsynced), so before folding the heartbeat into
  // Last Contact this line read "Never synced" even seconds after signing in.
  check('Last contact reflects the heartbeat too, not just a ticket sync',
    !/Never synced/.test(body), (body.match(/Last contact\n[^\n]*/i) || [''])[0]);

  // Idle past the (sped-up) threshold, with nothing refreshing in between — switching
  // tabs and back forces the render that actually re-evaluates "how long ago was that."
  await p.waitForTimeout(3200);
  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /^Sync$/i }).last().click();
  await p.waitForTimeout(300);
  body = await p.innerText('body');
  check('idle past the threshold with no further contact reads Idle/Offline',
    /Idle\/Offline/.test(body), (body.match(/Online|Idle\/Offline/) || [''])[0]);

  const beforeRefreshRow = await p.evaluate(([id]) => window.__db.presence.find(r => r.profile_id === id).updated_at, [TECH]);

  // The explicit ask: hitting Force Refresh switches it back to green.
  await p.getByRole('button', { name: 'Refresh current tab' }).click();
  await p.waitForTimeout(600);
  body = await p.innerText('body');
  check('Force Refresh switches the badge back to Online',
    /Online/.test(body) && !/Idle\/Offline/.test(body), (body.match(/Online|Idle\/Offline/) || [''])[0]);
  const afterRefreshRow = await p.evaluate(([id]) => window.__db.presence.find(r => r.profile_id === id).updated_at, [TECH]);
  check('and it actually reached the server as a fresh heartbeat, not just a client-side flip',
    new Date(afterRefreshRow).getTime() > new Date(beforeRefreshRow).getTime(),
    `${beforeRefreshRow} -> ${afterRefreshRow}`);

  // Idle again past the threshold — proves this is a genuine repeatable timeout, not a
  // one-shot flag that latches on once and never goes back.
  await p.waitForTimeout(3200);
  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /^Sync$/i }).last().click();
  await p.waitForTimeout(300);
  body = await p.innerText('body');
  check('and goes back to idle again afterwards, not stuck green from the one refresh',
    /Idle\/Offline/.test(body), (body.match(/Online|Idle\/Offline/) || [''])[0]);

  await ctx.close();
  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
