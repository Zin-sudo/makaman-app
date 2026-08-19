// Office-raised tickets, the customer picker, and field-device positions.
// Needs the app served locally and playwright-core with the pre-installed Chromium.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(browser, email) {
  const p = await browser.newPage({ viewport: { width: 1300, height: 950 } });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  await p.evaluate(() => localStorage.removeItem('makaman.jobtickets.session.v1'));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('x');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1000);
  return p;
}
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || 'null'));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  let p = await signIn(browser, 'omar@makaman.ly');

  // ---- raise a ticket for a brand-new customer ----
  await p.getByRole('button', { name: /New ticket/i }).click();
  await p.waitForTimeout(600);
  const f = p.locator('input');
  await f.nth(0).fill('Defa Petroleum');   // customer — not on the list
  await p.waitForTimeout(400);
  let body = await p.innerText('body');
  check('unknown customer is flagged as new', /Not on the customer list/i.test(body));

  await f.nth(1).fill('Defa'); await f.nth(2).fill('DF-12'); await f.nth(3).fill('RIG-4');
  await p.locator('select').last().selectOption('Yousef Al-Harbi');
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /Raise ticket/i }).click();
  await p.waitForTimeout(900);

  let d = await store(p);
  const client = (d.clients || []).find(c => c.name === 'Defa Petroleum');
  check('new customer added to the register', !!client);
  check('new customer starts with no price list', !!client && (client.items || []).length === 0);
  const raised = (d.tickets || []).find(t => t.customer === 'Defa Petroleum');
  check('ticket raised and assigned', !!raised && raised.tech === 'Yousef Al-Harbi');
  check('office-raised ticket is already synced', !!raised && raised.synced === true);
  check('who raised it is recorded', !!raised && (raised.audit || []).some(a => /raised in the office by Omar Al-Saleh/i.test(a.text)));
  check('missing price list is called out', !!raised && (raised.audit || []).some(a => /No price list yet/i.test(a.text)));

  // ---- an existing customer must not be duplicated by different typing ----
  await p.getByRole('button', { name: /New ticket/i }).click();
  await p.waitForTimeout(600);
  const g = p.locator('input');
  await g.nth(0).fill('  kuwait oil group  ');  // same customer, typed carelessly
  await p.waitForTimeout(400);
  body = await p.innerText('body');
  check('known customer typed loosely is not flagged as new', !/Not on the customer list/i.test(body));
  await g.nth(1).fill('X'); await g.nth(2).fill('Y'); await g.nth(3).fill('Z');
  await p.locator('select').last().selectOption('Mahmoud Zaki');
  await p.waitForTimeout(300);
  await p.getByRole('button', { name: /Raise ticket/i }).click();
  await p.waitForTimeout(900);
  d = await store(p);
  const kuwaits = (d.clients || []).filter(c => /kuwait oil group/i.test(c.name));
  check('no duplicate customer created', kuwaits.length === 1, `${kuwaits.length} matching customers`);
  const reused = (d.tickets || []).find(t => t.well === 'Y');
  check('ticket uses the register spelling', !!reused && reused.customer === 'Kuwait Oil Group', reused && reused.customer);

  // ---- field devices show the latest position ----
  await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    const t = s.tickets.find(x => x.tech === 'Yousef Al-Harbi');
    const now = Date.now();
    t.geo = {
      open: { lat: 32.887209, lon: 13.191338, acc: 12, ts: new Date(now - 7200000).toISOString() },
      last: { lat: 32.901544, lon: 13.205871, acc: 9, ts: new Date(now).toISOString() },
    };
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(s));
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: /^Sync$/i }).last().click();
  await p.waitForTimeout(700);
  body = await p.innerText('body');
  check('field devices show the latest position', /32\.901544, 13\.205871/.test(body));
  check('field devices show the older fix instead', !/32\.887209/.test(body));

  // ---- settings and tools are reachable from one place only ----
  body = await p.innerText('body');
  check('no settings gear in the header', !/⚙/.test(body));
  await p.getByRole('button', { name: /^Tickets$/i }).last().click();
  await p.waitForTimeout(600);
  body = await p.innerText('body');
  check('no Team button on the inbox', !/^Team$/m.test(body));
  await p.close();

  p = await signIn(browser, 'lateri@makaman.ly');
  body = await p.innerText('body');
  check('no admin tab strip', !(/Price lists/i.test(body) && /Numbering & job types/i.test(body) && /Users & customers/i.test(body)));
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
