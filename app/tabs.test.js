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
const wells = (p) => p.evaluate(() => {
  const th = Array.from(document.querySelectorAll('th')).find(h => /field \/ well/i.test(h.textContent || ''));
  if (!th) return null;
  return Array.from(th.closest('table').querySelectorAll('tbody tr'))
    .map(tr => (tr.textContent.match(/W\d/) || [''])[0]).filter(Boolean);
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

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
