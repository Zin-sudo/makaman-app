const { chromium } = require('playwright-core');
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };
const URL = 'http://localhost:8934/index.html';

async function boot(browser, email, w, h) {
  const p = await browser.newPage({ viewport: { width: w || 1300, height: h || 950 } });
  p.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  // Deliberately scramble insertion order so band ordering cannot pass by accident:
  // approved first, logging last, i.e. the exact reverse of the wanted order.
  await p.evaluate(() => {
    localStorage.removeItem('makaman.jobtickets.session.v1');
    const seedish = {
      settings: { theme: 'dark', timezone: 'Africa/Tripoli', timeFormat: '24', shareLocation: true },
      orgDefaults: { baseLocation: 'Ahmadi Base', customerRep: 'Workover Office' },
      clients: [{ name: 'Kuwait Oil Group', fields: ['Burgan North'], rigs: ['WS-11'], items: [] }],
      series: [{ id: 'st', label: 'Special Tools', prefix: '', last: 1883 }],
      jobTypes: ['TEST'],
      users: [
        { name: 'Yousef Al-Harbi', role: 'Field Technician', roleKey: 'tech', email: 'yousef@makaman.ly', base: 'Ahmadi Base', lastSync: 'live', status: 'active' },
        { name: 'Mahmoud Zaki', role: 'Field Technician', roleKey: 'tech', email: 'mahmoud@makaman.ly', base: 'Ahmadi Base', lastSync: 'yesterday', status: 'active' },
        { name: 'Omar Al-Saleh', role: 'Operations Manager', roleKey: 'mgr', email: 'omar@makaman.ly', base: 'Ahmadi Base', lastSync: 'live', status: 'active' },
      ],
      tickets: [
        { id: 'a', tech: 'Yousef Al-Harbi', customer: 'Kuwait Oil Group', field: 'F', well: 'W1', rig: 'R', jobType: 'T', arrival: new Date().toISOString(), start: '', end: '', status: 'approved', synced: true, syncedAt: new Date().toISOString(), ticketNo: '1001', mileage: 1, events: [], items: [], audit: [{ ts: new Date().toISOString(), text: 'Approved by Omar Al-Saleh.', kind: 'lifecycle', by: 'Omar Al-Saleh' }] },
        { id: 'b', tech: 'Mahmoud Zaki', customer: 'Kuwait Oil Group', field: 'F', well: 'W2', rig: 'R', jobType: 'T', arrival: new Date().toISOString(), start: '', end: '', status: 'done', synced: true, syncedAt: new Date().toISOString(), ticketNo: '1002', mileage: 1, events: [], items: [], audit: [{ ts: new Date().toISOString(), text: 'Unit cost changed by Omar Al-Saleh: 10 → 20.', kind: 'edit', by: 'Omar Al-Saleh' }] },
        { id: 'c', tech: 'Yousef Al-Harbi', customer: 'Kuwait Oil Group', field: 'F', well: 'W3', rig: 'R', jobType: 'T', arrival: new Date().toISOString(), start: '', end: '', status: 'logging', synced: true, syncedAt: new Date().toISOString(), ticketNo: '1003', mileage: 1, events: [], items: [], audit: [{ ts: new Date().toISOString(), text: 'Job ticket opened on device.', kind: 'lifecycle', by: 'Yousef Al-Harbi' }] },
      ],
    };
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(seedish));
  });
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1000);
  return p;
}
// The Inbox's table became simple ticket tiles, same style as a technician's own
// list (2026-09-10) — read the well code off each tile's location line instead of
// a "Field / Well / Rig" column, in the same DOM order the bands render in.
const wells = (p) => p.evaluate(() => {
  const cards = document.querySelectorAll('.mk-ticket-card');
  if (!cards.length) return null;
  return Array.from(cards).map(c => (c.textContent.match(/W\d/) || [''])[0]).filter(Boolean);
});

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ---- Ops Manager: banding + technician filter ----
  let p = await boot(browser, 'omar@makaman.ly');
  const order = await wells(p);
  // stored order is approved, done, logging; wanted order is logging, done, approved
  check('inbox bands: in-field, awaiting, approved', JSON.stringify(order) === JSON.stringify(['W3', 'W2', 'W1']), JSON.stringify(order));

  const sel = p.locator('select').first();
  await sel.selectOption('Yousef Al-Harbi'); await p.waitForTimeout(600);
  const filtered = await wells(p);
  check('technician filter narrows to that technician', JSON.stringify(filtered) === JSON.stringify(['W3', 'W1']), JSON.stringify(filtered));
  await sel.selectOption(''); await p.waitForTimeout(600);
  check('filter restores to all', (await wells(p)).length === 3);

  // ---- Ops Manager Activity: sees both kinds, chips filter ----
  await p.getByRole('button', { name: /^Activity$/i }).last().click(); await p.waitForTimeout(700);
  let body = await p.innerText('body');
  check('office sees edits', /Unit cost changed/.test(body));
  check('office sees lifecycle', /Approved by/.test(body));
  check('chips shown for office', /Status changes/.test(body) && /Edits/.test(body));
  await p.getByRole('button', { name: /^Edits$/ }).click(); await p.waitForTimeout(600);
  body = await p.innerText('body');
  check('Edits chip hides lifecycle', /Unit cost changed/.test(body) && !/Approved by/.test(body));
  await p.getByRole('button', { name: /^Status changes$/ }).click(); await p.waitForTimeout(600);
  body = await p.innerText('body');
  check('Status chip hides edits', !/Unit cost changed/.test(body) && /Approved by/.test(body));
  await p.close();

  // ---- Technician Activity: company-wide, lifecycle only ----
  p = await boot(browser, 'yousef@makaman.ly', 430, 950);
  await p.getByRole('button', { name: /^Activity$/i }).last().click(); await p.waitForTimeout(700);
  body = await p.innerText('body');
  check('technician sees no edits', !/Unit cost changed/.test(body));
  check('technician sees other technicians\' job stages', /Approved by/.test(body));
  check('no chips for technician', !/Status changes/.test(body));
  await p.close();

  // 2026-09-10, owner's request: "Cancelled at the bottom, then approved above it, then
  // collect signature/stamp above it, then awaiting review above it, then in-progress
  // above them all... for each category ordered as the most recently active is first."
  // bandOf/bandedTickets now feeds both inboxPage (ops) and myPage (technician) from one
  // helper, so one seed proves both. Every ticket below belongs to the same technician so
  // it shows up on both screens. A ticket number never appears on the technician's own
  // card (only customer, location and status do), so a unique "Zone" well code is the
  // marker read off each .mk-ticket-card, in DOM order — it works on both screens alike.
  const bandZones = (p) => p.evaluate(() => Array.from(document.querySelectorAll('.mk-ticket-card'))
    .map(c => (c.textContent.match(/Zone\d/) || [''])[0]).filter(Boolean));

  async function bootBand(browser, email, w, h) {
    const pp = await browser.newPage({ viewport: { width: w || 1300, height: h || 950 } });
    pp.on('pageerror', e => console.log('PAGEERROR:', e.message));
    await pp.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
    await pp.goto(URL, { waitUntil: 'networkidle' });
    await pp.waitForTimeout(400);
    await pp.evaluate(() => {
      localStorage.removeItem('makaman.jobtickets.session.v1');
      const now = Date.now();
      const ago = (ms) => new Date(now - ms).toISOString();
      const mk = (id, ticketNo, zone, status, tsAgo, extra) => Object.assign({
        id, tech: 'Yousef Al-Harbi', techEmail: 'yousef@makaman.ly', customer: 'Kuwait Oil Group',
        field: 'F', well: zone, rig: 'R', jobType: 'T', arrival: ago(tsAgo), start: '', end: '',
        status, synced: true, syncedAt: ago(tsAgo), ticketNo, mileage: 1, events: [], items: [],
        attachments: [],
        audit: [{ ts: ago(tsAgo), text: 'seed', kind: 'lifecycle', by: 'Yousef Al-Harbi' }],
      }, extra || {});
      const seedish = {
        settings: { theme: 'dark', timezone: 'Africa/Tripoli', timeFormat: '24', shareLocation: true },
        orgDefaults: { baseLocation: 'Ahmadi Base', customerRep: 'Workover Office' },
        clients: [{ name: 'Kuwait Oil Group', fields: ['Burgan North'], rigs: ['WS-11'], items: [] }],
        series: [{ id: 'st', label: 'Special Tools', prefix: '', last: 1883 }],
        jobTypes: ['TEST'],
        users: [
          { name: 'Yousef Al-Harbi', role: 'Field Technician', roleKey: 'tech', email: 'yousef@makaman.ly', base: 'Ahmadi Base', lastSync: 'live', status: 'active' },
          { name: 'Omar Al-Saleh', role: 'Operations Manager', roleKey: 'mgr', email: 'omar@makaman.ly', base: 'Ahmadi Base', lastSync: 'live', status: 'active' },
        ],
        tickets: [
          // Band 2 (Collect Signature/Stamp): approved, nothing signed back yet.
          mk('p1', '3001', 'Zone1', 'approved', 2 * 3600e3),
          // Band 3 (Approved, paperwork settled) — a NEWER timestamp than p1, so if band
          // ordering were accidentally dropped in favour of plain recency this would wrongly
          // land above p1. It must not.
          mk('p2', '3002', 'Zone2', 'approved', 10 * 60e3, {
            attachments: [
              { id: 'p2-s', docKind: 'service_ticket', filename: 's.pdf', path: 'p2/s.pdf' },
              { id: 'p2-l', docKind: 'job_log', filename: 'l.pdf', path: 'p2/l.pdf' },
            ],
          }),
          // Band 4 (Cancelled) — the single most recent ticket of all five. Must still sort
          // dead last: cancelled is a floor on the order, not a recency contest.
          mk('p3', '3003', 'Zone3', 'cancelled', 60e3),
          // Band 0 (in-progress) — a tie-break pair. p5 starts more recent than p4.
          mk('p4', '3004', 'Zone4', 'logging', 2 * 3600e3),
          mk('p5', '3005', 'Zone5', 'logging', 1 * 3600e3),
        ],
      };
      localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(seedish));
    });
    await pp.reload({ waitUntil: 'networkidle' }); await pp.waitForTimeout(700);
    const i = pp.locator('input');
    await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
    await pp.getByRole('button', { name: /log in/i }).click();
    await pp.waitForTimeout(1000);
    return pp;
  }

  for (const who of [{ email: 'omar@makaman.ly', label: 'ops Inbox' }, { email: 'yousef@makaman.ly', label: 'technician\'s own list', w: 430, h: 950 }]) {
    const bp = await bootBand(browser, who.email, who.w, who.h);
    const before = await bandZones(bp);
    check(who.label + ': in-progress first (by recency), then collect signature/stamp, then approved, then cancelled last',
      JSON.stringify(before) === JSON.stringify(['Zone5', 'Zone4', 'Zone1', 'Zone2', 'Zone3']), JSON.stringify(before));

    // Bump p4's activity to right now and confirm it jumps to the top of its own band —
    // without displacing bands 2/3/4, which do not move.
    await bp.evaluate(() => {
      const app = window.__mkApp;
      app.mutate((d) => {
        const t = d.tickets.find(x => x.id === 'p4');
        t.audit.push({ ts: new Date().toISOString(), text: 'bumped', kind: 'lifecycle', by: 'Yousef Al-Harbi' });
      });
    });
    await bp.waitForTimeout(500);
    const after = await bandZones(bp);
    check(who.label + ': touching p4 again moves it back above p5, same band only',
      JSON.stringify(after) === JSON.stringify(['Zone4', 'Zone5', 'Zone1', 'Zone2', 'Zone3']), JSON.stringify(after));
    await bp.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
