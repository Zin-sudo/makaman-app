// Team screen's "Users & roles" table, 2026-09-09, owner's request: "The table of users
// there with sync status online or last contact should be hooked with the latest system."
//
// Before this fix, this table's own freshness computation only ever looked at a
// technician's last position fix and the newest syncedAt across tickets they crew — the
// exact same gap Field Devices had before the presence heartbeat: an office account
// (ops_manager/admin/observer) with no ticket of its own had no way to ever read as
// active here, and a technician who had only just signed in (heartbeat landed, no log
// line or sync yet) still read "Not heard from". This proves the fix: presenceSeen alone,
// with no ticket sync and no position fix at all, is now enough to read as recently in
// contact, and honors the same PRESENCE_ONLINE_MS window Field Devices uses rather than
// its own separate, shorter one.
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
    // Sped up so "over the threshold" can actually be observed in a test.
    window.__PRESENCE_ONLINE_TEST_MS = 3000;
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

  // A second office account, on nobody's crew and with no position fix ever — the exact
  // shape this fix is for. Added directly to the shaped `users` data (as hydrate() would
  // shape it), not via a live signup, since the point is the render-time computation.
  const OTHER = '99999999-9999-4999-8999-999999999999';
  await p.evaluate(([id]) => window.__mkApp.mutate(d => {
    d.users.push({ id, name: 'Layla Hassan', email: 'layla@makaman.ly', roleKey: 'mgr', role: 'Ops Manager', base: 'Ahmadi Base', lastSync: '', status: 'active' });
  }), [OTHER]);
  await p.waitForTimeout(300);

  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(300);
  await p.getByText('Team', { exact: true }).click();
  await p.waitForTimeout(300);
  let body = await p.innerText('body');
  check('before any heartbeat, an account with no ticket, no crew and no position fix reads as Not heard from',
    /Layla Hassan[\s\S]{0,80}Not heard from/.test(body), (body.match(/Layla Hassan[\s\S]{0,80}(In contact|Last heard[^\n]*|Not heard from)/) || [''])[0]);

  // Give it a fresh heartbeat with nothing else behind it — no ticket sync, no crew, no fix.
  await p.evaluate(([id]) => window.__mkApp.mutate(d => {
    d.presenceSeen = Object.assign({}, d.presenceSeen, { [id]: new Date().toISOString() });
  }), [OTHER]);
  await p.waitForTimeout(300);
  body = await p.innerText('body');
  check('a fresh presence heartbeat alone — no ticket sync, no crew, no position fix — reads as In contact',
    /Layla Hassan[\s\S]{0,80}In contact/.test(body), (body.match(/Layla Hassan[\s\S]{0,80}(In contact|Last heard[^\n]*|Not heard from)/) || [''])[0]);

  // Idle past the shared threshold, with nothing refreshing it — same PRESENCE_ONLINE_MS
  // Field Devices uses, not this table's own separate, shorter freshness window.
  await p.waitForTimeout(3200);
  await p.getByRole('button', { name: /‹ Inbox/i }).click();
  await p.waitForTimeout(200);
  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(200);
  await p.getByText('Team', { exact: true }).click();
  await p.waitForTimeout(300);
  body = await p.innerText('body');
  check('and goes stale past that same shared window, not stuck green forever',
    /Layla Hassan[\s\S]{0,80}Last heard/.test(body), (body.match(/Layla Hassan[\s\S]{0,80}(In contact|Last heard[^\n]*|Not heard from)/) || [''])[0]);

  await ctx.close();
  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
