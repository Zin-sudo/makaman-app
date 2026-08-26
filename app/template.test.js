// Filling the real Service Ticket workbook.
//
// Two things are being defended here.
//
// The first is honesty. "Fill Excel & download" used to write "4 sheets downloaded to
// this device" into the audit trail and raise a success toast without producing a file.
// So the assertions are not only "an export happens" but "nothing is claimed unless it
// did" — a failed export must leave the trail untouched.
//
// The second is that this fills the ORIGINAL sheets rather than generating new ones that
// resemble them. The customer receives a workbook they already recognise, so the test
// compares the output against the template part by part: everything except the four
// ticket sheets must come back byte-identical, and the cells must keep the style indices
// that carry their borders, fonts and number formats.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function office(ctx) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 1000 });
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
  await p.waitForTimeout(1400);
  return p;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── The workbook that comes out is the workbook that went in, with values in it ──
  {
    const ctx = await b.newContext();
    const p = await office(ctx);
    const r = await p.evaluate(async () => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || []).find(x => x.status === 'approved') || app.state.data.tickets[0];
      const out = await app.fillWorkbook(t);
      const src = await fetch(app.templateMap().file).then(x => x.arrayBuffer());
      const a = await window.JSZip.loadAsync(src);
      const c = await window.JSZip.loadAsync(await out.blob.arrayBuffer());
      const names = Object.keys(a.files).filter(n => !a.files[n].dir);
      const changed = [], missing = [];
      for (const n of names) {
        if (!c.files[n]) { missing.push(n); continue; }
        const x = await a.file(n).async('uint8array');
        const y = await c.file(n).async('uint8array');
        let same = x.length === y.length;
        if (same) for (let k = 0; k < x.length; k++) if (x[k] !== y[k]) { same = false; break; }
        if (!same) changed.push(n);
      }
      const sheet1 = await c.file('xl/worksheets/sheet1.xml').async('string');
      const sheet3 = await c.file('xl/worksheets/sheet3.xml').async('string');
      const cell = (xml, ref) => {
        const m = xml.match(new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)'));
        if (!m) return null;
        const body = m[2] || '';
        const inline = body.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        const v = body.match(/<v>([\s\S]*?)<\/v>/);
        return { style: (m[1].match(/\ss="(\d+)"/) || [])[1] || null,
                 value: inline ? inline[1] : (v ? v[1] : ''), raw: m[0] };
      };
      return {
        total: names.length, changed: changed, missing: missing,
        formulasLeft: (sheet1.match(/<f[^>]*>/g) || []).length + (sheet3.match(/<f[^>]*>/g) || []).length,
        customer: cell(sheet1, 'B8'), ticketNo: cell(sheet1, 'E8'),
        grand: cell(sheet1, 'F40'), logCustomer: cell(sheet3, 'B10'),
        expectTotal: app.ticketTotal(t), expectCustomer: t.customer, expectNo: t.ticketNo,
        overflow: out.overflow, bytes: out.blob.size,
      };
    }, );
    check('a workbook is produced', r.bytes > 100000, Math.round(r.bytes / 1024) + ' KB');
    // calcChain is the one part that must go. It is Excel's cached dependency graph, and
    // every formula it points at has just been replaced by a value — leaving a stale one
    // behind is what makes a patched workbook open with a repair prompt. Excel rebuilds
    // it from nothing. Anything else going missing is a real loss.
    const dropped = r.missing.filter(n => n !== 'xl/calcChain.xml');
    check('nothing is dropped from the template but the formula cache',
      dropped.length === 0 && r.missing.indexOf('xl/calcChain.xml') >= 0,
      dropped.length ? 'lost: ' + dropped.join(', ') : 'only calcChain, as intended');
    // Only the four ticket sheets and the content-type map may differ. Styles, the theme,
    // the embedded logo, the print settings and all six price-list tabs must be untouched
    // — that is what makes this the original sheet rather than a lookalike.
    const allowed = ['[Content_Types].xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
                     'xl/worksheets/sheet3.xml', 'xl/worksheets/sheet4.xml', 'xl/calcChain.xml'];
    const unexpected = r.changed.filter(n => allowed.indexOf(n) < 0);
    check('every other part comes back byte-identical', unexpected.length === 0,
      (r.total - r.changed.length) + ' of ' + r.total + ' identical' +
      (unexpected.length ? ' — unexpected: ' + unexpected.join(', ') : ''));

    check('the customer lands in B8', r.customer && r.customer.value === r.expectCustomer,
      r.customer && r.customer.value);
    check('the ticket number lands in E8', r.ticketNo && r.ticketNo.value === String(r.expectNo),
      r.ticketNo && r.ticketNo.value);
    check('the job log carries the customer too', r.logCustomer && r.logCustomer.value === r.expectCustomer);
    // The style index is what carries the border, font and number format. Losing it is
    // how a "filled template" quietly becomes a plain grid.
    check('filled cells keep their style index', r.customer && r.customer.style !== null,
      's=' + (r.customer && r.customer.style));
    check('the grand total is the app\'s figure, as a number',
      r.grand && Number(r.grand.value).toFixed(2) === r.expectTotal.toFixed(2),
      r.grand && r.grand.value);
    // The template was saved from a real ticket and carries its pricing:
    // F24 = -(E24*0.6) is a 60% discount and E22 = SUM(F16:F21) sums only six of the
    // twenty-four rows. Left alive they would recompute the workbook to a different
    // total from the PDF the customer signed.
    check('no formula survives to recompute the total', r.formulasLeft === 0,
      r.formulasLeft + ' formulas');
    await ctx.close();
  }

  // ── Nothing is claimed unless it happened ──
  {
    const ctx = await b.newContext();
    const p = await office(ctx);
    const before = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || []).find(x => x.status === 'approved') || app.state.data.tickets[0];
      app.setState({ activeId: t.id });
      return (t.audit || []).length;
    });

    // Break the fetch so the export genuinely fails, then confirm the trail is untouched.
    const after = await p.evaluate(async () => {
      const app = window.__mkApp;
      const real = window.fetch;
      window.fetch = () => Promise.resolve({ ok: false, status: 404 });
      let threw = false;
      try { await app.fillWorkbook(app.ticket()); } catch (e) { threw = true; }
      window.fetch = real;
      return { threw: threw, audit: (app.ticket().audit || []).length };
    });
    check('a failed fill raises rather than returning quietly', after.threw);
    check('and writes no audit entry', after.audit === before, before + ' -> ' + after.audit);

    // S9 dropped. The two cloud buttons are gone, and the reason they had to go is that
    // the Connect step behind them was a mock: it flipped a flag and invented an account
    // address, so Settings read "Connected as ops@makaman.ly" with nothing connected. The
    // guard is now on the absence — a mocked integration that reports itself connected is
    // worse than no integration, and this is what stops one coming back.
    const cloud = await p.evaluate(() => {
      const src = document.querySelector('script[type="text/x-dc"]').textContent;
      const page = document.body.innerText;
      return {
        handlers: /uploadOneDrive|uploadGoogleDrive|connectOneDrive|connectGoogleDrive/.test(src),
        flag: /cloudStorage/.test(src),
        claims: /Connected as/.test(page),
      };
    });
    check('no OneDrive or Google Drive handler is left in the app', !cloud.handlers);
    check('and no stored flag that could claim a connection', !cloud.flag);
    check('nothing on screen reports an account that was never connected', !cloud.claims);
    await ctx.close();
  }

  // ── A ticket bigger than the template says so ──
  {
    const ctx = await b.newContext();
    const p = await office(ctx);
    const r = await p.evaluate(async () => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || []).find(x => x.status === 'approved') || app.state.data.tickets[0];
      const one = (t.items || [])[0];
      app.mutate((d) => {
        const x = d.tickets.find(y => y.id === t.id);
        x.items = [];
        for (let n = 0; n < 30; n++) x.items.push(Object.assign({}, one, { code: 'X-' + n }));
      });
      const big = app.state.data.tickets.find(y => y.id === t.id);
      const out = await app.fillWorkbook(big);
      const c = await window.JSZip.loadAsync(await out.blob.arrayBuffer());
      const s1 = await c.file('xl/worksheets/sheet1.xml').async('string');
      // Read every amount in the item column and the total cell, so the balance can be
      // checked as arithmetic rather than asserted as an intention.
      const num = (ref) => {
        const m = s1.match(new RegExp('<c r="' + ref + '"[^>]*?><v>([-0-9.eE]+)</v></c>'));
        return m ? Number(m[1]) : null;
      };
      const amounts = [];
      for (let row = 16; row <= 39; row++) { const v = num('F' + row); if (v !== null) amounts.push(v); }
      const b23 = s1.match(/<c r="B38"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/);
      const carry = s1.match(/<c r="B39"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/);
      return {
        overflow: out.overflow, carriedItems: out.carriedItems,
        lastRealRowFilled: !!(b23 && b23[0].length > 30),
        carryText: carry ? carry[0] : '',
        sum: Number(amounts.reduce((n, v) => n + v, 0).toFixed(2)),
        total: num('F40'),
        appTotal: Number(app.ticketTotal(big).toFixed(2)),
      };
    });
    check('more lines than the template holds is reported, not silently dropped', r.overflow);
    check('and the rows it does hold are all filled', r.lastRealRowFilled);
    // S10. The workbook used to carry the whole job's total above only the first 24 lines,
    // so a client's form did not add up to its own printed figure. The last row now
    // carries what did not fit.
    check('the overflow is named in the file, not only in a toast that disappears',
      /further item\(s\)/.test(r.carryText), r.carryText.slice(0, 120));
    check('and it says how many were carried', r.carriedItems === 7, String(r.carriedItems));
    check('the visible amounts add up to the total printed beside them',
      r.sum === r.total, r.sum + ' vs ' + r.total);
    check('and that total is still the whole job, not a truncated one',
      r.total === r.appTotal, r.total + ' vs ' + r.appTotal);
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
