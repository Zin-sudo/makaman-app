// scrollToTop() fires on every real navigation — that part of task #85 was and is correct.
// What broke it: componentDidUpdate(prevProps, prevState) assumed prevState was usually
// there, missing only on the rare boot-time call. It never is. The runtime's own wrapper
// (support.js) declares componentDidUpdate(prevProps) and calls
// this.logic.componentDidUpdate(prevProps) — one argument, no prevState, ever. So
// `prevState || {}` was not a fallback for an edge case; it was the value on literally
// every update. {}.roleTab (undefined) never equals the screen's actual current roleTab,
// so every single update — including a keystroke that touches nothing but the field it
// was typed into — read as "the screen changed" and forced the scroll back to the top.
// Reported live: typing a password, or anything else, kept yanking the page upward.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const { makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const DB = makeDB();
assertStubParses(DB);

// Counts real calls to scrollToTop() rather than inferring intent from window.scrollY —
// jsdom-free but still headless, so an actual browser scroll assertion would depend on
// there being enough content to scroll in the first place. Counting the call itself is
// the direct measurement of the thing that broke: how many times the app DECIDED to
// reset the scroll position, regardless of whether there was anywhere to reset it from.
const armSpy = (p) => p.evaluate(() => {
  const app = window.__mkApp;
  app.__scrollCount = 0;
  const orig = app.scrollToTop.bind(app);
  app.scrollToTop = () => { app.__scrollCount += 1; orig(); };
});
const spyCount = (p) => p.evaluate(() => window.__mkApp.__scrollCount);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 940 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: STUB(DB) }));
  await p.addInitScript(() => {
    window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
    window.__DRAIN_TEST_MS = 120;
  });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill('yousef@makaman.ly'); await i.nth(1).fill('whatever');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1600);

  await armSpy(p);

  // ── Typing does not move the page ─────────────────────────────────────────
  {
    const search = p.locator('input[placeholder*="Search ticket"]');
    await search.click();
    await search.type('kuwait oil', { delay: 30 });
    await p.waitForTimeout(300);
    const n = await spyCount(p);
    check('typing several characters into a field does not reset the scroll',
      n === 0, n + ' call(s)');
    await search.fill('');
    await p.waitForTimeout(150);
  }

  // ── A real navigation still does ────────────────────────────────────────
  {
    await p.getByText('+ New Job Ticket', { exact: false }).click();
    await p.waitForTimeout(300);
    const n = await spyCount(p);
    check('opening the New Job Ticket screen still resets the scroll',
      n >= 1, n + ' call(s)');
  }

  // ── And typing on THAT screen doesn't move it again ───────────────────────
  {
    await armSpy(p);
    const customer = p.locator('input').first();
    await customer.click();
    await customer.type('Waha Oil Company', { delay: 20 });
    await p.waitForTimeout(300);
    const n = await spyCount(p);
    check('typing on the new-ticket form does not reset the scroll either',
      n === 0, n + ' call(s)');
  }

  // ── Switching screens again still fires it, proving the tracking isn't stuck ──
  {
    await p.getByRole('button', { name: /Cancel/i }).click();
    await p.waitForTimeout(300);
    const n = await spyCount(p);
    check('and leaving the form fires it again — tracking survives past the first navigation',
      n >= 1, n + ' call(s)');
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await ctx.close();
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
