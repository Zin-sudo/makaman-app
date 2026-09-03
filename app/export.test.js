// Real files or nothing. These assertions open the downloaded bytes: a ZIP must contain
// two PDFs, and a PDF must start with %PDF and carry the ticket's own data.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const URL = 'http://localhost:8934/index.html';
const DL = '/tmp/claude-0/-home-user-makaman-app/d91117f5-d40f-52d2-8052-784fa32d1e1b/scratchpad/downloads';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

(async () => {
  fs.rmSync(DL, { recursive: true, force: true });
  fs.mkdirSync(DL, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 980 }, acceptDownloads: true });
  // Setup first, on a session that actually writes: the store is only persisted on the
  // first mutation, so a page that only reads has nothing to seed into. The seed carries
  // one approved ticket, which cannot demonstrate a limit — give it three.
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
  const seeded = await setup.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || 'null');
    if (!d) return 0;
    const base = d.tickets.find(x => x.status === 'approved') || d.tickets[0];
    [9101, 9102].forEach((no, i) => {
      const c = JSON.parse(JSON.stringify(base));
      c.id = 'x' + no; c.ticketNo = String(no); c.status = 'approved';
      c.synced = true; c.end = '2026-08-1' + (i + 1) + 'T10:00:00.000Z';
      d.tickets.push(c);
    });
    d.tickets.forEach(x => { x.synced = true; });
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
    localStorage.removeItem('makaman.jobtickets.session.v1');
    return d.tickets.filter(x => x.status === 'approved').length;
  });
  await setup.close();
  check('three approved tickets to report on', seeded === 3, String(seeded));

  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.__TOAST_TEST_MS = 20000; });
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  let i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1000);
  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(800);
  // Reports lives behind its own tile now, not open on the Account tab.
  await p.getByRole('button', { name: /^Reports/i }).first().click();
  await p.waitForTimeout(500);
  let body = await p.innerText('body');
  check('the report offers a month filter', /Month — counted by End Job date/i.test(body));
  check('and lists the tickets before anything is generated', /Ticket No\./i.test(body) && /ZIP/.test(body));

  // reactive to the slider
  const rows = () => p.locator('button', { hasText: /^ZIP$/ }).count();
  const before = await rows();
  await p.locator('input[type=range]').first().fill('1');
  await p.waitForTimeout(500);
  const after = await rows();
  check('the table reacts to the slider', after === 1 && before > 1, `${before} -> ${after}`);
  await p.locator('input[type=range]').first().fill('50');
  await p.waitForTimeout(500);
  check('and restores when the slider opens up', await rows() === before, `${await rows()} of ${before}`);

  // ── one ticket as a zip ──────────────────────────────────────────────────
  const dl1 = p.waitForEvent('download', { timeout: 30000 });
  await p.locator('button', { hasText: /^ZIP$/ }).first().click();
  const d1 = await dl1;
  const zipPath = path.join(DL, d1.suggestedFilename());
  await d1.saveAs(zipPath);
  check('a zip actually downloads', fs.existsSync(zipPath) && fs.statSync(zipPath).size > 1000,
    d1.suggestedFilename() + ' ' + fs.statSync(zipPath).size + ' bytes');

  // read it back with the same library the app used
  const inspect = await p.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const zip = await window.JSZip.loadAsync(bin);
    const names = Object.keys(zip.files);
    const heads = {};
    for (const n of names) {
      const txt = await zip.files[n].async('string');
      heads[n] = txt.slice(0, 5);
    }
    return { names, heads };
  }, fs.readFileSync(zipPath).toString('base64'));
  check('it holds exactly two files', inspect.names.length === 2, inspect.names.join(' , '));
  check('one originals, one copies',
    inspect.names.some(n => /ORIGINAL\.pdf$/.test(n)) && inspect.names.some(n => /COPY\.pdf$/.test(n)),
    inspect.names.join(' , '));
  check('both are real PDFs', Object.values(inspect.heads).every(h => h === '%PDF-'),
    JSON.stringify(inspect.heads));

  // ── the overview bundle ──────────────────────────────────────────────────
  const dl2 = p.waitForEvent('download', { timeout: 30000 });
  await p.getByRole('button', { name: /Generate bundle/i }).click();
  const d2 = await dl2;
  const pdfPath = path.join(DL, d2.suggestedFilename());
  await d2.saveAs(pdfPath);
  const buf = fs.readFileSync(pdfPath);
  check('the bundle downloads as a pdf', buf.slice(0, 5).toString() === '%PDF-',
    d2.suggestedFilename() + ' ' + buf.length + ' bytes');
  check('and is a landscape overview, not a ticket sheet', buf.length > 1000 && /Makaman-overview/.test(d2.suggestedFilename()));

  // ── month filter buckets on the end date ─────────────────────────────────
  // Done on a fresh page: nothing above this mutated, so the store was never written
  // and there was nothing to edit. A technician toggling a setting persists the seed.
  const h = await ctx.newPage();
  await h.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await h.goto(URL, { waitUntil: 'networkidle' });
  await h.waitForTimeout(250);
  await h.evaluate(() => localStorage.removeItem('makaman.jobtickets.session.v1'));
  await h.reload({ waitUntil: 'networkidle' }); await h.waitForTimeout(600);
  let hi = h.locator('input');
  await hi.nth(0).fill('yousef@makaman.ly'); await hi.nth(1).fill('makaman2026');
  await h.getByRole('button', { name: /log in/i }).click(); await h.waitForTimeout(900);
  await h.getByRole('button', { name: /^Account$/i }).last().click(); await h.waitForTimeout(400);
  await h.evaluate(() => { const t = document.querySelector('.mk-switch'); if (t) { t.click(); t.click(); } });
  await h.waitForTimeout(500);
  await h.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    const t = d.tickets.find(x => x.status === 'approved');
    // starts in February, ends in March — the work was delivered in March
    t.start = '2026-02-25T08:00:00.000Z';
    t.end = '2026-03-03T16:00:00.000Z';
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
    localStorage.removeItem('makaman.jobtickets.session.v1');
  });
  await h.reload({ waitUntil: 'networkidle' }); await h.waitForTimeout(700);
  hi = h.locator('input');
  await hi.nth(0).fill('omar@makaman.ly'); await hi.nth(1).fill('makaman2026');
  await h.getByRole('button', { name: /log in/i }).click(); await h.waitForTimeout(1000);
  await h.getByRole('button', { name: /^Account$/i }).last().click(); await h.waitForTimeout(800);
  // Reports lives behind its own tile now, not open on the Account tab.
  await h.getByRole('button', { name: /^Reports/i }).first().click();
  await h.waitForTimeout(500);

  const months = await h.locator('select').first().locator('option').allInnerTexts();
  check('a February-to-March job is offered under March', months.some(m => /March 2026/.test(m)), months.join(' | '));
  check('and never under February', !months.some(m => /February 2026/.test(m)), months.join(' | '));
  await h.locator('select').first().selectOption({ label: 'March 2026' });
  await h.waitForTimeout(600);
  check('selecting March keeps that job in the table',
    await h.locator('button', { hasText: /^ZIP$/ }).count() >= 1);
  await h.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
