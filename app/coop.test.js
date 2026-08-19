// A job opened by one technician and finished by another after a rotation change.
// Needs the app served locally and playwright-core with the pre-installed Chromium.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

// One shared browser context throughout: each browser.newPage() would otherwise get
// its own isolated storage, and the whole point here is that a handover made by one
// technician is seen by the next.
async function signIn(ctx, email, w, h) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w || 1300, height: h || 950 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.removeItem('makaman.jobtickets.session.v1'));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('x');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(900);
  return p;
}
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || 'null'));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });

  // Yousef holds the seeded in-progress ticket (Northern Gulf Petroleum).
  let p = await signIn(ctx, 'yousef@makaman.ly', 430, 900);
  let body = await p.innerText('body');
  check('holder sees the job before handing it on', /Northern Gulf Petroleum/.test(body));

  await p.getByText('Northern Gulf Petroleum').first().click();
  await p.waitForTimeout(700);
  body = await p.innerText('body');
  check('holder can log to it', /Log line/i.test(body));
  check('holder is offered the handover', /Hand over job/i.test(body));

  await p.getByRole('button', { name: /Hand over job/i }).click();
  await p.waitForTimeout(500);
  await p.locator('select').last().selectOption('Mahmoud Zaki');
  await p.waitForTimeout(200);
  await p.getByRole('button', { name: /^Hand over$/i }).click();
  await p.waitForTimeout(800);

  let d = await store(p);
  let tk = d.tickets.find(x => x.customer === 'Northern Gulf Petroleum');
  check('holder moved', tk.holder === 'Mahmoud Zaki', tk.holder);
  check('crew keeps the opener and adds the new holder',
    JSON.stringify((tk.crew || []).map(c => c.name)) === JSON.stringify(['Yousef Al-Harbi', 'Mahmoud Zaki']),
    JSON.stringify((tk.crew || []).map(c => c.name)));
  check('handover is recorded', (tk.audit || []).some(a => /handed over by Yousef Al-Harbi to Mahmoud Zaki/i.test(a.text)));
  check('handover is a job stage, not an edit', (tk.audit || []).some(a => /handed over/i.test(a.text) && a.kind === 'lifecycle'));

  // the previous holder keeps it, read-only
  body = await p.innerText('body');
  check('previous holder still sees the ticket', /Northern Gulf Petroleum/.test(body));
  check('previous holder is told who has it now', /Mahmoud Zaki has this job now/i.test(body));
  check('previous holder cannot log to it', !/Log line/i.test(body));
  check('previous holder cannot hand it on again', !/Hand over job/i.test(body));
  await p.close();

  // the new holder picks it up and can work it
  p = await signIn(ctx, 'mahmoud@makaman.ly', 430, 900);
  body = await p.innerText('body');
  check('new holder sees it in their own list', /Northern Gulf Petroleum/.test(body));
  check('it is marked as shared work', /CO-OP/i.test(body));
  await p.getByText('Northern Gulf Petroleum').first().click();
  await p.waitForTimeout(700);
  body = await p.innerText('body');
  check('new holder can log to it', /Log line/i.test(body));
  // The work the previous technician logged is there to continue, not a blank sheet.
  // Read the field values: a textarea's value is a property, so it never appears in
  // innerText no matter what is displayed in it.
  const logLines = await p.evaluate(() =>
    Array.from(document.querySelectorAll('textarea, input')).map(el => el.value).join(' | '));
  check('new holder continues the existing log', /JSA completed with rig supervisor/i.test(logLines));
  await p.close();

  // the office: both names, and either name finds it
  p = await signIn(ctx, 'omar@makaman.ly');
  await p.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    s.tickets.forEach(t => { t.synced = true; t.syncedAt = new Date().toISOString(); });
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(s));
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  body = await p.innerText('body');
  check('inbox names both technicians', /Yousef Al-Harbi → Mahmoud Zaki/.test(body));

  const sel = p.locator('select').first();
  await sel.selectOption('Yousef Al-Harbi'); await p.waitForTimeout(600);
  check('filtering by the opener finds it', /Northern Gulf Petroleum/.test(await p.innerText('body')));
  await sel.selectOption('Mahmoud Zaki'); await p.waitForTimeout(600);
  check('filtering by the closer finds it too', /Northern Gulf Petroleum/.test(await p.innerText('body')));
  await sel.selectOption(''); await p.waitForTimeout(500);

  // both names reach the printed sheets
  const row = p.locator('tr', { hasText: 'Northern Gulf Petroleum' }).first();
  await row.getByRole('button', { name: /^(Review|View)$/i }).first().click();
  await p.waitForTimeout(800);
  check('office can reassign', /Reassign to another technician/i.test(await p.innerText('body')));
  await p.getByRole('button', { name: /Preview 4 sheets/i }).click();
  await p.waitForTimeout(900);
  const sheets = await p.innerText('body');
  check('Service Ticket names both', /MKN Supervisor[\s\S]{0,40}Yousef Al-Harbi → Mahmoud Zaki/i.test(sheets));
  check('Job Log names both', /Job Supervisor[\s\S]{0,40}Yousef Al-Harbi → Mahmoud Zaki/i.test(sheets));
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
