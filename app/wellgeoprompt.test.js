// The well-location prompt used to be one button: tap it, and the app asked the browser
// for a position right then, whether or not the technician was actually at the well yet.
// This proves the two-step replacement: Capture Now turns the message into a direct
// question rather than firing the capture immediately; Ask Again Later (and NOT YET, its
// twin one step in) hide the prompt until the ticket gets a new log line, which is the
// only thing that re-arms it; and deferring forever never blocks Job Done — nothing on
// that path reads a ticket's location, by design, so a job finished with no location
// captured is a job finished, not an error.
//
// geo.test.js already proves the capture itself (Capture Now → YES actually pins a
// position, a second platform denial explains the block) — this file is the deferral
// half it does not cover.
const { chromium } = require('playwright-core');
const OUT = '/tmp/claude-0/-home-user-makaman-app/d91117f5-d40f-52d2-8052-784fa32d1e1b/scratchpad';
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   ' + extra : '')); };

async function boot(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await page.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.evaluate(() => localStorage.removeItem('makaman.jobtickets.session.v1'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  return page;
}
async function login(page, email) {
  const i = page.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForTimeout(900);
}
const missing = (page) => page.getByText(/Well location not captured/i);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 950 } });
  const page = await boot(ctx);
  await login(page, 'yousef@makaman.ly');
  await page.getByRole('button', { name: /New Job Ticket/i }).click();
  await page.waitForTimeout(400);
  await page.locator('select').first().selectOption({ index: 1 });
  await page.locator('input').nth(0).fill('DeferFld');
  await page.locator('input').nth(1).fill('DF-1');
  await page.locator('input').nth(2).fill('RIG-F');
  await page.getByRole('button', { name: /Start Logging/i }).click();
  await page.waitForTimeout(500);

  // Never captured, and geoTick left running on its normal (un-sped-up) interval here —
  // it will not fire within this test's lifetime, so no isolation is needed the way
  // geo.test.js has to.
  await page.evaluate(() => {
    window.__mkApp.mutate((d) => {
      const t = d.tickets.find((x) => x.field === 'DeferFld');
      t.arrival = new Date(Date.now() - 25000).toISOString();
    });
  });
  await page.waitForTimeout(400);
  check('the missing pin is surfaced', await missing(page).isVisible());

  // ── Ask Again Later hides it, and only a new log line brings it back ────────────────
  await page.getByRole('button', { name: 'ASK AGAIN LATER' }).click();
  await page.waitForTimeout(300);
  check('Ask Again Later hides the prompt', !(await missing(page).isVisible().catch(() => false)));

  await page.getByPlaceholder(/Describe the event as it happens/i).fill('Rigging up.');
  await page.getByRole('button', { name: /^Log line/i }).click();
  await page.waitForTimeout(400);
  check('a new log line re-arms it', await missing(page).isVisible());

  // ── NOT YET is the same deferral, one step in ───────────────────────────────────────
  await page.getByRole('button', { name: 'CAPTURE NOW' }).click();
  await page.waitForTimeout(200);
  check('Capture Now asks directly', await page.getByText(/Are you in the well location right now/i).isVisible());
  await page.getByRole('button', { name: 'NOT YET' }).click();
  await page.waitForTimeout(300);
  check('NOT YET defers exactly like Ask Again Later', !(await missing(page).isVisible().catch(() => false)));
  check('and the confirm question goes with it — not left stranded on screen',
    !(await page.getByText(/Are you in the well location right now/i).isVisible().catch(() => false)));

  await page.getByPlaceholder(/Describe the event as it happens/i).fill('Second line.');
  await page.getByRole('button', { name: /^Log line/i }).click();
  await page.waitForTimeout(400);
  check('a second new log line re-arms it again', await missing(page).isVisible());

  // ── Deferring forever never blocks Job Done ─────────────────────────────────────────
  await page.getByRole('button', { name: 'ASK AGAIN LATER' }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /^Job done$/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Yes, job done/i }).click();
  await page.waitForTimeout(500);
  const t = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || '{}');
    return (d.tickets || []).find((x) => x.field === 'DeferFld');
  });
  check('the job finishes with no location ever captured — nothing forces it',
    !!t && t.status === 'done' && !(t.geo && t.geo.open), JSON.stringify({ status: t && t.status, geo: t && t.geo }));

  await ctx.close();
  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
