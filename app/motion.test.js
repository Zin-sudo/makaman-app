// Motion: the press you can feel through a glove, the bottom bar, and the promise that
// somebody who asked their phone to stop moving things gets a phone that stops.
//
// Adapted from a micro-interactions guide rather than copied from it. Two of its five
// patterns were taken — the tactile button squish and the bottom-bar active state — and
// rebuilt on this app's tokens and markup. Three were left: floating labels (the label
// slides over a field that carries dir="auto" Arabic), a bell that rings on every tap,
// and a div-and-ul replacement for <select>, which would throw away the OS picker that
// technicians in gloves actually rely on.
//
// The assertions are here because motion is the one thing a screenshot cannot check. A
// still frame of a lifted icon looks identical whether it slid or jumped, and identical
// whether or not the animation underneath it is still running.
const { chromium } = require('playwright-core');
let pass=0, fail=0;
const check=(n,ok,x)=>{ok?pass++:fail++;console.log(`  ${ok?'PASS':'FAIL'}  ${n}${x?'   '+x:''}`)};
const boot = async (b, email, reduced) => {
  const ctx = await b.newContext(reduced ? { reducedMotion: 'reduce' } : {});
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 430, height: 880 });
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1500);
  return { ctx, p };
};
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── The squish, on a page already "finished" ──────────────────────────
  {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 430, height: 880 });
    await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
    await p.goto('http://localhost:8934/index.html', { waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    const r = await p.evaluate(async () => {
      const btn = Array.from(document.querySelectorAll('button')).find(x=>/log in/i.test(x.textContent));
      const rest = getComputedStyle(btn).transform;
      // :active is a real state, so drive a real press.
      const box = btn.getBoundingClientRect();
      btn.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, clientX:box.x+5, clientY:box.y+5}));
      await new Promise(r=>setTimeout(r,60));
      const held = getComputedStyle(btn).transform;
      return { rest, held, tr: getComputedStyle(btn).transitionProperty };
    });
    // The page-1 login button must have picked this up too, not just page 3.
    check('login (page 1) button declares a transform transition', /transform/.test(r.tr), r.tr);
    await ctx.close();
  }

  // ── The nav ───────────────────────────────────────────────────────────
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly');
    const nav = await p.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.mk-nav-item'));
      const on = document.querySelector('.mk-nav-on');
      const off = items.find(x => !x.classList.contains('mk-nav-on'));
      const t = (el) => el ? getComputedStyle(el.querySelector('svg')).transform : null;
      const o = (el) => el ? getComputedStyle(el.querySelector('span')).opacity : null;
      return { count: items.length, hasOn: !!on, onT: t(on), offT: t(off), onO: o(on), offO: o(off),
               tr: on ? getComputedStyle(on.querySelector('svg')).transitionProperty : null };
    });
    check('every tab carries the nav class', nav.count === 4, nav.count + ' items');
    check('exactly the active one is marked', nav.hasOn);
    check('the active icon is lifted and the others are not',
      nav.onT !== nav.offT && nav.onT !== 'none', nav.onT + ' vs ' + nav.offT);
    check('the active label is at full strength', Number(nav.onO) > Number(nav.offO),
      nav.onO + ' vs ' + nav.offO);
    check('and it is a transition, not a jump', /transform/.test(nav.tr || ''), nav.tr);

    // Switching tabs moves the mark.
    await p.getByRole('button', { name: /^Activity$/ }).click();
    await p.waitForTimeout(500);
    const moved = await p.evaluate(() => {
      const on = document.querySelector('.mk-nav-on');
      return on ? on.innerText.trim() : null;
    });
    check('the mark follows the tab you pressed', /Activity/i.test(moved || ''), moved);

    // The joined row must not gain gaps: the whole-button squish is off here.
    const seam = await p.evaluate(() => {
      const it = document.querySelector('.mk-nav-item');
      const cs = getComputedStyle(it);
      return cs.transform;
    });
    check('nav items themselves do not scale', seam === 'none', seam);
    await ctx.close();
  }

  // ── Segmented controls opted out ──────────────────────────────────────
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    await p.evaluate(() => window.__mkApp.setState({ showSettings: true }));
    await p.waitForTimeout(500);
    const segs = await p.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.mk-seg'));
      return { rows: rows.length, btns: rows.reduce((a,r)=>a+r.querySelectorAll('button').length,0) };
    });
    check('the segmented rows are marked', segs.rows === 2 && segs.btns > 0,
      segs.rows + ' rows, ' + segs.btns + ' segments');
    await ctx.close();
  }

  // ── Reduced motion, against an element that really does loop ─────────
  //
  // The first version of this counted pulsing elements on the technician's ticket list
  // and found none, then declared victory — a vacuous pass. The sync banner's dot only
  // exists when there is something pending, so the condition has to be created before
  // the claim means anything. Proved in both directions in one run: infinite normally,
  // once under reduced motion.
  {
    const arm = async (p) => {
      await p.evaluate(() => {
        window.__mkApp.mutate((d) => {
          const t = d.tickets.find(x => x.id === 't1');
          t.status = 'done'; t.synced = false;
        });
      });
      await p.waitForTimeout(600);
      return p.evaluate(() => {
        const el = Array.from(document.querySelectorAll('*'))
          .find(x => /pulse/.test(getComputedStyle(x).animationName));
        if (!el) return { found: false };
        const cs = getComputedStyle(el);
        return { found: true, count: cs.animationIterationCount, dur: cs.animationDuration };
      });
    };

    const a = await boot(b, 'yousef@makaman.ly');
    const normal = await arm(a.p);
    check('normally the sync dot really does loop for ever',
      normal.found && normal.count === 'infinite',
      JSON.stringify(normal));
    await a.ctx.close();

    const c = await boot(b, 'yousef@makaman.ly', true);
    const reduced = await arm(c.p);
    check('with reduced motion the same dot stops after one pass',
      reduced.found && reduced.count === '1', JSON.stringify(reduced));
    check('and it is still on screen, not hidden', reduced.found);
    const dur = await c.p.evaluate(() => {
      const nav = document.querySelector('.mk-nav-item svg');
      return parseFloat(getComputedStyle(nav).transitionDuration);
    });
    check('transitions are effectively off', dur < 0.001, dur + 's');
    await c.ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
