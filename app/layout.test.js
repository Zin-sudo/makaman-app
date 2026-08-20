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

  // technician, inside the phone mockup at desktop width, and full-bleed on a phone
  let p = await signIn(browser, 'yousef@makaman.ly', 390, 700);
  let b = await boxes(p);
  check('tech phone: bottom bar pinned to the viewport', b.navBottom !== null && Math.abs(b.navBottom - b.vh) < 3, `bottom ${b.navBottom} of ${b.vh}`);
  await p.close();

  p = await signIn(browser, 'yousef@makaman.ly', 1300, 900);
  b = await boxes(p);
  check('tech desktop: bottom bar sits inside the mockup, not pinned to the window',
    b.navBottom !== null && b.navBottom < b.vh - 5, `bottom ${b.navBottom} of ${b.vh}`);
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
