// Office-raised tickets, the customer picker, and field-device positions.
// Needs the app served locally and playwright-core with the pre-installed Chromium.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(browser, email) {
  const p = await browser.newPage({ viewport: { width: 1300, height: 950 } });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  await p.evaluate(() => localStorage.removeItem('makaman.jobtickets.session.v1'));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
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

  // ---- the presence badge reports the TECHNICIAN, not whoever is looking ----
  // It used to print this.state.online — the viewer's own connectivity — as "Online"
  // beside somebody else's job, so the office saw a green dot on every in-progress ticket
  // on the board whatever the field was doing. The office uses this to decide whether it
  // can raise someone; a badge that always says yes is worse than none.
  p = await signIn(browser, 'omar@makaman.ly');
  const seen = await p.evaluate(() => {
    const app = window.__mkApp;
    const live = (app.state.data.tickets || []).filter(t => t.status === 'logging');
    const t = live[0];
    // Strip every trace of contact from one live ticket, with the office plainly online.
    app.mutate(d => { const x = d.tickets.find(y => y.id === t.id); x.geo = {}; x.syncedAt = ''; });
    app.setState({ online: true });
    const cold = app.ticketView(app.state.data.tickets.find(y => y.id === t.id));
    // Now say the technician was in touch a moment ago.
    app.mutate(d => {
      const x = d.tickets.find(y => y.id === t.id);
      x.geo = { last: { ts: new Date().toISOString(), lat: 1, lon: 1 } };
    });
    const warm = app.ticketView(app.state.data.tickets.find(y => y.id === t.id));
    // And a long time ago.
    app.mutate(d => {
      const x = d.tickets.find(y => y.id === t.id);
      x.geo = { last: { ts: new Date(Date.now() - 5 * 3600 * 1000).toISOString(), lat: 1, lon: 1 } };
    });
    const stale = app.ticketView(app.state.data.tickets.find(y => y.id === t.id));
    return { cold: cold.presenceLabel, warm: warm.presenceLabel, stale: stale.presenceLabel,
             coldDot: cold.presenceDot, warmDot: warm.presenceDot };
  });
  check('a technician nobody has heard from is not reported as online to the office',
    seen.cold === 'Not heard from', seen.cold);
  check('and the dot is not green while the office is the only one connected',
    !/success/.test(seen.coldDot), seen.coldDot);
  check('a recent fix reads as contact, not as a claim about right now',
    seen.warm === 'In contact' && /success/.test(seen.warmDot), seen.warm + ' / ' + seen.warmDot);
  check('an old fix says when, rather than going on claiming contact',
    /^Last heard /.test(seen.stale), seen.stale);
  await p.close();

  // On his own job, the technician's own live flag IS the fact.
  p = await signIn(browser, 'yousef@makaman.ly');
  const own = await p.evaluate(() => {
    const app = window.__mkApp;
    const me = (app.state.session || {}).name;
    const t = (app.state.data.tickets || []).find(x => x.status === 'logging'
      && (x.crew || [{ name: x.tech }]).some(c => (c.name || c) === me));
    if (!t) return null;
    app.setState({ online: true });
    const up = app.ticketView(t).presenceLabel;
    app.setState({ online: false });
    const down = app.ticketView(t).presenceLabel;
    return { up: up, down: down };
  });
  check('on his own job the technician still sees his own live signal',
    own && own.up === 'Online' && own.down === 'No signal',
    own ? own.up + ' / ' + own.down : 'no live ticket of his own');
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
