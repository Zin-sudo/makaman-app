// Ops/admin altering a ticket a technician is still actively working. 2026-09-09,
// owner's request, worded almost verbatim: "when the ops try to alter, edit, change, or
// force close an in-progress ticket they should be prompted 'This ticket is still open
// by {Name of Technician} are you sure you wish to {Action name}'."
//
// Two action points, both already discrete UI actions rather than per-keystroke (every
// field on this screen writes straight through as you type — that stays, per
// savereview.test.js's own reasoning — so the confirmation sits on the two deliberate
// buttons, not on typing itself): Save changes, and Close the job for the technician.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function open(ctx, email) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1300, height: 1000 });
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
  await p.waitForTimeout(1400);
  return p;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── Save changes on t3 (Yousef's own open, 'logging' ticket) ────────────────────────
  {
    const ctx = await b.newContext();
    const p = await open(ctx, 'omar@makaman.ly');
    await p.evaluate(() => window.__mkApp.openReview('t3'));
    await p.waitForTimeout(700);

    // Make a change so Save is actually enabled.
    const search = p.getByPlaceholder(/Search item no/i);
    await search.fill('MKN-1808'); await p.waitForTimeout(400); await search.press('Enter');
    await p.waitForTimeout(600);

    await p.getByRole('button', { name: /^Save changes$/i }).click();
    await p.waitForTimeout(400);
    const body = await p.innerText('body');
    check('the prompt names the technician still holding the job',
      /This ticket is still open by Yousef Al-Harbi/i.test(body), body.match(/This ticket is still open by[^.]*\./i));
    check('and asks about saving specifically', /wish to save these changes/i.test(body));

    // Cancel — nothing should be saved yet (still on the confirm dialog, not the toast).
    await p.getByRole('button', { name: /^Cancel$/i }).click();
    await p.waitForTimeout(300);
    check('Cancel dismisses without a "Changes Saved" toast',
      !/Changes Saved/i.test(await p.innerText('body')));

    // Now actually confirm.
    await p.getByRole('button', { name: /^Save changes$/i }).click();
    await p.waitForTimeout(300);
    await p.getByRole('button', { name: /^Save changes$/i }).last().click();
    await p.waitForTimeout(500);
    check('confirming goes through and reports saved',
      /Changes Saved/i.test(await p.innerText('body')));
    await ctx.close();
  }

  // ── Force-close t3 while Yousef still holds it ──────────────────────────────────────
  {
    const ctx = await b.newContext();
    const p = await open(ctx, 'omar@makaman.ly');
    await p.evaluate(() => {
      const app = window.__mkApp;
      // Give it everything closeMissing needs so the Close button is actually live.
      app.mutate((d) => {
        const t = d.tickets.find(x => x.id === 't3');
        t.customer = t.customer || 'Northern Gulf Petroleum';
        t.field = t.field || 'Sabriyah'; t.well = t.well || 'SA-31'; t.rig = 'NG-2';
        t.jobType = 'COMBINATION FOR PRESSURE TEST';
      });
      app.openReview('t3');
    });
    await p.waitForTimeout(700);
    await p.getByRole('button', { name: /Close the job for the technician/i }).click();
    await p.waitForTimeout(400);
    const body = await p.innerText('body');
    check('force-close also names the holder before doing anything',
      /This ticket is still open by Yousef Al-Harbi/i.test(body));
    check('and asks about closing specifically', /wish to close the job/i.test(body));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
