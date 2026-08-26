// The printed sheet: the preview and the PDF must stay the same document.
//
// These are two renderers — HTML on screen, jsPDF in the file — and they had already
// drifted once, badly: the preview grew a letterhead, a boxed field grid, a ticket-number
// panel and a ruled table while the PDF stayed a plain list of typed lines. Nobody
// noticed because nobody was comparing them, and the customer signs the PDF.
//
// So this file compares them. It renders the preview, measures the bands, generates the
// PDF from the same ticket, and checks the same bands land in the same proportional
// places. It also checks the sheet is genuinely sealed off from the app's own styles,
// because "it looks right today" is not the same as "a restyle cannot move it".
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function sheetPage(ctx, theme) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1100, height: 1200 });
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
  await p.evaluate((t) => {
    const app = window.__mkApp;
    app.updateSettings({ theme: t });
    const tk = (app.state.data.tickets || []).find(x => x.status === 'approved') || app.state.data.tickets[0];
    app.setState({ activeId: tk.id, mgrScreen: 'print' });
  }, theme || 'light');
  await p.waitForTimeout(1500);
  return p;
}
// The vertical position of each band, as a fraction of the sheet's content width — the
// one unit both renderers share.
const previewBands = (p) => p.evaluate(() => {
  const sheet = document.querySelector('.mk-sheet');
  const cs = getComputedStyle(sheet);
  const padL = parseFloat(cs.paddingLeft), padT = parseFloat(cs.paddingTop);
  const S = sheet.getBoundingClientRect();
  const contentW = S.width - padL * 2 - parseFloat(cs.borderLeftWidth) * 2;
  const out = { contentW: +contentW.toFixed(1), bands: [] };
  Array.from(sheet.children).forEach((c) => {
    const r = c.getBoundingClientRect();
    out.bands.push({
      tag: c.tagName,
      top: +((r.top - S.top - padT) / contentW).toFixed(4),
      h: +(r.height / contentW).toFixed(4),
      text: (c.innerText || '').trim().slice(0, 22).replace(/\n/g, ' '),
    });
  });
  const tbl = sheet.querySelector('table');
  if (tbl) out.cols = Array.from(tbl.querySelectorAll('thead th'))
    .map(th => +(th.getBoundingClientRect().width / contentW).toFixed(4));
  return out;
});

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── The sheet ignores the app's own stylesheets ──
  //
  // The real assertion behind "hardcode this layout". Not "it looks right", but "with
  // every stylesheet this app ships disabled, nothing inside the sheet moves". If a
  // future restyle can reach in, this fails.
  {
    const ctx = await b.newContext();
    const p = await sheetPage(ctx);
    const before = await previewBands(p);
    const after = await p.evaluate(() => {
      // Turn off every stylesheet the app owns, leaving only the sheet's inline styles
      // and the .mk-sheet block that pins what it inherits.
      const kept = [];
      for (const ss of Array.from(document.styleSheets)) {
        try {
          if (!ss.ownerNode) continue;
          const isSheetBlock = ss.ownerNode.textContent && ss.ownerNode.textContent.indexOf('.mk-sheet {') >= 0;
          if (isSheetBlock) { kept.push('sheet-block'); continue; }
          ss.disabled = true;
        } catch (e) { /* cross-origin */ }
      }
      return kept;
    });
    await p.waitForTimeout(400);
    const stripped = await previewBands(p);
    check('the sheet block was kept while the rest were disabled', after.length === 1, after.join(','));
    const moved = before.bands.filter((band, i) => {
      const s2 = stripped.bands[i];
      return !s2 || Math.abs(band.top - s2.top) > 0.004 || Math.abs(band.h - s2.h) > 0.004;
    });
    check('no band moves when the app\'s stylesheets are switched off',
      moved.length === 0,
      moved.length ? moved.map(m => m.text).join(' / ') : before.bands.length + ' bands held');
    check('and the content width is unchanged',
      Math.abs(before.contentW - stripped.contentW) < 1,
      before.contentW + ' -> ' + stripped.contentW);
    await ctx.close();
  }

  // ── The sheet ignores the app's theme ──
  {
    const ctx = await b.newContext();
    const p = await sheetPage(ctx, 'dark');
    const look = await p.evaluate(() => {
      const s = document.querySelector('.mk-sheet');
      const cs = getComputedStyle(s);
      const val = Array.from(s.querySelectorAll('div')).find(d => /Burgan|Kuwait|شركة/.test(d.textContent));
      return { bg: cs.backgroundColor, ink: cs.color, dir: cs.direction,
               font: cs.fontFamily.split(',')[0].replace(/"/g, ''),
               valueInk: val ? getComputedStyle(val).color : null };
    });
    check('the sheet stays white paper in the dark theme', look.bg === 'rgb(255, 255, 255)', look.bg);
    check('and its ink stays dark', look.ink === 'rgb(29, 31, 32)', look.ink);
    check('its typeface is pinned, not inherited from the app', look.font === 'Barlow', look.font);
    check('and it reads left to right whatever the app does', look.dir === 'ltr', look.dir);
    await ctx.close();
  }

  // ── The PDF is the same document as the preview ──
  {
    const ctx = await b.newContext();
    const p = await sheetPage(ctx);
    const pv = await previewBands(p);
    const pdf = await p.evaluate(async () => {
      const app = window.__mkApp;
      await app.loadExporters();
      const t = app.ticket();
      const SH = app.buildSheets(t);
      const doc = app.pdfFromPages(SH.svcOriginal);
      return {
        b64: doc.output('datauristring').split(',')[1],
        geom: (function (G) {
          return { M: G.M, W: G.W, PX: G.PX,
                   itemCols: G.itemCols.map(c => +(c.w / G.PX).toFixed(4)),
                   letterhead: G.letterhead, titleBar: G.titleBar };
        })(app.sheetGeometry()),
        itemCap: SH.itemCap,
      };
    });
    const bytes = Buffer.from(pdf.b64, 'base64');
    check('a PDF is produced', bytes.length > 20000, bytes.length + ' bytes');
    // A letterhead that pushes a ticket to nine megabytes is a ticket a technician on a
    // field connection cannot send.
    check('and it is a size a field connection can carry', bytes.length < 1500000,
      Math.round(bytes.length / 1024) + ' KB');
    check('the letterhead logo is embedded', /\/Subtype\s*\/Image/.test(bytes.toString('latin1')));

    // The columns are the same shares of the sheet in both renderers. This is the
    // assertion that catches a width changed on one side only.
    const same = pv.cols && pv.cols.length === pdf.geom.itemCols.length
      && pv.cols.every((c, i) => Math.abs(c - pdf.geom.itemCols[i]) < 0.01);
    check('the item columns are the same shares in the preview and the PDF', same,
      'preview ' + JSON.stringify(pv.cols) + ' vs pdf ' + JSON.stringify(pdf.geom.itemCols));

    // The bands are stated in the preview's own pixels, so the preview must actually
    // measure what SHEET says it does — otherwise the PDF is scaling from stale numbers.
    const lh = pv.bands[0], tb = pv.bands[1];
    check('the letterhead is the height SHEET says it is',
      Math.abs(lh.h * pdf.geom.PX - pdf.geom.letterhead) < 3,
      (lh.h * pdf.geom.PX).toFixed(1) + ' vs ' + pdf.geom.letterhead);
    check('and so is the title bar',
      Math.abs(tb.h * pdf.geom.PX - pdf.geom.titleBar) < 3,
      (tb.h * pdf.geom.PX).toFixed(1) + ' vs ' + pdf.geom.titleBar);

    // The row cap has to leave room for the signatures. When it did not, the signature
    // block printed straight through the item table.
    const perPage = pdf.geom.PX * (297 - 2 * pdf.geom.M) / pdf.geom.W;
    check('the page has room for its rows and its signatures', pdf.itemCap >= 12 && pdf.itemCap <= 22,
      pdf.itemCap + ' rows in ' + Math.round(perPage) + 'px');
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
