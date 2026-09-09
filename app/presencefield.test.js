// Field Devices, across roles. 2026-09-09, owner's request, twice over:
//
//   "Devices in field should also show admins, observers, ops whom are online and which
//   role they're using. for example if an admin is using the technician view, it should
//   be mentioned as well same as technicians. so the whole team knows who's online and
//   who's not."
//
//   "if someone is using a technician account or a view of the technician account they
//   should show on the Field devices list as well. and show as inactive if they jump
//   back to their administrative role view."
//
// Two halves, tested separately: the client-side read (fieldDeviceAccounts(), driven off
// D.presence — exercised here directly, the same way other suites mutate the store to
// arrange a scenario without needing a live round trip) and the cloud write itself
// (swapRole() actually reaching the presence table, against cloudstub.js).
const { chromium } = require('playwright-core');
const { TECH, OPS, TICKET, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── Client-side read: a swapped-in office account shows up, labelled, then drops off ──
  {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
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
    await p.waitForTimeout(1200);

    // Mahmoud Zaki (a real technician) already shows — the new fact under test is a
    // THIRD name appearing: an admin account, present only via the presence table.
    // Given its own real id: the demo/offline seed's users carry no `id` at all (a
    // pre-existing fact about that seed, unrelated to this feature — presence itself is
    // keyed on a real profiles.id, which only cloud mode ever has), so the seeded
    // "M. Lateri" admin cannot be the one used here without first giving it one.
    const adminId = await p.evaluate(() => {
      const app = window.__mkApp;
      const admin = {
        id: 'admin-test-id', name: 'M. Lateri', email: 'admin-test@makaman.ly', roleKey: 'admin',
        role: 'Admin', base: 'MKN Operations Base', status: 'active',
      };
      app.mutate(d => {
        d.users = d.users.filter(u => u.name !== 'M. Lateri').concat([admin]);
        d.presence = Object.assign({}, d.presence, { [admin.id]: 'tech' });
      });
      return admin.id;
    });
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /^Sync$/i }).last().click();
    await p.waitForTimeout(500);
    let body = await p.innerText('body');
    check('the swapped-in admin now shows on Field Devices', /M\. Lateri/.test(body), body.match(/M\. Lateri[^\n]*/));
    check('labelled with their real role, not left looking like a technician',
      /M\. Lateri\s*\(Admin\)/.test(body), body.match(/M\. Lateri[^\n]*/));

    // They jump back to their administrative role view — presence clears — and they
    // drop off the list entirely, exactly the "show as inactive" the request asked for.
    await p.evaluate((id) => window.__mkApp.mutate(d => {
      const p2 = Object.assign({}, d.presence); delete p2[id]; d.presence = p2;
    }), adminId);
    await p.waitForTimeout(400);
    body = await p.innerText('body');
    check('and once they swap back, they are gone from the list', !/M\. Lateri/.test(body));
    await ctx.close();
  }

  // ── The write itself: swapping in and out actually reaches the presence table ────────
  {
    const DB = makeDB();
    assertStubParses(DB);
    const ctx = await b.newContext({ serviceWorkers: 'block' });
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

    await p.getByRole('button', { name: /work as technician/i }).click();
    await p.waitForTimeout(600);
    let row = await p.evaluate(([opsId]) => window.__db.presence.find(r => r.profile_id === opsId), [OPS]);
    check('swapping in writes active_view: \'tech\' for this account', row && row.active_view === 'tech', JSON.stringify(row));

    await p.getByRole('button', { name: /back to ops manager/i }).click();
    await p.waitForTimeout(600);
    row = await p.evaluate(([opsId]) => window.__db.presence.find(r => r.profile_id === opsId), [OPS]);
    check('swapping back out clears it', row && row.active_view === null, JSON.stringify(row));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
