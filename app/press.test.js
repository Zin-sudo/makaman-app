// Which buttons shake, and which stay still.
//
// The shake rotates 4 degrees about the top edge. How far a corner actually travels is a
// function of width — on a 40px bell it is under 2px and reads as a nudge; on a
// full-width primary button it is over 10px and reads as the layout breaking. So the rule
// is width, and this proves the split falls where it was meant to rather than that a
// number was written down.
//
// It is driven by the Web Animations API rather than a class, so "did it shake" is asked
// of the element's running animations. That is not an implementation detail leaking into
// the test: a class was tried first and produced three animation starts for one press,
// because removing it re-resolved the element's animation list and restarted the bell's
// wobble. Counting animations is the only way to see that.
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
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await new Promise(r => setTimeout(r, 70));
  const shook = (b.getAnimations ? b.getAnimations() : []).some(a => a.__mkShake);
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
        b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        await new Promise(r => setTimeout(r, 70));
        return { w: w, shook: (b.getAnimations ? b.getAnimations() : []).some(a => a.__mkShake),
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

  // ── One shake per press, and nothing left behind ─────────────────────────
  //
  // The defect this guards against was found by measuring, not by reading: with the shake
  // driven by a class, one press on the bell produced three animation starts. Removing
  // the class at the end re-resolved the element's animation list, which restarted the
  // wobble it was already carrying — so the bell moved again half a second after the
  // press, for no reason a person could see.
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly', 1180);
    const r = await p.evaluate(async () => {
      const bell = document.querySelector('.mk-bell');
      const starts = [];
      bell.addEventListener('animationstart', (e) => starts.push(e.animationName), true);
      const before = (bell.getAnimations() || []).map(a => a.__mkShake ? 'shake' : 'other');
      bell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await new Promise(r => setTimeout(r, 40));
      const during = (bell.getAnimations() || []).map(a => a.__mkShake ? 'shake' : 'other');
      bell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      bell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1200));
      return {
        before: before, during: during,
        after: (bell.getAnimations() || []).map(a => a.__mkShake ? 'shake' : 'other'),
        cssRestarts: starts,
        cls: bell.className,
        transform: getComputedStyle(bell).transform,
      };
    });
    check('exactly one shake starts on the press',
      r.during.filter(x => x === 'shake').length === 1, JSON.stringify(r.during));
    check('and it is gone once it has run', r.after.every(x => x !== 'shake'),
      JSON.stringify(r.after));
    check('the press does not restart the bell\'s own wobble',
      r.cssRestarts.length === 0, JSON.stringify(r.cssRestarts));
    check('no class is left on the element', !/shake-top/.test(r.cls), r.cls);
    check('and the button is not left sitting askew',
      r.transform === 'none' || r.transform === 'matrix(1, 0, 0, 1, 0, 0)', r.transform);
    await ctx.close();
  }

  // ── A toast is the size of what it has to say ────────────────────────────
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly', 412);
    const size = (text) => p.evaluate(async (t) => {
      window.__mkApp.setState({ toast: null });
      await new Promise(r => setTimeout(r, 250));
      window.__mkApp.setState({ toast: { text: t, kind: 'ok' } });
      await new Promise(r => setTimeout(r, 1100));
      const el = document.querySelector('.mk-toast');
      if (!el) return null;
      const r0 = el.getBoundingClientRect();
      const txt = el.querySelector('div');
      return {
        w: Math.round(r0.width), h: Math.round(r0.height),
        lines: Math.round(txt.getBoundingClientRect().height / parseFloat(getComputedStyle(txt).lineHeight)),
        centred: Math.abs(r0.left - (innerWidth - r0.right)) < 2,
        overflows: r0.left < 0 || r0.right > innerWidth,
      };
    }, text);

    const short = await size('Saved.');
    const medium = await size('Ticket synchronised with the office.');
    const long = await size('Kuwait Oil Group was already approved in the office. Your copy was not uploaded and has been removed from the upload list. Open the ticket to read what the office has.');

    check('a one-word message gets a small box, not a full-width one',
      short.lines === 1 && short.w < 160, JSON.stringify(short));
    check('a one-line sentence still fits on one line',
      medium.lines === 1, JSON.stringify(medium));
    check('and it is wider than the short one — the box tracks the text',
      medium.w > short.w, short.w + ' -> ' + medium.w);
    check('a long message wraps rather than running off the phone',
      long.lines > 1 && !long.overflows, JSON.stringify(long));
    check('and is capped, not unbounded', long.w <= 412 - 24, long.w + 'px');
    check('all three stay centred', short.centred && medium.centred && long.centred);
    check('a one-line toast is not as tall as a wrapped one',
      short.h < long.h, short.h + ' vs ' + long.h);
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
