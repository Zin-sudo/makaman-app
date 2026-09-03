// The office's view of position and reports. Coordinates come from a real (mocked) GPS
// via the technician's own device, not from seeded fixtures — the point is that what the
// field records is what the office can read.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
const AT = { latitude: 32.887209, longitude: 13.191338, accuracy: 12 };
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(ctx, email, fresh) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1300, height: 950 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  await p.evaluate((w) => {
    if (w) localStorage.clear(); else localStorage.removeItem('makaman.jobtickets.session.v1');
  }, !!fresh);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(900);
  return p;
}
const tab = async (p, n) => { await p.getByRole('button', { name: new RegExp('^' + n + '$', 'i') }).last().click(); await p.waitForTimeout(500); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 }, permissions: ['geolocation'], geolocation: AT });

  // a technician opens a job, which pins the device
  let p = await signIn(ctx, 'yousef@makaman.ly', true);
  await p.getByRole('button', { name: /New Job Ticket/i }).click();
  await p.waitForTimeout(400);
  await p.locator('select').first().selectOption({ index: 1 });
  await p.getByPlaceholder(/Burgan North/i).fill('Zelten');
  await p.getByPlaceholder(/BG-214/i).fill('ZT-9');
  await p.getByPlaceholder(/WS-11/i).fill('SOC-4');
  await p.getByRole('button', { name: /Start Logging/i }).click();
  await p.waitForTimeout(1500);
  const pinned = await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || '{}');
    return (d.tickets || []).some(t => t.geo && t.geo.open);
  });
  check('the device recorded a position when the job was opened', pinned);
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    d.tickets.forEach(t => { t.synced = true; t.syncedAt = new Date().toISOString(); });
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
  });
  await p.close();

  // ── Ops Manager ──────────────────────────────────────────────────────────
  p = await signIn(ctx, 'omar@makaman.ly');
  await tab(p, 'Sync');
  check('field devices shows the coordinates', /32\.887209/.test(await p.innerText('body')));

  await tab(p, 'Account');
  check('the Ops Manager has Reports too', /Reports/i.test(await p.innerText('body')));
  // Reports lives behind its own tile now, not open on the Account tab.
  await p.getByRole('button', { name: /^Reports/i }).first().click();
  await p.waitForTimeout(500);
  const slider = p.locator('input[type=range]').first();
  check('the report slider starts at 1', await slider.getAttribute('min') === '1',
    'min=' + await slider.getAttribute('min'));
  await p.getByRole('button', { name: /‹ Account/i }).click();
  await p.waitForTimeout(500);

  // Team carries the same position
  await p.getByText('Team', { exact: false }).first().click();
  await p.waitForTimeout(700);
  let body = await p.innerText('body');
  check('Team lists a last position column', /Last position/i.test(body));
  check('and shows the coordinates for the technician who shared them', /32\.887209/.test(body));
  check('and says so plainly for those who have not', /No Location Shared/i.test(body));

  // the ticket detail
  await tab(p, 'Tickets');
  const row = p.locator('tr', { hasText: 'ZT-9' }).first();
  await row.getByRole('button', { name: /^(Review|View)$/i }).first().click();
  await p.waitForTimeout(900);
  body = await p.innerText('body');
  check('the ticket shows where it was opened', /Device position/i.test(body) && /32\.887209/.test(body));
  await p.close();

  // ── Observer ─────────────────────────────────────────────────────────────
  p = await signIn(ctx, 'founder@makaman.ly');
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    d.tickets.forEach(t => { if (t.well === 'ZT-9') { t.status = 'approved'; t.ticketNo = '9001'; } });
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  check('the Observer can open a ticket at all', await p.locator('tr', { hasText: '9001' }).count() > 0);
  await p.locator('tr', { hasText: '9001' }).first().click();
  await p.waitForTimeout(900);
  body = await p.innerText('body');
  check('and reaches the coordinates from there', /Device position/i.test(body) && /32\.887209/.test(body));
  check('but cannot approve anything', /Read-only — Observer/i.test(body));
  // The Observer may not change the ticket. They MAY raise a note on it — flagging
  // something for the office is the whole reason the role opens a ticket at all — so the
  // notes composer is enabled and everything else is not. Counting enabled inputs and
  // expecting zero stopped meaning "read-only" the moment notes existed.
  //
  // Excluding it is only safe alongside the positive check below: if the composer ever
  // stopped being the thing that is enabled, the exclusion would quietly hide it.
  const fields = await p.evaluate(() =>
    Array.from(document.querySelectorAll('input,textarea,select'))
      .filter(e => !e.disabled && e.type !== 'range')
      .map(e => e.placeholder || e.tagName));
  const ticketFields = fields.filter(f => !/Raise a note/i.test(f));
  check('and no field of the ticket is editable', ticketFields.length === 0, ticketFields.join(', '));
  check('the one thing they can type into is a note', 
    fields.length === 1 && /Raise a note/i.test(fields[0]), fields.join(', '));
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
