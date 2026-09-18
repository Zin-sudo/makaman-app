// Field Devices, 2026-09-18, owner's request: "Allow ops and admins to also show on
// field devices even when not using technician view."
//
// Before this, fieldDeviceAccounts() only ever added an Ops Manager or Admin to the list
// while they were swapped into a technician view (D.presence[id] === 'tech', proven by
// presencefield.test.js) — an ops_manager or admin simply using the app in their own
// role, however recently, was invisible here. This proves the new path: signing in alone
// (no swap at all) is enough, it reads Online/Idle the same shared way every other card
// does, and it goes quiet again once presence goes stale — same honesty rule, just no
// longer gated on the swap.
const { chromium } = require('playwright-core');
const { OPS, TECH, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
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

  // Never swapped — confirm the presence table agrees, so a pass here is actually about
  // the new online-staff path and not accidentally riding the existing swap path.
  const row = await p.evaluate(([opsId]) => window.__db.presence.find(r => r.profile_id === opsId), [OPS]);
  check('Omar signed in without ever swapping into a technician view',
    row && row.active_view == null, JSON.stringify(row));

  await p.getByRole('button', { name: /^Sync$/i }).last().click();
  await p.waitForTimeout(500);
  let body = await p.innerText('body');
  const fieldSection = body.split('Field devices')[1] || '';
  check('Omar (Ops Manager) shows on Field Devices while online, unswapped',
    /Omar Al-Saleh/.test(fieldSection), fieldSection.match(/Omar Al-Saleh[^\n]*/));
  check('labelled with his real role, not left looking like a technician',
    /Omar Al-Saleh\s*\(Operations Manager\)/.test(fieldSection), fieldSection.match(/Omar Al-Saleh[^\n]*/));
  check('and a real technician still shows too — this is additive, not a replacement',
    /Yousef Al-Harbi/.test(fieldSection));
  check('reading Online, the same shared badge every other card uses',
    /Omar Al-Saleh[\s\S]{0,120}Online/.test(fieldSection));

  // Idle past the (sped-up) threshold, nothing refreshing his own presence in between —
  // he should go quiet exactly like a technician does, not stay pinned once seen.
  await p.waitForTimeout(3200);
  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /^Sync$/i }).last().click();
  await p.waitForTimeout(300);
  body = await p.innerText('body');
  check('and drops off the list again once his own presence goes stale',
    !/Omar Al-Saleh/.test(body.split('Field devices')[1] || ''));

  await ctx.close();
  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
