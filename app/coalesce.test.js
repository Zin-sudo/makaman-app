// Offline, work must collapse rather than queue. A button pressed repeatedly while out
// of signal cannot become a burst of requests the moment signal returns.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 980 }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.__TOAST_TEST_MS = 20000; });
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1000);

  // ── the coalescer itself, exercised directly ────────────────────────────
  const r = await p.evaluate(async () => {
    const app = window.__mkApp;
    if (!app) return { missing: true };
    let started = 0, finished = 0;
    const slow = () => { started++; return new Promise(res => setTimeout(() => { finished++; res(); }, 120)); };
    // ten presses in a row, all while the first is still running
    const calls = [];
    for (let n = 0; n < 10; n++) calls.push(app.runLatest('probe', slow));
    await Promise.all(calls);
    await new Promise(res => setTimeout(res, 400));
    return { started, finished };
  });
  if (r.missing) {
    check('the app exposes itself for probing', false, 'window.__mkApp missing');
  } else {
    // one running + one queued survivor = 2, never 10
    check('ten rapid presses collapse to two runs, not ten', r.started === 2, `started ${r.started}`);
    check('and both finish cleanly', r.finished === r.started, `finished ${r.finished}`);
  }

  // ── a failing job must not re-arm itself ────────────────────────────────
  const f = await p.evaluate(async () => {
    const app = window.__mkApp;
    let runs = 0;
    const boom = () => { runs++; return Promise.reject(new Error('nope')); };
    for (let n = 0; n < 5; n++) { try { await app.runLatest('boom', boom); } catch (e) { /* expected */ } }
    await new Promise(res => setTimeout(res, 300));
    return runs;
  });
  check('a failure does not retry itself into a loop', f === 5, `${f} runs for 5 awaited calls`);

  // ── reports refuse to run without a connection ──────────────────────────
  await ctx.setOffline(true);
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(700);
  await p.getByRole('button', { name: /Generate bundle/i }).click();
  await p.waitForTimeout(500);
  let body = await p.innerText('body');
  check('the bundle refuses while offline', /Reports need a connection/i.test(body));

  // hammering it offline leaves one banner, not a stack
  for (let n = 0; n < 6; n++) { await p.getByRole('button', { name: /Generate bundle/i }).click(); await p.waitForTimeout(70); }
  check('and hammering it leaves one banner, not six', await p.locator('.mk-toast').count() === 1,
    `${await p.locator('.mk-toast').count()} banners`);

  const zipBtn = p.locator('button', { hasText: /^ZIP$/ }).first();
  if (await zipBtn.count()) {
    await zipBtn.click();
    await p.waitForTimeout(400);
    check('a per-ticket download refuses too', /Reports need a connection/i.test(await p.innerText('body')));
  }

  // ── and works again once connected ──────────────────────────────────────
  await ctx.setOffline(false);
  await p.waitForTimeout(500);
  const dl = p.waitForEvent('download', { timeout: 25000 });
  await p.getByRole('button', { name: /Generate bundle/i }).click();
  const d = await dl;
  check('reconnecting lets the report run', !!d.suggestedFilename(), d.suggestedFilename());

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
