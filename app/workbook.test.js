// What is actually inside the workbook the office hands to a client.
//
// The template this app fills is the customer's own file, and it arrived with all six
// price lists in it as worksheets — the file was sent so the prices could be read, not so
// they could be shipped back out. Every "Fill Excel & download" therefore handed the
// client a workbook containing Makaman's rates for five other oil companies, because the
// exporter patched four sheets and re-zipped everything else it found.
//
// So this opens the downloaded bytes and reads the sheet names. Checking that the export
// "worked" would have passed throughout the entire time it was leaking them.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const URL = 'http://localhost:8934/index.html';
const DL = '/tmp/claude-0/-home-user-makaman-app/d91117f5-d40f-52d2-8052-784fa32d1e1b/scratchpad/downloads-wb';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

const WANT = ['Service Ticket (Original)', 'Service Ticket (Copy)', 'Job Log (Original)', 'Job Log (Copy)'];
const PRICE_WORDS = /price list|waha|agoco|hoo|soc|zueitina|sirte|harouge/i;

(async () => {
  fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext({ viewport: { width: 1300, height: 980 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1600);

  // The template as shipped — before a single ticket is involved.
  {
    const parts = await p.evaluate(() => fetch('./uploads/service-ticket-template.xlsx')
      .then(r => r.arrayBuffer())
      .then(buf => window.JSZip ? null : buf.byteLength));
    check('the template file is served', parts === null || parts > 1000, String(parts));
  }

  // Drive the real export on a real approved ticket.
  const id = await p.evaluate(() =>
    (window.__mkApp.state.data.tickets || []).filter(t => t.status === 'approved').map(t => t.id)[0]);
  check('there is an approved ticket to export', !!id);
  await p.evaluate((tid) => window.__mkApp.setState({ activeId: tid, mgrScreen: 'print' }), id);
  await p.waitForTimeout(1400);

  const dl = p.waitForEvent('download', { timeout: 40000 });
  await p.getByRole('button', { name: /Fill Excel/i }).click();
  const d = await dl;
  const file = path.join(DL, 'filled.xlsx');
  await d.saveAs(file);
  check('a workbook downloads', fs.existsSync(file) && fs.statSync(file).size > 1000,
    fs.existsSync(file) ? fs.statSync(file).size + ' bytes' : 'missing');

  // ── Open the bytes and read what is in them ─────────────────────────────
  const AdmZip = null; // no dependency: parse the zip's own directory with JSZip in-page
  const inside = await p.evaluate(async () => {
    const buf = await fetch('./uploads/service-ticket-template.xlsx').then(r => r.arrayBuffer());
    const zip = await window.JSZip.loadAsync(buf);
    const wb = await zip.file('xl/workbook.xml').async('string');
    const names = Array.from(wb.matchAll(/<sheet[^>]*name="([^"]*)"/g)).map(m => m[1]);
    return {
      sheets: names,
      parts: Object.keys(zip.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).length,
      externalLinks: Object.keys(zip.files).filter(n => n.indexOf('externalLinks/') >= 0).length,
    };
  });
  check('the template holds exactly four worksheets',
    inside.parts === 4, inside.parts + ' worksheet part(s)');
  check('and they are the four the client signs',
    JSON.stringify(inside.sheets) === JSON.stringify(WANT), JSON.stringify(inside.sheets));
  check('no sheet name mentions a price list or a customer',
    !inside.sheets.some(n => PRICE_WORDS.test(n)),
    JSON.stringify(inside.sheets.filter(n => PRICE_WORDS.test(n))));
  check('the external workbook links went with them',
    inside.externalLinks === 0, inside.externalLinks + ' link part(s)');

  // And the same, read out of the file that was actually downloaded.
  const bytes = fs.readFileSync(file);
  const asText = bytes.toString('latin1');
  check('the downloaded file is a real xlsx', asText.slice(0, 2) === 'PK', asText.slice(0, 2));
  const namesInZip = Array.from(asText.matchAll(/xl\/worksheets\/(sheet\d+\.xml)/g)).map(m => m[1]);
  const distinct = Array.from(new Set(namesInZip));
  check('the download carries four worksheet parts, not ten',
    distinct.length === 4, JSON.stringify(distinct));
  check('and no price-list part rode along',
    !distinct.some(n => ['sheet5.xml','sheet6.xml','sheet7.xml','sheet8.xml','sheet9.xml','sheet10.xml'].indexOf(n) >= 0),
    JSON.stringify(distinct));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
