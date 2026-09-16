// Settings is a secondary page, not a takeover: the real appbar and a bottom nav must both
// stay reachable while it's open.
//
// 2026-09-16, owner's report: opening Settings made the bottom nav bar disappear (reported
// from the TechTest tile). Settings was a full-viewport fixed overlay (inset:0, z-index 50)
// that painted over the real appbar above it (sticky, z-index 30) and, for a technician,
// over the phone shell's own in-flow bottom nav underneath it — a fixed overlay covers
// whatever is spatially behind it once its own z-index wins, regardless of DOM order. The
// office view has the identical shape of bug: showDeskNav is fixed at z-index 40, also
// under Settings' z-index 50. This checks the actual paint order (elementFromPoint), not
// just that the elements exist in the DOM somewhere off-screen or behind the overlay.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(browser, email, viewport) {
  const p = await browser.newPage({ viewport });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1000);
  return p;
}

// True only if the element (or a descendant) is what actually paints at its own centre —
// i.e. nothing with a higher stacking order is sitting on top of it there.
const onTop = (p, selector) => p.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}, selector);

// There can legitimately be two DOM copies of a nav button while Settings is open — the
// underlying shell's own bar (now covered) and Settings' own footer copy (on top) — so this
// asks, per destination, whether AT LEAST ONE on-screen copy is actually reachable, not
// whether every copy in the DOM is.
const navButtonsOnTop = (p) => p.evaluate(() => {
  const labels = ['Tickets', 'Activity', 'Sync', 'Account'];
  const btns = Array.from(document.querySelectorAll('button')).filter(b => labels.includes(b.textContent.trim()));
  const perLabel = {};
  for (const label of labels) {
    perLabel[label] = btns.filter(b => b.textContent.trim() === label).some(b => {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === b || b.contains(hit));
    });
  }
  return { count: btns.length, allOnTop: labels.every(l => perLabel[l]), perLabel };
});

const openSettings = async (p) => {
  await p.getByText('Account', { exact: true }).first().click();
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: /Settings/i }).first().click();
  await p.waitForTimeout(400);
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── Technician: phone shell, in-flow (non-fixed) bottom nav ──
  {
    const p = await signIn(browser, 'yousef@makaman.ly', { width: 420, height: 850 });
    await openSettings(p);

    check('Settings is actually open', await p.locator('button.back-btn').count() > 0);
    check('the real appbar paints on top with Settings open (technician)',
      await onTop(p, '.mk-appbar'));

    const nav = await navButtonsOnTop(p);
    check('all four bottom-nav destinations paint on top with Settings open (technician)',
      nav.count >= 4 && nav.allOnTop, JSON.stringify(nav));

    // Tapping a destination while Settings is open both navigates and closes Settings —
    // not left stacked underneath it. A short timeout rather than the default 30s: on the
    // old, broken layout this button is genuinely covered and unclickable, which should
    // read here as a plain failed check, not a script-ending timeout crash.
    try {
      // Settings' own footer copy of this button sits earlier in the DOM than the phone
      // shell's now-covered original (Settings is rendered before showTechShell) — .first()
      // is the on-screen, on-top one; .last() would hit the covered original underneath.
      await p.getByRole('button', { name: /^Activity$/ }).first().click({ timeout: 4000 });
      await p.waitForTimeout(400);
      check('tapping a nav destination while Settings is open closes Settings',
        await p.locator('button.back-btn').count() === 0);
    } catch (e) {
      check('tapping a nav destination while Settings is open closes Settings', false, '(unclickable — covered by another element)');
    }
    await p.close();
  }

  // ── Office: desk shell, fixed-position bottom nav (showDeskNav) ──
  {
    const p = await signIn(browser, 'omar@makaman.ly', { width: 1300, height: 950 });
    await openSettings(p);

    check('Settings is actually open (office)', await p.locator('button.back-btn').count() > 0);
    check('the real appbar paints on top with Settings open (office)',
      await onTop(p, '.mk-appbar'));

    const nav = await navButtonsOnTop(p);
    check('all four bottom-nav destinations paint on top with Settings open (office)',
      nav.count >= 4 && nav.allOnTop, JSON.stringify(nav));
    await p.close();
  }

  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
