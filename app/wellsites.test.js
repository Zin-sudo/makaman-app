// 2026-09-10, owner's request: "Create a trail of well locations that can be inspected by
// ops/admins/observers from the Account Tab tiles. It should include a history of all
// well[s] saved by Well No. First/Field Second/Arrival location of that well when the
// technician clicked Open Ticket and began filling that specific job log. Extract the data
// from each in-progress ticket to create this (well-sites trail)... allow a search box so
// a search can be used to quickly find the desired well or field including all its related
// wells and so on."
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function boot(b, email) {
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
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1200);
  return { ctx, p };
}

// Four tickets: two on the same well (BG-214 / bg-214, different case, different field
// text, different arrival dates — the later one should win on both counts), one more well
// sharing the winning field (BG-220, so a field search must surface it too), and one with
// location sharing off entirely (must never appear anywhere).
const seedWells = (p) => p.evaluate(() => {
  window.__mkApp.mutate(d => {
    const base = JSON.parse(JSON.stringify(d.tickets.find(t => t.id === 't1')));
    const mk = (id, well, field, lat, lon, arrival, ticketNo) => {
      const c = JSON.parse(JSON.stringify(base));
      c.id = id; c.well = well; c.field = field; c.ticketNo = ticketNo; c.arrival = arrival;
      c.geo = { open: { lat: lat, lon: lon, ts: arrival }, last: { lat: lat, lon: lon, ts: arrival } };
      return c;
    };
    d.tickets.push(mk('w1', 'BG-214', 'Old Sector Name', 29.100000, 47.900000, '2026-01-05T08:00:00.000Z', '9001'));
    d.tickets.push(mk('w2', 'bg-214', 'Burgan North', 29.110000, 47.910000, '2026-03-05T08:00:00.000Z', '9002'));
    d.tickets.push(mk('w3', 'BG-220', 'Burgan North', 29.200000, 48.000000, '2026-02-05T08:00:00.000Z', '9003'));
    const noGeo = mk('w4', 'NG-1', 'Sabriyah', 0, 0, '2026-01-01T00:00:00.000Z', '9004');
    delete noGeo.geo;
    d.tickets.push(noGeo);
  });
});

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── The tile: ops/admin/observer, not the technician ────────────────────────
  for (const [email, role, expect] of [
    ['omar@makaman.ly', 'ops_manager', true],
    ['lateri@makaman.ly', 'admin', true],
    ['founder@makaman.ly', 'observer', true],
    ['yousef@makaman.ly', 'technician', false],
  ]) {
    const { ctx, p } = await boot(b, email);
    await p.getByRole('button', { name: /^Account$/i }).last().click();
    await p.waitForTimeout(400);
    const has = await p.getByRole('button', { name: /Well Sites/i }).count();
    check(role + ' ' + (expect ? 'sees' : 'does not see') + ' the Well Sites tile',
      (has > 0) === expect, 'count=' + has);
    await ctx.close();
  }

  // ── Grouping, the search box, and the per-well history ──────────────────────
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    await seedWells(p);
    await p.waitForTimeout(300);
    await p.getByRole('button', { name: /^Account$/i }).last().click();
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /Well Sites/i }).first().click();
    await p.waitForTimeout(600);

    const bg214Row = () => p.locator('.mk-wellsite-row').filter({ hasText: /bg-214/i });
    let body = (await p.innerText('body')).toLowerCase();
    check('a well with no location shared never appears', !body.includes('ng-1'));
    check('two tickets on the same well (different case) collapse into one row',
      await bg214Row().count() === 1);
    check('that row reports both jobs', await bg214Row().innerText().then(t => /2 jobs/i.test(t)));
    check('the field shown is the MOST RECENT ticket\'s — the earlier one never surfaces',
      !body.includes('old sector name') && (await bg214Row().innerText()).toLowerCase().includes('burgan north'));
    check('the headline location is the most recent arrival, not the first',
      (await bg214Row().innerText()).includes('29.110000, 47.910000'));

    // Field search: every well that field holds survives.
    await p.locator('input[placeholder*="Burgan"]').fill('Burgan North');
    await p.waitForTimeout(400);
    body = (await p.innerText('body')).toLowerCase();
    check('searching a field keeps every well that field holds',
      body.includes('bg-214') && body.includes('bg-220'));

    // A specific well number narrows to just that well.
    await p.locator('input[placeholder*="Burgan"]').fill('bg-220');
    await p.waitForTimeout(400);
    body = (await p.innerText('body')).toLowerCase();
    check('searching one well number narrows to just that well',
      body.includes('bg-220') && !body.includes('bg-214'));

    // No match at all.
    await p.locator('input[placeholder*="Burgan"]').fill('nonexistent-zzz');
    await p.waitForTimeout(400);
    check('no match says so in plain words, not an empty screen',
      /No well or field matches/i.test(await p.innerText('body')));

    // The full history sits behind a tap, not open by default.
    await p.locator('input[placeholder*="Burgan"]').fill('bg-214');
    await p.waitForTimeout(400);
    check('the history table is not there before it is asked for',
      !/9001/.test(await p.innerText('body')));
    await bg214Row().getByRole('button', { name: /Show history/i }).click();
    await p.waitForTimeout(400);
    const history = await bg214Row().innerText();
    check('and once asked, both of that well\'s jobs are in it, oldest arrival visible too',
      /9001/.test(history) && /9002/.test(history));
    await ctx.close();
  }

  // ── The Observer's own tile reaches the same trail, and Well Sites REPLACES
  //    Observer View rather than stacking under it (found and fixed while wiring
  //    this in — showFounderPage never excluded an open admin subpage before) ──
  {
    const { ctx, p } = await boot(b, 'founder@makaman.ly');
    await seedWells(p);
    await p.waitForTimeout(300);
    check('Observer View shows before opening any tool',
      await p.evaluate(() => window.__mkApp.renderVals().showFounderPage));
    await p.getByRole('button', { name: /^Account$/i }).last().click();
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /Well Sites/i }).first().click();
    await p.waitForTimeout(600);
    const flags = await p.evaluate(() => {
      const v = window.__mkApp.renderVals();
      return { showAdminPage: v.showAdminPage, showFounderPage: v.showFounderPage };
    });
    check('opening Well Sites replaces Observer View rather than rendering both at once',
      flags.showAdminPage === true && flags.showFounderPage === false, JSON.stringify(flags));
    check('and the trail itself is right there',
      (await p.innerText('body')).toLowerCase().includes('bg-214'));
    await p.getByRole('button', { name: /Account/i }).first().click();
    await p.waitForTimeout(400);
    // backToAccount lands on the Account tab itself (the tile menu) — Tickets is where
    // Observer View lives, same as for every other role.
    await p.getByRole('button', { name: /^Tickets$/i }).first().click();
    await p.waitForTimeout(400);
    check('going back reaches Observer View again, not a blank page',
      await p.evaluate(() => window.__mkApp.renderVals().showFounderPage));
    await ctx.close();
  }

  // ── A technician cannot reach the screen even by forcing the state directly ──
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly');
    const reached = await p.evaluate(() => {
      window.__mkApp.setState({ adminTab: 'wellsites', roleTab: 'tickets' });
      return window.__mkApp.renderVals().showAdminPage;
    });
    check('forcing the state directly still refuses the technician the screen', !reached);
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
