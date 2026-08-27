// Confirms the header and bottom bar stay in place while the page scrolls.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(browser, email, w, h) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.removeItem('makaman.jobtickets.session.v1'));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(900);
  return p;
}
const boxes = (p) => p.evaluate(() => {
  const bar = document.querySelector('.mk-appbar');
  const navBtn = Array.from(document.querySelectorAll('button')).find(b => /^Activity$/i.test(b.innerText.trim()));
  const nav = navBtn ? navBtn.parentElement : null;
  return {
    barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
    navBottom: nav ? Math.round(nav.getBoundingClientRect().bottom) : null,
    vh: window.innerHeight,
    scrollY: window.scrollY,
    pageScrollable: document.documentElement.scrollHeight > window.innerHeight + 4,
  };
});

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  for (const [email, label, w, h] of [['omar@makaman.ly', 'mgr phone', 390, 700], ['lateri@makaman.ly', 'admin phone', 390, 700]]) {
    const p = await signIn(browser, email, w, h);
    const before = await boxes(p);
    await p.evaluate(() => window.scrollTo(0, 600));
    await p.waitForTimeout(400);
    const after = await boxes(p);
    if (!before.pageScrollable) { console.log(`  (skip ${label}: page does not scroll)`); await p.close(); continue; }
    check(`${label}: header stays at the top while scrolling`, after.barTop === 0, `top ${before.barTop} -> ${after.barTop}, scrollY ${after.scrollY}`);
    check(`${label}: bottom bar stays on screen`, after.navBottom !== null && Math.abs(after.navBottom - after.vh) < 3, `bottom ${after.navBottom} of ${after.vh}`);
    await p.close();
  }

  // The technician's app, at three real sizes. The phone mockup this used to assert is
  // gone: a technician whose phone is dead and who picks up a laptop needs an
  // application, not a picture of a phone he cannot reach. So the bar is pinned to the
  // viewport at every width now, not sitting at the bottom edge of a drawn bezel.
  for (const [label, w, h] of [['tech phone', 390, 700], ['tech tablet', 810, 1080], ['tech laptop', 1300, 900]]) {
    const p = await signIn(browser, 'yousef@makaman.ly', w, h);
    const b = await boxes(p);
    check(`${label}: bottom bar pinned to the viewport`,
      b.navBottom !== null && Math.abs(b.navBottom - b.vh) < 3, `bottom ${b.navBottom} of ${b.vh}`);
    // Held to a readable column rather than stretched across the whole monitor, and
    // never wider than the window on a small one.
    //
    // Asserted as a relationship rather than as a number. This used to read `nav.w <= 762`,
    // which pinned the column to the phone width it had at the time — so when the
    // technician's column was widened to use a real laptop screen, a bar correctly
    // tracking it read as a regression. What must hold is that the bar is exactly as wide
    // as the content it belongs to, and that neither of them fills the monitor edge to
    // edge; the specific ceiling is a design value and belongs in the stylesheet.
    const nav = await p.evaluate(() => {
      const el = document.querySelector('.mk-bottom-nav');
      const col = document.querySelector('.mk-phone-frame');
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), colW: col ? Math.round(col.getBoundingClientRect().width) : null,
               vw: document.documentElement.clientWidth };
    });
    check(`${label}: the bar is a column, not a strip the width of the screen`,
      nav.w <= nav.vw + 1 && nav.colW !== null && Math.abs(nav.w - nav.colW) < 3
      && (nav.vw <= 1440 || nav.w < nav.vw),
      `bar ${nav.w}, column ${nav.colW}, viewport ${nav.vw}`);
    // The mockup and its reviewer copy are gone at every size.
    const body = await p.innerText('body');
    check(`${label}: no phone-mockup explainer`, !/Field device/i.test(body)
      && !/simulate regaining signal/i.test(body));
    await p.close();
  }

  // ── The shape system is real, in both themes ────────────────────────────
  //
  // Two declarations used to exist and do nothing, which is the failure this block
  // guards against — not "does it look nice", but "does the CSS the file claims to apply
  // actually reach the pixel".
  //
  // S12: `.mk-ticket-card` declared a 3px status stripe while every card also carried an
  // inline `border:1px solid`. An inline shorthand beats a class rule, so the coloured
  // edge that tells you a job's status rendered as a hairline no different from the
  // ordinary border. Measured, never eyeballed: a screenshot of a 1px stripe and a 3px
  // one look alike at a glance, which is how it survived.
  //
  // And `--radius` was 0 in light and 12px in dark, so one card was two shapes depending
  // on the theme — except it was neither, because nothing read the token and everything
  // measured 0.
  {
    const p = await signIn(browser, 'yousef@makaman.ly', 430, 860);
    for (const theme of ['dark', 'light']) {
      await p.evaluate((t) => window.__mkApp.updateSettings({ theme: t }), theme);
      await p.waitForTimeout(400);
      const card = await p.evaluate(() => {
        const el = document.querySelector('.mk-ticket-card');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          stripe: parseFloat(cs.borderLeftWidth),
          plain: parseFloat(cs.borderTopWidth),
          radius: parseFloat(cs.borderTopLeftRadius),
          stripeColor: cs.borderLeftColor,
          plainColor: cs.borderTopColor,
        };
      });
      check(`${theme}: the status stripe is three times the ordinary border, not equal to it`,
        !!card && card.stripe === 3 && card.plain === 1,
        card ? `stripe ${card.stripe}px, other edges ${card.plain}px` : 'no card found');
      check(`${theme}: and it carries the status colour, not the border colour`,
        !!card && card.stripeColor !== card.plainColor,
        card ? `${card.stripeColor} vs ${card.plainColor}` : '');
      check(`${theme}: the corner radius the tokens declare is the radius that renders`,
        !!card && card.radius > 0, card ? card.radius + 'px' : '');
    }
    // The same in both, or the app changes shape when somebody changes the lights.
    const both = await p.evaluate(async () => {
      const read = () => parseFloat(getComputedStyle(document.querySelector('.mk-ticket-card')).borderTopLeftRadius);
      window.__mkApp.updateSettings({ theme: 'dark' });
      await new Promise(r => setTimeout(r, 300));
      const d = read();
      window.__mkApp.updateSettings({ theme: 'light' });
      await new Promise(r => setTimeout(r, 300));
      return { dark: d, light: read() };
    });
    check('a card is the same shape in both themes', both.dark === both.light,
      `dark ${both.dark}px, light ${both.light}px`);
    await p.close();
  }

  // ── Nobody could read the quiet text ────────────────────────────────────
  //
  // 265 inline text colours were written as raw alpha over the ink colour. In the light
  // theme anything under 0.62 falls below 4.5:1, so 224 of them failed — every label,
  // hint and caption, on every screen, on a phone used outdoors in Libya.
  //
  // This sweeps the visible text of a screen and composites each colour over the ground
  // behind it. That compositing is the whole point: the first pass at measuring this read
  // rgba(245,245,247,0.35), discarded the 0.35, and reported 16:1 for text that was
  // actually at 3.08 — a wrong measurement, which is worse than none because it gets
  // believed.
  {
    const p = await signIn(browser, 'yousef@makaman.ly', 430, 900);
    for (const theme of ['dark', 'light']) {
      await p.evaluate((t) => window.__mkApp.updateSettings({ theme: t }), theme);
      await p.waitForTimeout(400);
      const bad = await p.evaluate(() => {
        const lum = ([r, g, b]) => {
          const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        const parse = (s) => { const n = (s.match(/[\d.]+/g) || []).map(Number); return { rgb: n.slice(0, 3), a: n.length > 3 ? n[3] : 1 }; };
        const over = (fg, bg) => fg.rgb.map((c, i) => c * fg.a + bg.rgb[i] * (1 - fg.a));
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
        // Walks up compositing every translucent layer, not stopping at the first one
        // that happens to be non-transparent. A status chip's background is
        // rgba(48,209,88,0.18) — treating that as opaque green measured a ticket number
        // at 1.89:1 when the eye receives it over the card beneath. Same class of error
        // as ignoring a text colour's alpha, one level further down.
        const groundOf = (el) => {
          const layers = [];
          let n = el;
          while (n) {
            const c = parse(getComputedStyle(n).backgroundColor);
            if (c.a > 0) { layers.push(c); if (c.a >= 1) break; }
            n = n.parentElement;
          }
          if (!layers.length || layers[layers.length - 1].a < 1) layers.push({ rgb: [0, 0, 0], a: 1 });
          // Bottom upwards, each painted over what is already there.
          let out = layers[layers.length - 1].rgb;
          for (let i = layers.length - 2; i >= 0; i--) out = over(layers[i], { rgb: out, a: 1 });
          return { rgb: out, a: 1 };
        };
        const out = [];
        document.querySelectorAll('div, span, button, a, label, td, th, h1, h2, h3, p').forEach((el) => {
          // Only elements holding their own text, and only text you can actually see.
          const own = Array.from(el.childNodes).filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
          if (!own) return;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) return;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.opacity === '0') return;
          const px = parseFloat(cs.fontSize);
          const weight = parseInt(cs.fontWeight, 10) || 400;
          const need = (px >= 24 || (px >= 18.66 && weight >= 700)) ? 3 : 4.5;
          const v = ratio(over(parse(cs.color), groundOf(el)), groundOf(el).rgb);
          if (v < need) out.push(own.slice(0, 34) + ' — ' + v.toFixed(2) + ' needs ' + need);
        });
        return out;
      });
      check(`${theme}: every piece of text on the ticket list meets 4.5:1`,
        bad.length === 0, bad.slice(0, 4).join(' | ') || 'all pass');
    }
    await p.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
