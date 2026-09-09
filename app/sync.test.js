// Sync belongs to closed work only. A job still being logged may travel to the office
// in the background, but it is never something the technician is waiting to upload —
// so it must not be listed as pending, counted in the banner, or consumed by the button.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(ctx, email) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 430, height: 900 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  // Both keys: the context is shared across blocks so one block's edits would
  // otherwise become the next block's starting state.
  await p.evaluate(() => {
    localStorage.removeItem('makaman.jobtickets.session.v1');
    localStorage.removeItem('makaman.jobtickets.v2');
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(900);
  return p;
}
// Connectivity is read from the device now — there is no in-app switch to flip, and
// a headless browser reports itself online, so nothing needs doing to get there.
const goOnline = async () => {};
const tickets = (p) => p.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || '{}');
  return (d.tickets || []).map(t => ({ id: t.id, cust: t.customer, status: t.status, synced: !!t.synced, tech: t.tech }));
});
// The store is only written on the first mutation, so a freshly-signed-in session has
// nothing in localStorage to edit. Toggling a setting twice persists the seed and
// leaves the setting where it started.
const forcePersist = async (p) => {
  if (await p.evaluate(() => !!localStorage.getItem('makaman.jobtickets.v2'))) return;
  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const t = document.querySelector('.mk-switch');
    if (t) { t.click(); t.click(); }
  });
  await p.waitForTimeout(400);
};
const tab = async (p, name) => {
  await p.getByRole('button', { name: new RegExp('^' + name + '$', 'i') }).last().click();
  await p.waitForTimeout(500);
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });

  // ── the reported bug: sync from inside the logging screen ──────────────────
  let p = await signIn(ctx, 'yousef@makaman.ly');
  await p.getByText('Northern Gulf Petroleum').first().click();
  await p.waitForTimeout(700);
  await goOnline();
  // Seeded state: Yousef's only unsynced ticket is the one he is logging, so with
  // in-progress excluded there is nothing pending and the banner must be gone.
  check('no banner for a job that is merely in progress',
    !(await p.getByRole('button', { name: /^SYNC$/ }).count()));

  await tab(p, 'Sync');
  let body = await p.innerText('body');
  check('Sync tab does not list the in-progress ticket as pending',
    !/waiting to upload/i.test(body), body.split('\n').filter(l => /waiting/i.test(l)).join(' '));

  // pressed deliberately with only closed-and-synced work on the device
  await p.getByRole('button', { name: /Sync now/i }).click();
  await p.waitForTimeout(600);
  body = await p.innerText('body');
  check('green note when the closed work is already up', /TICKETS ALREADY SYNCHRONIZED/i.test(body));
  // Read the colour off the innermost element carrying the text — the runtime wraps
  // the binding, so the note div is not childless.
  const note = (p, re) => p.evaluate((src) => {
    const els = Array.from(document.querySelectorAll('div')).filter(d => new RegExp(src, 'i').test(d.textContent));
    const el = els[els.length - 1];
    return el ? getComputedStyle(el).color : '';
  }, re);
  check('the note is green, not amber', (await note(p, 'Already Synchronized')) === 'rgb(48, 209, 88)',
    await note(p, 'Already Synchronized'));

  await tab(p, 'Tickets');
  body = await p.innerText('body');
  check('the in-progress ticket is still in the technician list', /Northern Gulf Petroleum/.test(body));
  check('and still reads as in progress', /IN PROGRESS/i.test(body));
  await p.close();

  // ── only in-progress work on the device ───────────────────────────────────
  p = await signIn(ctx, 'yousef@makaman.ly');
  await forcePersist(p);
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    // leave Yousef exactly one ticket, still being logged
    d.tickets = d.tickets.filter(t => t.id === 't3');
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await goOnline();
  await tab(p, 'Sync');
  await p.getByRole('button', { name: /Sync now/i }).click();
  await p.waitForTimeout(600);
  body = await p.innerText('body');
  check('amber note when only a running job is on the device', /CLOSE TICKET TO SYNC/i.test(body));
  const amber = await p.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div')).filter(d => /Close Ticket To Sync/i.test(d.textContent));
    return getComputedStyle(els[els.length - 1]).color;
  });
  check('the note is amber, not green', amber === 'rgb(255, 207, 112)', amber);
  await tab(p, 'Tickets');
  check('the running job is still listed afterwards', /Northern Gulf Petroleum/.test(await p.innerText('body')));
  await p.close();

  // ── one technician's sync must not upload another's work ─────────────────
  p = await signIn(ctx, 'yousef@makaman.ly');
  await forcePersist(p);
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    d.tickets.forEach(t => {
      if (t.tech === 'Yousef Al-Harbi') { t.status = 'done'; t.synced = false; }
      if (t.tech === 'Mahmoud Zaki') { t.status = 'done'; t.synced = false; }
    });
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  await goOnline();
  await tab(p, 'Sync');
  await p.getByRole('button', { name: /Sync now/i }).click();
  await p.waitForTimeout(700);
  const after = await tickets(p);
  check("Yousef's closed tickets went up", after.filter(x => x.tech === 'Yousef Al-Harbi').every(x => x.synced));
  check("Mahmoud's did not", after.filter(x => x.tech === 'Mahmoud Zaki').every(x => !x.synced),
    JSON.stringify(after.filter(x => x.tech === 'Mahmoud Zaki').map(x => x.synced)));
  await p.close();

  // ── closing a job makes it pending, and the banner no longer nags while online ──
  //
  // 2026-09-09/10, owner's request: "when the user is connected to the internet
  // already they don't need to click manually on the sync banner... unless automatic
  // syncing fails... otherwise the sync should be automatic." Sync itself is automatic
  // now (autoSyncNow/syncClosedTickets, hooked into refreshCore — see their own
  // comments); this banner's own remaining job is narrower than it used to be: say so
  // only when nothing here CAN act on its own, i.e. genuinely offline.
  p = await signIn(ctx, 'yousef@makaman.ly');
  await p.getByText('Northern Gulf Petroleum').first().click();
  await p.waitForTimeout(700);
  await p.getByRole('button', { name: /^Job done$/i }).click();
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /Yes, job done/i }).click();
  await p.waitForTimeout(700);
  const ts = await tickets(p);
  check('closing the job marks it as needing upload', ts.find(x => x.id === 't3').synced === false);

  await tab(p, 'Tickets');
  check('no nag banner on Tickets while online — this is handled automatically now',
    !(await p.getByRole('button', { name: /^SYNC$/ }).count()));
  await tab(p, 'Activity');
  check('no nag banner on Activity while online', !(await p.getByRole('button', { name: /^SYNC$/ }).count()));
  await tab(p, 'Account');
  check('no nag banner on Account while online', !(await p.getByRole('button', { name: /^SYNC$/ }).count()));
  await tab(p, 'Sync');
  check('and naturally none on the Sync tab either', await p.getByRole('button', { name: /^SYNC$/ }).count() === 0);
  body = await p.innerText('body');
  check('the Sync tab still lists the closed ticket, informationally', /1 ticket waiting to upload/i.test(body));

  // The one case the banner still exists for: nothing automatic can reach the office
  // over no connection at all, so a person is told rather than left guessing why a
  // closed job never showed up.
  await ctx.setOffline(true);
  await p.waitForTimeout(400);
  await tab(p, 'Tickets');
  check('but the banner returns the moment there really is nothing automatic can do about it',
    await p.getByRole('button', { name: /^SYNC$/ }).count() > 0);
  body = await p.innerText('body');
  check('and says offline, not "auto-syncing"', /Offline/i.test(body) && !/auto-syncing/i.test(body));
  // 2026-09-10, owner's request, the actual claim this whole section exists to prove:
  // coming back online uploads the closed ticket on its own — nobody has to notice the
  // banner or press anything for it to happen.
  await ctx.setOffline(false);
  await p.waitForTimeout(700);
  const backOnline = await tickets(p);
  check('reconnecting alone — no button pressed — uploads the closed ticket',
    backOnline.find(x => x.id === 't3').synced === true);

  await tab(p, 'Sync');
  body = await p.innerText('body');
  check('and the Sync tab already reads nothing pending, before the button is ever touched',
    /Every closed ticket on this device has been uploaded/i.test(body));
  await p.getByRole('button', { name: /Sync now/i }).click();
  await p.waitForTimeout(700);
  body = await p.innerText('body');
  check('so pressing it anyway just confirms there was nothing left to do',
    /Tickets Already Synchronized/i.test(body));
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
