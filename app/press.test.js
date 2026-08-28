// Which buttons shake, and which stay still.
//
// The shake rotates 4 degrees about the top edge. How far a corner actually travels is a
// function of width — on a 40px bell it is under 2px and reads as a nudge; on a
// full-width primary button it is over 10px and reads as the layout breaking. So the rule
// is width, and this proves the split falls where it was meant to rather than that a
// number was written down.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function boot(b, email, w) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w || 412, height: 900 });
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
  await p.waitForTimeout(1500);
  return { ctx, p };
}
// Press it for real and see whether it shook.
const press = (p, pick) => p.evaluate(async (sel) => {
  const b = typeof sel === 'string'
    ? document.querySelector(sel)
    : Array.from(document.querySelectorAll('button')).filter(x => x.offsetParent)
        .sort((a, c) => c.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  if (!b) return { found: false };
  const w = Math.round(b.getBoundingClientRect().width);
  b.click();
  await new Promise(r => setTimeout(r, 70));
  const shook = b.classList.contains('shake-top') && getComputedStyle(b).animationName === 'shake-top';
  return { found: true, width: w, shook: shook, label: (b.innerText || b.title || '').trim().slice(0, 22) };
}, pick);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── The bell shakes ──────────────────────────────────────────────────────
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly', 1180);
    const bell = await press(p, '.mk-bell');
    check('the notification bell is an icon button', bell.found && bell.width <= 88, bell.width + 'px');
    check('and it shakes when pressed', bell.shook, JSON.stringify(bell));
    await ctx.close();
  }

  // ── The widest button on the page does not ───────────────────────────────
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly', 412);
    const big = await press(p, null);
    check('the widest visible button is a full-width action', big.found && big.width > 88,
      big.width + 'px — ' + big.label);
    check('and it stays still', !big.shook, JSON.stringify(big));
    await ctx.close();
  }

  // ── Nothing in between is left ambiguous ─────────────────────────────────
  //
  // Every visible button on one screen, each pressed on a freshly loaded page. Pressing
  // them in a single pass does not work and the first version of this test did exactly
  // that: the bell opens a panel and NEW JOB TICKET navigates, so by the third press the
  // remaining buttons were detached and measured 0px wide — a "narrow button that did
  // not shake", which looked like a defect and was an artefact of the test walking the
  // app while testing it.
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly', 412);
    const count = await p.evaluate(() => Array.from(document.querySelectorAll('button'))
      .filter(x => x.offsetParent && !x.closest('.mk-seg') && !x.closest('.mk-switch') && !x.disabled).length);
    const out = [];
    for (let n = 0; n < count; n++) {
      await p.reload({ waitUntil: 'networkidle' });
      await p.waitForTimeout(900);
      const r = await p.evaluate(async (idx) => {
        const btns = Array.from(document.querySelectorAll('button'))
          .filter(x => x.offsetParent && !x.closest('.mk-seg') && !x.closest('.mk-switch') && !x.disabled);
        const b = btns[idx];
        if (!b) return null;
        const w = Math.round(b.getBoundingClientRect().width);
        b.click();
        await new Promise(r => setTimeout(r, 70));
        return { w: w, shook: b.classList.contains('shake-top'),
                 label: (b.innerText || b.title || '').trim().slice(0, 18) };
      }, n);
      if (r && r.w > 0) out.push(r);
    }
    check('buttons were measured on both sides of the line',
      out.some(x => x.w <= 88) && out.some(x => x.w > 88),
      out.length + ' tested: ' + JSON.stringify(out.map(x => x.w)));
    check('every narrow button shook', out.filter(x => x.w <= 88).every(x => x.shook),
      JSON.stringify(out.filter(x => x.w <= 88 && !x.shook)));
    check('and no wide one did', out.filter(x => x.w > 88).every(x => !x.shook),
      JSON.stringify(out.filter(x => x.w > 88 && x.shook).map(x => x.label + ' @' + x.w)));
    await ctx.close();
  }

  // ── The exclusions still hold ────────────────────────────────────────────
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly', 412);
    await p.getByRole('button', { name: /^Account$/i }).last().click();
    await p.waitForTimeout(900);
    const sw = await press(p, '.mk-switch');
    check('the switch is narrow enough to qualify on width alone', sw.found && sw.width <= 88,
      sw.width + 'px');
    check('but is excluded anyway — its thumb is already the feedback', !sw.shook,
      JSON.stringify(sw));
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
