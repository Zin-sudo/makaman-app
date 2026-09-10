// 2026-09-10, owner's request, with a screenshot marking the exact spot on a ticket tile:
// "Now that the owner of ticket 1884 TechTest has his ticket approved by the ops and
// changed to 'Collect Signature/Stamp' he should have the 'zip' button on the surface of
// the ticket tile without having to enter the inside of the ticket to download that
// originals and copies. The same exact 'zip' button that exists on the report tab...
// Only when the ticket is at the 'Collect Signature/Stamp' stage... the ticket moves to
// 'SENT TO FINANCE' and the zip button goes away."
//
// Ticket 1882 in the seed data is exactly this shape for Yousef already: approved, no
// signed documents attached yet — nothing to set up, the tile should already offer it.
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const URL = 'http://localhost:8934/index.html';
const DL = '/tmp/claude-0/-home-user-makaman-app/d91117f5-d40f-52d2-8052-784fa32d1e1b/scratchpad/dl-tilezip';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function boot(ctx, email) {
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1200);
  return p;
}
const card = (p, needle) => p.locator('.mk-ticket-card', { hasText: needle });

(async () => {
  fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── The tile offers it exactly when Collect Signature/Stamp shows, and not before ──
  {
    const ctx = await b.newContext({ acceptDownloads: true });
    const p = await boot(ctx, 'yousef@makaman.ly');
    const c = card(p, 'Kuwait Oil Group');
    check('ticket 1882 is on the tech\'s own list, at Collect Signature/Stamp',
      await c.locator('text=COLLECT SIGNATURE/STAMP').count() > 0);
    check('and its tile already carries the ZIP button — nothing to set up first',
      await c.getByRole('button', { name: /^ZIP$/ }).count() === 1);

    // t3 is still being logged — no chance of a zip button appearing early.
    check('a ticket still being logged never shows the button',
      await p.locator('.mk-ticket-card', { hasText: 'Sabriyah' }).getByRole('button', { name: /^ZIP$/ }).count() === 0);
    await ctx.close();
  }

  // ── Tapping it downloads the real three-file bundle, and does not open the ticket ──
  {
    const ctx = await b.newContext({ acceptDownloads: true });
    const p = await boot(ctx, 'yousef@makaman.ly');
    const dl = p.waitForEvent('download', { timeout: 30000 });
    await card(p, 'Kuwait Oil Group').getByRole('button', { name: /^ZIP$/ }).click();
    const d = await dl;
    const f = path.join(DL, d.suggestedFilename());
    await d.saveAs(f);
    check('the tile button produces a real download', fs.existsSync(f) && fs.statSync(f).size > 1000,
      d.suggestedFilename() + ' ' + fs.statSync(f).size + ' bytes');

    const names = await p.evaluate(async (b64) => {
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const zip = await window.JSZip.loadAsync(bin);
      return Object.keys(zip.files);
    }, fs.readFileSync(f).toString('base64'));
    check('with all three files — originals, copies, and the editable workbook',
      names.length === 3 && names.some(n => /ORIGINAL\.pdf$/.test(n))
        && names.some(n => /COPY\.pdf$/.test(n)) && names.some(n => /\.xlsx$/.test(n)),
      names.join(' , '));

    await p.waitForTimeout(400);
    const screen = await p.evaluate(() => window.__mkApp.state.techScreen);
    check('and tapping it stayed on the list — it did not open the ticket underneath',
      screen === 'list', screen);
    await ctx.close();
  }

  // ── It goes away the moment both signed documents are back and finance has it ──
  {
    const ctx = await b.newContext({ acceptDownloads: true });
    const p = await boot(ctx, 'yousef@makaman.ly');
    check('starts showing it', await card(p, 'Kuwait Oil Group').getByRole('button', { name: /^ZIP$/ }).count() === 1);
    await p.evaluate(() => {
      window.__mkApp.mutate(d => {
        const t = d.tickets.find(x => x.id === 't1');
        t.status = 'sent_finance';
        t.attachments = [
          { id: 'a1', docKind: 'service_ticket', filename: 'svc.pdf' },
          { id: 'a2', docKind: 'job_log', filename: 'log.pdf' },
        ];
      });
    });
    await p.waitForTimeout(500);
    check('the chip now reads SENT TO FINANCE', await card(p, 'Kuwait Oil Group').locator('text=SENT TO FINANCE').count() > 0);
    check('and the zip button is gone from the tile',
      await card(p, 'Kuwait Oil Group').getByRole('button', { name: /^ZIP$/ }).count() === 0);
    await ctx.close();
  }

  // ── A co-op crew member who does not currently hold the ticket gets no button ──
  {
    const ctx = await b.newContext({ acceptDownloads: true });
    const p = await boot(ctx, 'yousef@makaman.ly');
    await p.evaluate(() => {
      window.__mkApp.mutate(d => {
        const t = d.tickets.find(x => x.id === 't1');
        t.crew = [{ name: 'Yousef Al-Harbi', email: 'yousef@makaman.ly' },
                  { name: 'Mahmoud Zaki', email: 'mahmoud@makaman.ly' }];
        t.holder = 'Mahmoud Zaki';
      });
    });
    await p.waitForTimeout(500);
    check('the ticket still shows on the co-op member\'s own list',
      await card(p, 'Kuwait Oil Group').count() === 1);
    check('but the zip button is his colleague\'s to use, not this device\'s',
      await card(p, 'Kuwait Oil Group').getByRole('button', { name: /^ZIP$/ }).count() === 0);
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
