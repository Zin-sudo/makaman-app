// Verifies that content changes on the review screen are recorded, with actor and
// old -> new, and tagged 'edit' rather than 'lifecycle'.
const { chromium } = require('playwright-core');
const OUT = '/tmp/claude-0/-home-user-makaman-app/d91117f5-d40f-52d2-8052-784fa32d1e1b/scratchpad';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const audit = (page) => page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || '{}');
  const t = (d.tickets || []).find(x => x.status === 'done' && x.synced) || (d.tickets || [])[0];
  if (!t) return [];
  return (t.audit || []).map(a => ({ text: a.text, kind: a.kind, by: a.by }));
});

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });

  await page.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.evaluate(() => localStorage.removeItem('makaman.jobtickets.session.v1'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const i = page.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('x');
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /^Review$/i }).first().click();
  await page.waitForTimeout(900);

  // 1. mileage
  const mileage = page.locator('input[placeholder="0"]').first();
  await mileage.click(); await mileage.fill('118'); await page.locator('body').click();
  await page.waitForTimeout(500);

  // 2. add an item so there is a line to edit
  const search = page.getByPlaceholder(/Search item no/i);
  await search.fill('MKN-1808'); await page.waitForTimeout(400); await search.press('Enter');
  await page.waitForTimeout(700);

  // 3. override its unit cost
  const rows = page.locator('table tbody tr');
  const costCell = rows.first().locator('input').nth(3); // desc, qty, uom, cost
  await costCell.click(); await costCell.fill('999'); await page.locator('body').click();
  await page.waitForTimeout(600);

  // 4. job type
  // Locate by its label rather than by a style substring — the browser normalises
  // inline style text, so matching on it is unreliable.
  const jt = page.getByText('Job type (objective)').first().locator('..').locator('input').first();
  await jt.click(); await jt.fill('LEAK TEST'); await page.locator('body').click();
  await page.waitForTimeout(600);

  // Seeded history predates tagging and carries no kind, so anything tagged is new.
  const entries = await audit(page);
  const added = entries.filter(a => a.kind !== undefined);
  console.log('\nnew audit entries:');
  added.forEach(a => console.log(`   [${a.kind}] by=${a.by || '-'} :: ${a.text}`));
  console.log('');

  const has = (re) => added.some(a => re.test(a.text));
  check('mileage change recorded', has(/Mileage changed by .*118/));
  check('item add recorded', has(/Item MKN-1808 added/));
  check('unit cost override recorded with old -> new', has(/unit cost changed by .*→ 999/));
  check('job type change recorded', has(/Job type changed by .*LEAK TEST/));
  check('every new entry is tagged', added.every(a => a.kind === 'edit' || a.kind === 'lifecycle'), `kinds=${[...new Set(added.map(a => a.kind))].join(',')}`);
  check('edits are tagged edit, not lifecycle', added.filter(a => /changed by|added from/.test(a.text)).every(a => a.kind === 'edit'));
  check('actor recorded on edits', added.filter(a => a.kind === 'edit').every(a => a.by === 'Omar Al-Saleh'));
  check('no duplicate entry per keystroke', added.filter(a => /Mileage changed/.test(a.text)).length === 1,
    `${added.filter(a => /Mileage changed/.test(a.text)).length} mileage entries`);

  // seeded entries with no kind must still classify
  const seeded = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || '{}');
    const t = (d.tickets || []).find(x => x.status === 'approved');
    return (t.audit || []).map(a => ({ text: a.text, kind: a.kind }));
  });
  check('seeded entries carry no kind (classified at read time)', seeded.every(a => a.kind === undefined),
    `${seeded.length} seeded entries`);

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length ? JSON.stringify(errs, null, 1) : 'none');
  await page.screenshot({ path: OUT + '/80-audit.png' });
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
