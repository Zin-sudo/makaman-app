// Arabic text entry.
//
// The interface stays English — that is a settled decision, not an omission. What must
// work is the *content*: a Libyan customer, a well name or a job-log note typed in
// Arabic has to arrive, render as real joined script rather than empty boxes, lay itself
// out right-to-left inside its own field, and come back unchanged after a reload.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
const AR = 'شركة الظافرة للطاقة';
const AR_WELL = 'بئر الظافرة ٧';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };
async function open(ctx) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 1000 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  return p;
}
const login = async (p, email) => {
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1200);
};
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  // ── The face is there, and it is served from this origin ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    // Ask for Arabic on the page so the unicode-range gate actually fires. Without a
    // single Arabic codepoint the browser is right not to download the file, and a test
    // that checks for it without one is testing nothing.
    await p.evaluate((ar) => {
      const s = document.createElement('span');
      s.style.cssText = 'position:absolute;left:-9999px;font-family:"Barlow","Noto Sans Arabic",system-ui,sans-serif';
      s.textContent = ar; document.body.appendChild(s);
    }, AR);
    await p.waitForTimeout(900);
    const loaded = await p.evaluate(() => Array.from(document.fonts)
      .filter(f => f.status === 'loaded').map(f => f.family));
    check('an Arabic face is loaded, not left to whatever the device has',
      loaded.indexOf('Noto Sans Arabic') >= 0, loaded.join(', '));
    // Self-hosted, per CONSTRAINTS §5 — a webfont over the wire is a font that never
    // arrives at a wellhead.
    const remote = await p.evaluate(() => performance.getEntriesByType('resource')
      .map(r => r.name).filter(n => /fonts\.(googleapis|gstatic)\.com/.test(n)));
    check('and it is not fetched from a CDN', remote.length === 0, remote.join(', '));
    // Real joined script, not a row of .notdef boxes. Tofu renders at a uniform advance
    // per character; shaped Arabic does not, and ligatures make it narrower than the
    // naive sum.
    const shaped = await p.evaluate((ar) => {
      const mk = (ff) => { const s = document.createElement('span');
        s.style.cssText = 'position:absolute;visibility:hidden;font-size:64px;white-space:pre;font-family:' + ff;
        s.textContent = ar; document.body.appendChild(s);
        const w = s.getBoundingClientRect().width; s.remove(); return w; };
      const whole = mk('"Noto Sans Arabic"');
      let perChar = 0;
      for (const ch of ar) perChar += mk('"Noto Sans Arabic"') && (() => {
        const s = document.createElement('span');
        s.style.cssText = 'position:absolute;visibility:hidden;font-size:64px;white-space:pre;font-family:"Noto Sans Arabic"';
        s.textContent = ch; document.body.appendChild(s);
        const w = s.getBoundingClientRect().width; s.remove(); return w; })();
      return { whole: Math.round(whole), perChar: Math.round(perChar) };
    }, AR);
    check('the glyphs are joined, not isolated boxes',
      shaped.whole > 0 && shaped.whole < shaped.perChar * 0.95,
      `run ${shaped.whole}px vs ${shaped.perChar}px unjoined`);
    await ctx.close();
  }
  // ── A field flips to right-to-left when Arabic goes into it, and only then ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'omar@makaman.ly');
    await p.getByText('New ticket', { exact: false }).first().click();
    await p.waitForTimeout(900);
    const field = p.locator('input[dir="auto"]').first();
    check('free-text fields carry dir="auto"', await p.locator('input[dir="auto"]').count() > 0,
      String(await p.locator('input[dir="auto"]').count()) + ' fields');
    await field.fill('Al-Dhafra Energy');
    await p.waitForTimeout(300);
    const asLatin = await field.evaluate(el => getComputedStyle(el).direction);
    check('a Latin name leaves the field left to right', asLatin === 'ltr', asLatin);
    await field.fill(AR);
    await p.waitForTimeout(300);
    const asArabic = await field.evaluate(el => getComputedStyle(el).direction);
    check('an Arabic name turns that same field right to left', asArabic === 'rtl', asArabic);
    // A number or a code has no strong character, so nothing should move.
    await field.fill('1882');
    await p.waitForTimeout(300);
    const asNumber = await field.evaluate(el => getComputedStyle(el).direction);
    check('a ticket number is left alone', asNumber === 'ltr', asNumber);
    await ctx.close();
  }
  // ── It survives being stored and read back ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'omar@makaman.ly');
    // Write through the app's own store rather than the UI, so this tests persistence
    // rather than one screen's form handling.
    await p.evaluate((v) => {
      const app = window.__mkApp;
      app.mutate(d => { const t = d.tickets[0]; t.customer = v.c; t.well = v.w; });
    }, { c: AR, w: AR_WELL });
    await p.waitForTimeout(600);
    const stored = await p.evaluate(() => {
      const raw = localStorage.getItem('makaman.jobtickets.v2') || '{}';
      const t = (JSON.parse(raw).tickets || [])[0] || {};
      return { customer: t.customer, well: t.well, rawHasArabic: /[؀-ۿ]/.test(raw) };
    });
    check('Arabic reaches localStorage unmangled', stored.customer === AR, JSON.stringify(stored.customer));
    check('and so does a well name with Arabic-Indic digits', stored.well === AR_WELL, JSON.stringify(stored.well));
    check('stored as characters, not escapes', stored.rawHasArabic);
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(1000);
    const shown = await p.evaluate(() => document.body.innerText);
    check('the customer name renders after a reload', shown.indexOf('الظافرة') >= 0,
      shown.indexOf('الظافرة') >= 0 ? 'found' : 'not found on screen');
    await ctx.close();
  }
  // ── The printed ticket, which is the document the client signs ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'omar@makaman.ly');
    const id = await p.evaluate((ar) => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || []).find(x => x.status === 'approved') || app.state.data.tickets[0];
      app.mutate(d => { d.tickets.find(y => y.id === t.id).customer = ar; });
      return t.id;
    }, AR);
    await p.waitForTimeout(500);
    const pdf = await p.evaluate(async (id) => {
      const app = window.__mkApp;
      await app.loadExporters();
      const t = app.state.data.tickets.find(x => x.id === id);
      const SH = app.buildSheets(t);
      const doc = app.pdfFromPages(SH.svcOriginal);
      return doc.output('datauristring').split(',')[1];
    }, id);
    const bytes = Buffer.from(pdf, 'base64');
    check('a PDF is produced', bytes.length > 5000, bytes.length + ' bytes');
    // An embedded font is the whole point: the standard-14 faces are WinAnsi and cannot
    // draw the script, so a PDF with no FontFile is a PDF with no Arabic in it.
    check('the PDF carries an embedded font, not only the WinAnsi standard set',
      /\/FontFile2?/.test(bytes.toString('latin1')));
    // The discriminator is NOT the byte pattern. Both the broken and the fixed file
    // contain the very same UTF-16BE run — the name was always there. What changed is
    // whether a font in the document can draw it, so that is what gets asserted: a
    // composite (Type0) font is the only kind that can key off two-byte codepoints, and
    // an embedded FontFile is the only way those glyphs travel with the file.
    const ascii = bytes.toString('latin1');
    check('the Arabic is drawn in a composite font that carries its own glyphs',
      /\/BaseFont\s*\/[A-Za-z0-9+-]*NotoSansArabic/.test(ascii)
      && /\/Subtype\s*\/Type0/.test(ascii),
      'Type0: ' + /\/Subtype\s*\/Type0/.test(ascii));
    // And the run itself is real shaped Arabic: presentation forms, which is what jsPDF
    // emits and what the embedded subset was built to cover.
    const forms = (ascii.match(/\xfe[\x70-\xfc]/g) || []).length;
    check('and the run is shaped presentation forms, not raw base letters',
      forms >= 10, forms + ' presentation-form code units');
    await ctx.close();
  }

  // ── With the network cut ──
  //
  // The reason every library here is vendored. A font fetched over the wire is a font
  // that never arrives at a wellhead, so the only honest test is to take the wire away.
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'omar@makaman.ly');
    // Let the service worker install and fill its shell cache before pulling the plug.
    await p.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready);
    await p.waitForTimeout(2500);
    const cached = await p.evaluate(async () => {
      if (!window.caches) return null;
      const names = await caches.keys();
      const c = await caches.open(names[0]);
      const keys = (await c.keys()).map(r => r.url);
      return {
        shell: names[0],
        webFont: keys.some(u => /NotoSansArabic-arabic\.woff2$/.test(u)),
        pdfFont: keys.some(u => /jspdf-noto-arabic\.js$/.test(u)),
      };
    });
    check('the service worker precached the Arabic web font', cached && cached.webFont,
      JSON.stringify(cached));
    check('and the Arabic face the PDF embeds', cached && cached.pdfFont);

    await ctx.setOffline(true);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2000);
    const offline = await p.evaluate(async (ar) => {
      const s = document.createElement('span');
      s.style.cssText = 'position:absolute;left:-9999px;font-family:"Barlow","Noto Sans Arabic",system-ui,sans-serif';
      s.textContent = ar; document.body.appendChild(s);
      await document.fonts.ready;
      return {
        booted: !!window.__mkApp,
        faces: Array.from(document.fonts).filter(f => f.status === 'loaded').map(f => f.family),
      };
    }, AR);
    check('the app still boots with no network', offline.booted);
    check('and the Arabic face still loads from the cache',
      offline.faces.indexOf('Noto Sans Arabic') >= 0, offline.faces.join(', '));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
