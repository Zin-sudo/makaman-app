// A year of jobs is a long scroll on a phone. Ten at a time, the rest a press away, and
// a search so nobody scrolls at all when they already know the number.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 980 } });

  // 26 tickets, so paging has something to page
  const setup = await ctx.newPage();
  await setup.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await setup.goto(URL, { waitUntil: 'networkidle' });
  await setup.waitForTimeout(250);
  await setup.evaluate(() => localStorage.clear());
  await setup.reload({ waitUntil: 'networkidle' });
  await setup.waitForTimeout(600);
  let si = setup.locator('input');
  await si.nth(0).fill('yousef@makaman.ly'); await si.nth(1).fill('makaman2026');
  await setup.getByRole('button', { name: /log in/i }).click();
  await setup.waitForTimeout(900);
  await setup.getByRole('button', { name: /^Account$/i }).last().click();
  await setup.waitForTimeout(400);
  await setup.evaluate(() => {
    const t = document.querySelector('.mk-switch');
    if (t) { t.click(); t.click(); }
  });
  await setup.waitForTimeout(500);
  const total = await setup.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    const base = d.tickets.find(x => x.status === 'approved');
    for (let n = 0; n < 25; n++) {
      const c = JSON.parse(JSON.stringify(base));
      c.id = 'p' + n; c.ticketNo = String(7000 + n); c.status = 'approved'; c.synced = true;
      c.well = 'WELL-' + n; c.customer = n === 7 ? 'Rare Customer Ltd' : c.customer;
      c.tech = 'Yousef Al-Harbi'; c.crew = [{ name: 'Yousef Al-Harbi', email: 'yousef@makaman.ly' }];
      d.tickets.push(c);
    }
    d.tickets.forEach(x => { x.synced = true; });
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
    localStorage.removeItem('makaman.jobtickets.session.v1');
    return d.tickets.length;
  });
  await setup.close();
  check('a long list to page through', total >= 26, total + ' tickets');

  // ── Ops Manager inbox ────────────────────────────────────────────────────
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  let i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1000);

  const rows = () => p.locator('tbody tr').count();
  check('the inbox opens with ten, not everything', await rows() === 10, String(await rows()));
  check('and says how many there are', /2[0-9] tickets/.test(await p.innerText('body')),
    (await p.innerText('body')).split('\n').find(l => /tickets$/.test(l.trim())) || '');

  await p.getByRole('button', { name: /Load 10 more/i }).click();
  await p.waitForTimeout(500);
  check('load more adds ten', await rows() === 20, String(await rows()));
  await p.getByRole('button', { name: /Load \d+ more/i }).click();
  await p.waitForTimeout(500);
  const all = await rows();
  check('and the last press shows the rest', all === total, `${all} of ${total}`);
  check('after which there is nothing more to load',
    await p.getByRole('button', { name: /Load \d+ more/i }).count() === 0);

  // search by ticket number
  const box = p.getByPlaceholder(/Search ticket no/i).first();
  await box.fill('7007');
  await p.waitForTimeout(500);
  check('searching a ticket number finds exactly it', await rows() === 1, String(await rows()));
  check('and it is the right one', /7007/.test(await p.innerText('tbody')));

  // search resets the paging rather than staying expanded
  await box.fill('');
  await p.waitForTimeout(500);
  check('clearing the search returns to ten', await rows() === 10, String(await rows()));

  // wider than the number, because people remember the well
  await box.fill('WELL-12');
  await p.waitForTimeout(500);
  check('searching a well works too', await rows() === 1, String(await rows()));
  await box.fill('Rare Customer');
  await p.waitForTimeout(500);
  check('and a customer name', await rows() === 1, String(await rows()));
  await box.fill('nothing-matches-this');
  await p.waitForTimeout(500);
  check('a search with no hits shows nothing rather than everything', await rows() === 0, String(await rows()));
  await p.close();

  // ── the technician's own list ────────────────────────────────────────────
  const t2 = await ctx.newPage();
  await t2.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await t2.goto(URL, { waitUntil: 'networkidle' });
  await t2.waitForTimeout(300);
  await t2.evaluate(() => localStorage.removeItem('makaman.jobtickets.session.v1'));
  await t2.reload({ waitUntil: 'networkidle' });
  await t2.waitForTimeout(700);
  let ti = t2.locator('input');
  await ti.nth(0).fill('yousef@makaman.ly'); await ti.nth(1).fill('makaman2026');
  await t2.getByRole('button', { name: /log in/i }).click();
  await t2.waitForTimeout(1000);
  const cards = () => t2.locator('.mk-ticket-card').count();
  check('the technician list also opens with ten', await cards() === 10, String(await cards()));
  const tbox = t2.getByPlaceholder(/Search ticket no/i).first();
  await tbox.fill('7011');
  await t2.waitForTimeout(500);
  check('and searches the same way', await cards() === 1, String(await cards()));
  await tbox.fill('');
  await t2.waitForTimeout(500);
  await t2.getByRole('button', { name: /Load 10 more/i }).click();
  await t2.waitForTimeout(500);
  check('and pages the same way', await cards() === 20, String(await cards()));
  await t2.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
