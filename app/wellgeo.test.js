// The coordinates printed beside the well number, on the generated sheet.
//
// Worth asserting because it fails quietly: a footnote that runs into the next column
// still produces a PDF — an unreadable one.
const { chromium } = require('playwright-core');
const fs = require('fs');
const pathmod = require('path');
const URL = 'http://localhost:8934/index.html';
const TMP = '/tmp/claude-0/-home-user-makaman-app/d91117f5-d40f-52d2-8052-784fa32d1e1b/scratchpad/wellgeo';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const FIX = { lat: 28.906745, lon: 19.213311 };
const COORD = '28.906745, 19.213311';

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── the coordinates print beside the well number ─────────────────────────
  const desk = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  const p = await desk.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1400);
  // A deliberately absurd well number. The realistic ones all fit; the question worth
  // asking is what happens when one does not.
  await p.evaluate(([f]) => window.__mkApp.mutate(d => {
    d.tickets.forEach((x, n) => {
      x.geo = { open: { lat: f.lat, lon: f.lon, ts: new Date().toISOString() }, last: null, pingedAt: new Date().toISOString() };
      x.status = 'approved';
      x.ticketNo = x.ticketNo || String(9100 + n);
      // Ticket 0 gets a realistic well number, so the footnote must actually appear.
      // Ticket 1 gets an absurd one, so the guard must be exercised. Asking one ticket
      // to demonstrate both would be asking it to print the coordinates and to drop
      // them, which is why this is two tickets and two zips.
      if (n === 0) x.well = 'B235i-59W';
      if (n === 1) x.well = 'B235i-59W-EXTRA-LONG-WELL-NAME-XX';
    });
  }), [FIX]);
  await p.waitForTimeout(600);

  const noted = await p.evaluate(() => {
    const app = window.__mkApp;
    const t = app.state.data.tickets[0];
    const SH = app.buildSheets(t);
    return (JSON.stringify(SH).match(/"noteA":"\[[^"]*\]"/g) || []).length;
  });
  check('every sheet puts the coordinates on its Well No. row', noted === 8, noted + ' rows');

  await p.evaluate(() => window.__mkApp.setState({ mgrScreen: 'print' }));
  await p.waitForTimeout(900);
  const rendered = await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll('div')).find(d => d.textContent.trim() === 'Well No:');
    if (!el) return null;
    const row = el.parentElement;
    const val = row.querySelector('div:nth-child(2)');
    // The template runtime wraps every {{ binding }} in a span of its own, so the first
    // span in this row belongs to the label, not to the footnote. Pick the one actually
    // holding the coordinates — otherwise this compares the label against the value and
    // passes without ever looking at the thing under test.
    const note = Array.from(row.querySelectorAll('span'))
      .filter(sp => sp.textContent.trim().startsWith('[')).pop();
    return {
      text: row.innerText.replace(/\s+/g, ' '),
      valueSize: parseFloat(getComputedStyle(val).fontSize),
      noteSize: note ? parseFloat(getComputedStyle(note).fontSize) : null,
      overflows: row.scrollWidth > row.clientWidth + 1,
    };
  });
  check('the preview shows well then coordinates', !!rendered && rendered.text.includes('[' + COORD + ']'),
    rendered && rendered.text);
  check('the coordinates are set smaller, like a footnote',
    !!rendered && rendered.noteSize > 0 && rendered.noteSize <= rendered.valueSize - 3,
    rendered && (rendered.noteSize + 'px note vs ' + rendered.valueSize + 'px value'));
  check('and the row does not overflow its cell', !!rendered && !rendered.overflows);

  // ── and in both generated files ──────────────────────────────────────────
  const save = async (fn, name) => {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 40000 }), p.evaluate(fn)]);
    const out = pathmod.join(TMP, name);
    await dl.saveAs(out);
    return out;
  };
  const bundle = await save(() => window.__mkApp.exportBundle(window.__mkApp.state.data.tickets, 'all-months'), 'bundle.pdf');
  const zip = await save(() => window.__mkApp.exportTicketZip(window.__mkApp.state.data.tickets[0]), 'ticket.zip');
  const zipLong = await save(() => window.__mkApp.exportTicketZip(window.__mkApp.state.data.tickets[1]), 'ticket-longwell.zip');
  check('the overview bundle downloads', fs.statSync(bundle).size > 1000);
  check('the per-ticket zip downloads', fs.statSync(zip).size > 1000);
  check('and so does one for the over-long well number', fs.statSync(zipLong).size > 1000);
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  // The two PDFs are inspected by wellgeo-pdf.py, which has a real PDF parser; this
  // file's job is the browser half.
  process.exit(fail ? 1 : 0);
})();
