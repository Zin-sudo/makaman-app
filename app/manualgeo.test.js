// Ops/admin can manually set, correct, or remove a ticket's GPS coordinates.
//
// 2026-09-09, owner's request, verbatim: "ops and admin should have the ability to
// manually modify, remove, add the coordinates of the well site if the arrival GPS ping
// didn't capture automatically from the technician's device."
//
// Gated on a real capability (location.edit — migration 0065), not just a role check,
// so an office account without it still sees the read-only text.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function open(ctx, email) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1300, height: 1000 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1400);
  return p;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── Adding coordinates where none were ever captured ────────────────────────────────
  {
    const ctx = await b.newContext();
    const p = await open(ctx, 'omar@makaman.ly');
    await p.evaluate(() => {
      const app = window.__mkApp;
      app.mutate((d) => { d.tickets.find(t => t.id === 't1').geo = null; });
      app.openReview('t1');
    });
    await p.waitForTimeout(700);
    let body = await p.innerText('body');
    check('with nothing recorded, the office still sees a way to add it (not the "no device position" dead end)',
      /Device position/i.test(body) && !/No device position recorded/i.test(body));

    const wellInput = p.locator('input[placeholder*="lat, lon"]').first();
    await wellInput.fill('28.906745, 19.213311');
    await p.locator('body').click();
    await p.waitForTimeout(500);
    const geo1 = await p.evaluate(() => window.__mkApp.state.data.tickets.find(t => t.id === 't1').geo);
    check('typing "lat, lon" writes a real fix', geo1 && geo1.open && geo1.open.lat === 28.906745 && geo1.open.lon === 19.213311, JSON.stringify(geo1));
    check('marked as manually entered, not a device GPS reading', geo1.open.source === 'manual', JSON.stringify(geo1.open));
    const trail = await p.evaluate(() => window.__mkApp.state.data.tickets.find(t => t.id === 't1').audit.map(a => a.text));
    check('the manual entry is on the audit trail, naming who and what',
      trail.some(t => /Well location set manually by Omar Al-Saleh: 28\.906745, 19\.213311/.test(t)), JSON.stringify(trail));

    // ── Correcting an existing fix ──
    await wellInput.fill('28.900000, 19.200000');
    await p.locator('body').click();
    await p.waitForTimeout(500);
    const geo2 = await p.evaluate(() => window.__mkApp.state.data.tickets.find(t => t.id === 't1').geo);
    check('re-entering a different value corrects it', geo2.open.lat === 28.9 && geo2.open.lon === 19.2, JSON.stringify(geo2.open));

    // ── An invalid entry is refused, not silently accepted ──
    await wellInput.fill('not a coordinate');
    await p.locator('body').click();
    await p.waitForTimeout(400);
    body = await p.innerText('body');
    check('garbage input is refused with a plain-language message',
      /enter as "lat, lon"/i.test(body));
    const geo3 = await p.evaluate(() => window.__mkApp.state.data.tickets.find(t => t.id === 't1').geo);
    check('and the last good value is kept, not overwritten with garbage',
      geo3.open.lat === 28.9 && geo3.open.lon === 19.2, JSON.stringify(geo3.open));

    // ── Removing it ──
    await wellInput.fill('');
    await p.locator('body').click();
    await p.waitForTimeout(500);
    const geo4 = await p.evaluate(() => window.__mkApp.state.data.tickets.find(t => t.id === 't1').geo);
    check('clearing the field removes the coordinate entirely', !geo4.open, JSON.stringify(geo4));
    await ctx.close();
  }

  // ── An office role WITHOUT the capability sees read-only text, not an input ─────────
  // Ops Manager/Admin without location.edit is the real "office can view, cannot
  // correct" case (default_roles is ['ops_manager', 'admin'] only) — checked against
  // omar@makaman.ly directly rather than mocking a permission override, same reasoning
  // this file's other cases already use.
  //
  // 2026-09-11: this used to also check founder@makaman.ly here, on the theory that the
  // Observer read this same "Device position" panel on the office's own review screen.
  // They no longer do — founderPeek routes the Observer through the technician's own
  // ticket screen instead (see index.html's own founderPeek comment and
  // observerview.test.js), which never showed this staff-only diagnostic panel to
  // ANYONE, technician or Observer, before or after. Losing it is exactly what "give
  // them the view of technicians" means, not a capability regression — geo.test.js
  // itself no longer drives the Observer through app.openReview() for the same reason.
  {
    const ctx = await b.newContext();
    const p = await open(ctx, 'omar@makaman.ly');
    await p.evaluate(() => {
      const app = window.__mkApp;
      // Ops Manager holds location.edit by default (PERMISSION_DEFAULTS: ['mgr',
      // 'admin']) — the real "office can view, cannot correct" account only exists as a
      // per-person override, same mechanism permissionsimulation.test.js already uses.
      const me = (app.state.data.users || []).find(u => u.email === (app.state.session || {}).email);
      app.setPermissionOverride(me, 'location.edit', false);
      app.mutate((d) => {
        const t = d.tickets.find(x => x.id === 't1');
        t.geo = { open: { lat: 27.5, lon: 18.5, ts: new Date().toISOString() } };
        t.synced = true; t.syncedAt = new Date().toISOString();
      });
      app.openReview('t1');
    });
    await p.waitForTimeout(700);
    const hasInput = await p.evaluate(() => document.querySelectorAll('input[placeholder*="lat, lon"]').length);
    check('without location.edit, no manual-entry input is offered', hasInput === 0, hasInput + ' found');
    const body = await p.innerText('body');
    check('the coordinate still reads as plain text', /27\.5\d*,\s*18\.5/.test(body), body.match(/27\.5[\d.]*,\s*18\.5[\d.]*/));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
