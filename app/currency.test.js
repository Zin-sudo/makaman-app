// Sirte Oil Company is billed in Libyan dinar. Every figure derived from their price
// list — line costs, line totals, the ticket grand total and the printed sheets — must
// say LYD, and nothing that mixes currencies may be summed into a single number.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

// These blocks deliberately share state: the ticket the technician raises is the one
// the office then prices. Only the first sign-in starts from a clean store; the rest
// drop the session so a different person can log in and keep the data.
async function signIn(ctx, email, fresh) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1300, height: 950 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  await p.evaluate((wipe) => {
    if (wipe) localStorage.clear();
    else localStorage.removeItem('makaman.jobtickets.session.v1');
  }, !!fresh);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(900);
  return p;
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });

  // ── a technician raises a Sirte job ───────────────────────────────────────
  let p = await signIn(ctx, 'yousef@makaman.ly', true);
  await p.getByRole('button', { name: /New Job Ticket/i }).click();
  await p.waitForTimeout(400);
  await p.locator('select').first().selectOption({ label: 'Sirte Oil Company (SOC)' });
  await p.getByPlaceholder(/Burgan North/i).fill('Zelten');
  await p.getByPlaceholder(/BG-214/i).fill('ZT-9');
  await p.getByPlaceholder(/WS-11/i).fill('SOC-4');
  await p.getByRole('button', { name: /Start Logging/i }).click();
  await p.waitForTimeout(1200);

  const stamped = await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || '{}');
    const t = (d.tickets || []).filter(x => x.customer && x.customer.indexOf('Sirte') === 0).pop();
    return t ? t.currency : null;
  });
  check('the currency is frozen onto the ticket when it is raised', stamped === 'LYD', String(stamped));
  await p.close();

  // ── the office prices it ─────────────────────────────────────────────────
  p = await signIn(ctx, 'omar@makaman.ly');
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || 'null') || {};
    if (!d.tickets) return;
    d.tickets.forEach(t => { t.synced = true; t.syncedAt = new Date().toISOString(); });
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);

  const row = p.locator('tr', { hasText: 'Sirte' }).first();
  if (await row.count()) {
    await row.getByRole('button', { name: /^(Review|View)$/i }).first().click();
    await p.waitForTimeout(900);
    const body = await p.innerText('body');
    check('line costs and totals read LYD, not dollars',
      /LYD/.test(body) && !/\$/.test(body.split('Charged items')[1] || body),
      (body.match(/[\d.,]+ LYD/) || ['none'])[0]);
    // The dinar divides into 1,000 dirham, so its figures carry three decimal places.
    // Two would silently drop a digit the contract prices to.
    const lydFigures = body.match(/[\d,]+\.\d+ LYD/g) || [];
    check('every dinar figure carries three decimals',
      lydFigures.length > 0 && lydFigures.every(f => /\.\d{3} LYD$/.test(f)),
      lydFigures.slice(0, 3).join(' , ') || 'none found');

    await p.getByRole('button', { name: /Preview 4 sheets/i }).click();
    await p.waitForTimeout(900);
    const sheets = await p.innerText('body');
    check('the printed sheets say LYD too', /LYD/.test(sheets));
    const sheetFigures = sheets.match(/[\d,]+\.\d+ LYD/g) || [];
    check('and carry three decimals on the sheets as well',
      sheetFigures.length > 0 && sheetFigures.every(f => /\.\d{3} LYD$/.test(f)),
      sheetFigures.slice(0, 3).join(' , ') || 'none found');
    check('no dollar sign reaches a Sirte sheet', !/\$/.test(sheets),
      (sheets.match(/\$[\d.,]+/) || ['clean'])[0]);
  } else {
    check('Sirte ticket reached the office inbox', false, 'row not found');
  }
  await p.close();

  // ── mixed currencies are never added together ────────────────────────────
  p = await signIn(ctx, 'founder@makaman.ly');
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || 'null');
    if (!d) return;
    // one approved ticket in each currency
    d.tickets.forEach((t, i) => {
      t.status = 'approved'; t.synced = true; t.syncedAt = new Date().toISOString();
      t.currency = i === 0 ? 'LYD' : 'USD';
      t.items = [{ code: 'X', desc: 'x', qty: 1, uom: 'ea', cost: 100 }];
    });
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  const obs = await p.innerText('body');
  const line = (obs.split('\n').find(l => /LYD|\$/.test(l) && /[\d,]+\.\d\d/.test(l)) || '');
  check('approved value reports each currency rather than adding them up',
    /LYD/.test(obs) && /\$/.test(obs), line.trim());
  // Both conventions side by side in the same figure is the clearest proof they differ.
  check('dollars keep two decimals while dinar keeps three',
    /\$[\d,]+\.\d{2}(?!\d)/.test(obs) && /[\d,]+\.\d{3} LYD/.test(obs),
    ((obs.match(/\$[\d,]+\.\d+/) || [''])[0] + '  /  ' + (obs.match(/[\d,]+\.\d+ LYD/) || [''])[0]));
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
