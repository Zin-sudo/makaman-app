// 2026-09-11, owner's report and requests, all landing on the Ticket Inbox at once:
//  1. "the container height is making the entire tile container go out of alignment...
//     make the zip container horizontal instead of vertical while keeping the fit for
//     the word zip inside it." — the ZIP button's own CSS (both the technician's tile
//     and the office Inbox's copy of it) now forces a single line of text no matter how
//     tight the row gets, letting the row itself wrap instead of the word inside it.
//  2. "when Awhida is using his ops view and selecting the 'Approved' filter he should
//     be seeing... x2 COLLECT SIGNATURE/STAMP tickets but he only sees 1... 1885." —
//     everReached() trusted a stale synced/synced_at pair even once a ticket had moved
//     well past 'logging'; a ticket in exactly ticket 1885's shape is now visible.
//  3. "give all the ticket tiles a ticket (ID for internal PWA use)... so i can always
//     refer to the ticket ID." — t.id/w.id now printed on the Inbox tile and the
//     withdrawn row.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(ctx, email) {
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1000);
  return p;
}
const card = (p, needle) => p.locator('.mk-ticket-card', { hasText: needle });

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── 1. The ZIP button never stretches its own tile taller than its neighbours ──
  // The fix is the CSS itself: white-space:nowrap + flex:none on the button (so the
  // word "ZIP" can never be individually squeezed into a multi-line stack), and
  // flex-wrap on the row that holds it (so if the row genuinely runs out of room, the
  // WHOLE button drops to its own new line rather than being crushed in place). Checked
  // as computed style, not a forced pixel reproduction — the letter-wrap itself depends
  // on exact font metrics that vary machine to machine, but these two properties are
  // exactly what stops it regardless of metrics, on both copies of the tile.
  {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 950 }, acceptDownloads: true });
    const p = await signIn(ctx, 'yousef@makaman.ly');
    const btn = card(p, 'Kuwait Oil Group').getByRole('button', { name: /^ZIP$/ });
    const style = await btn.evaluate(el => {
      const cs = getComputedStyle(el);
      const row = el.closest('div');
      return { whiteSpace: cs.whiteSpace, flexShrink: cs.flexShrink, rowFlexWrap: getComputedStyle(row).flexWrap };
    });
    check('technician tile: ZIP button text can never wrap onto a second line',
      style.whiteSpace === 'nowrap', style.whiteSpace);
    check('and the button itself can never be squeezed narrower than its own text',
      style.flexShrink === '0', style.flexShrink);
    check('and its row is the thing that wraps, not the word inside the button',
      style.rowFlexWrap === 'wrap', style.rowFlexWrap);
    await ctx.close();
  }
  {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 950 }, acceptDownloads: true });
    const p = await signIn(ctx, 'omar@makaman.ly');
    const btn = card(p, 'Kuwait Oil Group').getByRole('button', { name: /^ZIP$/ });
    const style = await btn.evaluate(el => {
      const cs = getComputedStyle(el);
      const row = el.closest('div');
      return { whiteSpace: cs.whiteSpace, flexShrink: cs.flexShrink, rowFlexWrap: getComputedStyle(row).flexWrap };
    });
    check('office Inbox tile: same guard on the ops/admin copy of the button',
      style.whiteSpace === 'nowrap' && style.flexShrink === '0' && style.rowFlexWrap === 'wrap',
      JSON.stringify(style));
    await ctx.close();
  }

  // 2026-09-11: a11y.test.js's own full-suite run caught this button at 33px wide on
  // exactly this screen — under the project's 36px tap-target floor (UX-PRINCIPLES.md,
  // "operated in nitrile gloves"). a11y's own sweep never previously exercised a
  // technician's list with the button showing, so the same-styled button on that older
  // tile had the identical defect undetected until this one was added beside it on a
  // screen a11y.test.js does cover. Guarded here directly rather than relying solely on
  // the a11y sweep noticing again.
  {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 950 } });
    const p = await signIn(ctx, 'omar@makaman.ly');
    const box = await card(p, 'Kuwait Oil Group').getByRole('button', { name: /^ZIP$/ }).boundingBox();
    check('the ZIP button clears the 36px tap-target floor on both edges',
      box.width >= 36 && box.height >= 36, JSON.stringify(box));
    await ctx.close();
  }

  // ── 2. everReached(): a ticket 1885-shaped straggler is visible, not just via
  // "Show these" on the Collect Signature/Stamp tile ──
  {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 950 } });
    const p = await signIn(ctx, 'omar@makaman.ly');
    await p.evaluate(() => {
      window.__mkApp.mutate(d => {
        const t = d.tickets.find(x => x.id === 't1');
        // Exactly ticket 1885's own shape, live: approved (so it has unquestionably
        // reached the server already), but its own synced/synced_at bookkeeping is
        // stuck the way a straggler from an interrupted sync would leave it.
        t.status = 'approved';
        t.synced = false;
        t.syncedAt = '';
      });
    });
    await p.waitForTimeout(500);
    check('a straggler ticket with status past logging shows in the default Inbox',
      await card(p, 'Kuwait Oil Group').count() === 1);
    // Select the "Approved" status pill, matching Awhida's own report exactly.
    await p.getByRole('button', { name: /^Approved$/i }).click();
    await p.waitForTimeout(500);
    check('and specifically under the Approved filter — not only via "Show these"',
      await card(p, 'Kuwait Oil Group').count() === 1);
    await ctx.close();
  }
  {
    // The one existing case this must NOT regress (attachments.test.js's own fixture):
    // a ticket genuinely still being logged, with no sync stamp at all, is a real
    // optimistic local create — it must stay excluded from the ordinary Inbox exactly
    // as it always has, since nothing has confirmed it reached the server yet.
    const ctx = await b.newContext({ viewport: { width: 1300, height: 950 } });
    const p = await signIn(ctx, 'omar@makaman.ly');
    await p.evaluate(() => {
      window.__mkApp.mutate(d => {
        const t = d.tickets.find(x => x.id === 't1');
        t.status = 'logging';
        t.synced = false;
        t.syncedAt = '';
      });
    });
    await p.waitForTimeout(500);
    check('a still-logging, never-synced ticket stays out of the Inbox, unaffected',
      await card(p, 'Kuwait Oil Group').count() === 0);
    await ctx.close();
  }

  // ── 3. Internal ticket ID on the Inbox tile and the withdrawn row ──
  {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 950 } });
    const p = await signIn(ctx, 'omar@makaman.ly');
    const id = await p.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
      return (d.tickets.find(x => x.id === 't1') || {}).id;
    });
    check('a real ticket id exists to show', !!id, id);
    check('the office Inbox tile prints this ticket\'s own raw id',
      (await card(p, 'Kuwait Oil Group').innerText()).indexOf(id) !== -1);

    // Withdraw a different ticket and confirm its id shows in the withdrawn list too.
    await p.evaluate(() => {
      window.__mkApp.mutate(d => {
        const t = d.tickets.find(x => x.id === 't2');
        if (t) { t.deletedAt = new Date().toISOString(); t.deletedBy = 'Omar Al-Saleh'; t.deleteReason = 'Duplicate of another job.'; }
      });
    });
    await p.waitForTimeout(500);
    const id2 = await p.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
      return (d.tickets.find(x => x.id === 't2') || {}).id;
    });
    const body = await p.innerText('body');
    check('the withdrawn row prints that ticket\'s own raw id too',
      !!id2 && body.indexOf(id2) !== -1, id2);
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
