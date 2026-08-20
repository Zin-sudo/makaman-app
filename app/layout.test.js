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
    const nav = await p.evaluate(() => {
      const el = document.querySelector('.mk-bottom-nav');
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), vw: document.documentElement.clientWidth };
    });
    check(`${label}: the bar is a column, not a strip the width of the screen`,
      nav.w <= 762 && nav.w <= nav.vw + 1, `${nav.w} of ${nav.vw}`);
    // The mockup and its reviewer copy are gone at every size.
    const body = await p.innerText('body');
    check(`${label}: no phone-mockup explainer`, !/Field device/i.test(body)
      && !/simulate regaining signal/i.test(body));
    await p.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
