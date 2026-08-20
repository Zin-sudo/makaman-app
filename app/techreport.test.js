// A technician prints and signs their own approved sheets on site, instead of the office
// posting a hardcopy out to the field and waiting for it back. Scoped to their own work.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const URL = 'http://localhost:8934/index.html';
const DL = '/tmp/claude-0/-home-user-makaman-app/d91117f5-d40f-52d2-8052-784fa32d1e1b/scratchpad/dl-tech';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(ctx, email, fresh) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 430, height: 940 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.__TOAST_TEST_MS = 20000; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  await p.evaluate((w) => { if (w) localStorage.clear(); else localStorage.removeItem('makaman.jobtickets.session.v1'); }, !!fresh);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('x');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1000);
  return p;
}

(async () => {
  fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 940 }, acceptDownloads: true });

  // Yousef has an approved job; Mahmoud has a different one. Neither may print the other's.
  let p = await signIn(ctx, 'yousef@makaman.ly', true);
  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const t = Array.from(document.querySelectorAll('button')).find(x => x.style.width === '42px');
    if (t) { t.click(); t.click(); }
  });
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    const mine = d.tickets.find(x => x.status === 'approved');
    mine.ticketNo = '5001';
    mine.crew = [{ name: 'Yousef Al-Harbi', email: 'yousef@makaman.ly' }];
    mine.tech = 'Yousef Al-Harbi'; mine.holder = 'Yousef Al-Harbi';
    const theirs = JSON.parse(JSON.stringify(mine));
    theirs.id = 'other'; theirs.ticketNo = '5002'; theirs.customer = 'Somebody Elses Job';
    theirs.crew = [{ name: 'Mahmoud Zaki', email: 'mahmoud@makaman.ly' }];
    theirs.tech = 'Mahmoud Zaki'; theirs.holder = 'Mahmoud Zaki';
    // a job Yousef opened and handed to Mahmoud — both names print, so both may print it
    const coop = JSON.parse(JSON.stringify(mine));
    coop.id = 'coop'; coop.ticketNo = '5003'; coop.customer = 'Handed Over Job';
    coop.crew = [{ name: 'Yousef Al-Harbi', email: 'yousef@makaman.ly' },
                 { name: 'Mahmoud Zaki', email: 'mahmoud@makaman.ly' }];
    coop.tech = 'Yousef Al-Harbi'; coop.holder = 'Mahmoud Zaki';
    // still awaiting review — not a document worth printing
    const pending = JSON.parse(JSON.stringify(mine));
    pending.id = 'pending'; pending.ticketNo = '5004'; pending.status = 'done';
    pending.customer = 'Not Approved Yet';
    d.tickets.push(theirs, coop, pending);
    d.tickets.forEach(x => { x.synced = true; });
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(800);

  let body = await p.innerText('body');
  check('the technician has a reports panel', /MY APPROVED JOBS/i.test(body));
  check('their own approved job is listed', /5001/.test(body));
  check('a colleague-only job is not', !/5002/.test(body) && !/Somebody Elses Job/i.test(body));
  check('a job they opened and handed on still is', /5003/.test(body));
  check('an unapproved job is not offered for printing', !/5004/.test(body) && !/Not Approved Yet/i.test(body));

  // the download itself
  const dl = p.waitForEvent('download', { timeout: 30000 });
  await p.locator('button', { hasText: /^ZIP$/ }).first().click();
  const d = await dl;
  const f = path.join(DL, d.suggestedFilename());
  await d.saveAs(f);
  check('a technician can produce their own sheets', fs.statSync(f).size > 1000,
    d.suggestedFilename() + ' ' + fs.statSync(f).size + ' bytes');
  const names = await p.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const zip = await window.JSZip.loadAsync(bin);
    return Object.keys(zip.files);
  }, fs.readFileSync(f).toString('base64'));
  check('with originals and copies, ready to sign', names.length === 2
    && names.some(n => /ORIGINAL/.test(n)) && names.some(n => /COPY/.test(n)), names.join(' , '));

  // offline refusal, so nobody prints a version the office has since amended
  await ctx.setOffline(true);
  await p.waitForTimeout(400);
  await p.locator('button', { hasText: /^ZIP$/ }).first().click();
  await p.waitForTimeout(500);
  check('offline it refuses rather than printing a stale sheet',
    /Reports need a connection/i.test(await p.innerText('body')));
  await ctx.setOffline(false);
  await p.close();

  // ── the other technician sees only theirs ────────────────────────────────
  p = await signIn(ctx, 'mahmoud@makaman.ly');
  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(800);
  body = await p.innerText('body');
  check('the colleague sees their own job', /5002/.test(body));
  check('and the shared one', /5003/.test(body));
  check('but not the job that was never theirs', !/5001/.test(body));
  await p.close();

  // ── the office still sees everything ─────────────────────────────────────
  p = await signIn(ctx, 'omar@makaman.ly');
  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(800);
  body = await p.innerText('body');
  check('the office view is unchanged — every approved job',
    /5001/.test(body) && /5002/.test(body) && /5003/.test(body));
  check('and it is still titled Reports, not My approved jobs', /REPORTS/i.test(body) && !/MY APPROVED JOBS/i.test(body));
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
