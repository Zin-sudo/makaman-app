// 2026-09-10, owner's request: "hook it to the auto refresh that happens when the user
// gets back to the browser or to the home-screen app... this way the location ping of the
// user is updated for the rest of the team to see on Field Devices... no need for a
// periodic spam simply on the auto refresh or manual refresh (but the manual should only
// trigger once if the button is spammed... a time interval per trigger should be
// established)."
//
// Three real triggers — netListener ('online'), visListener (visibilitychange), and the
// manual Force Refresh button (refreshCurrentTab) — all route through the one shared,
// throttled refreshGeoPing(). Driven here by calling those handlers directly (the same way
// geo.test.js already drives geoLogPing directly), since none of the three real browser
// events involved (visibilitychange, online, a click already covered by its own button
// tests) can be dispatched genuinely in a headless context the way GPS itself can be mocked.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
const A = { latitude: 32.887209, longitude: 13.191338, accuracy: 12 };
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function boot(ctx, email, throttleMs) {
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript((ms) => {
    window.MAKAMAN_CONFIG = { authMode: 'local' };
    if (ms) window.__GEO_REFRESH_PING_TEST_MS = ms;
    window.__geoCalls = 0;
    const orig = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = function (ok, err, opts) {
      window.__geoCalls++;
      return orig(ok, err, opts);
    };
  }, throttleMs);
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1200);
  return p;
}
const geoCalls = (p) => p.evaluate(() => window.__geoCalls);
const curFixOf = (p, id) => p.evaluate((tid) => {
  const t = (window.__mkApp.state.data.tickets || []).find(x => x.id === tid);
  return t && t.geo ? t.geo.last : null;
}, id);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── The three triggers, throttled together — window sized so the "still inside it"
  // checks and the "well past it" check cannot be muddled by the fix's own settle time ──
  {
    const ctx = await b.newContext({ permissions: ['geolocation'], geolocation: A });
    const THROTTLE_MS = 3000;
    const p = await boot(ctx, 'yousef@makaman.ly', THROTTLE_MS);
    // t3 is Yousef's own open (logging) ticket in the seed data.
    const before = await geoCalls(p);

    await p.evaluate(() => window.__mkApp.visListener());
    await p.waitForTimeout(500);
    check('returning to the tab (visibilitychange) asks the GPS once',
      (await geoCalls(p)) - before === 1, `${before} -> ${await geoCalls(p)}`);
    check('and Latest/Current Location is actually recorded',
      !!(await curFixOf(p, 't3')), JSON.stringify(await curFixOf(p, 't3')));

    const afterFirst = await geoCalls(p);
    await p.evaluate(() => window.__mkApp.netListener());
    await p.waitForTimeout(300);
    check('reconnecting (\'online\') right after does NOT ask again — inside the throttle window',
      (await geoCalls(p)) === afterFirst, `${afterFirst} -> ${await geoCalls(p)}`);

    // Force Refresh, still well inside the window — also throttled, not a separate budget.
    await p.evaluate(() => window.__mkApp.refreshCurrentTab());
    await p.waitForTimeout(300);
    check('the manual Force Refresh button shares the same throttle, not its own',
      (await geoCalls(p)) === afterFirst, `${afterFirst} -> ${await geoCalls(p)}`);

    // Past the window (only ~1.1s of the 3s has elapsed above) — the next refresh asks again.
    await p.waitForTimeout(THROTTLE_MS);
    await p.evaluate(() => window.__mkApp.visListener());
    await p.waitForTimeout(500);
    check('once the interval has actually passed, the next refresh asks again',
      (await geoCalls(p)) - afterFirst === 1, `${afterFirst} -> ${await geoCalls(p)}`);
    await ctx.close();
  }

  // ── Spamming the manual button is exactly the case named in the request ─────────────
  {
    const ctx = await b.newContext({ permissions: ['geolocation'], geolocation: A });
    const p = await boot(ctx, 'yousef@makaman.ly', 5 * 60 * 1000); // realistic-scale window
    const before = await geoCalls(p);
    // Ten rapid presses. refreshCurrentTab's own refreshBusy guard already absorbs most of
    // these; refreshGeoPing's own throttle is what stops the ones that get through from
    // becoming ten GPS requests instead of one.
    for (let i = 0; i < 10; i++) {
      await p.evaluate(() => window.__mkApp.refreshCurrentTab());
    }
    await p.waitForTimeout(600);
    check('ten presses in a burst produce exactly one GPS request, not ten',
      (await geoCalls(p)) - before === 1, `${before} -> ${await geoCalls(p)}`);
    await ctx.close();
  }

  // ── A technician with no open job: refresh is a plain no-op, not an error ───────────
  {
    const ctx = await b.newContext({ permissions: ['geolocation'], geolocation: A });
    const p = await boot(ctx, 'yousef@makaman.ly', 400);
    await p.evaluate(() => {
      window.__mkApp.mutate(d => { d.tickets.find(t => t.id === 't3').status = 'done'; });
    });
    await p.waitForTimeout(300);
    const before = await geoCalls(p);
    await p.evaluate(() => window.__mkApp.visListener());
    await p.waitForTimeout(400);
    check('no open job to ping for — nothing asks the GPS, and nothing throws',
      (await geoCalls(p)) === before, `${before} -> ${await geoCalls(p)}`);
    await ctx.close();
  }

  // ── The office is not a location to report — refresh never pings for them ──────────
  {
    const ctx = await b.newContext({ permissions: ['geolocation'], geolocation: A });
    const p = await boot(ctx, 'omar@makaman.ly', 400);
    const before = await geoCalls(p);
    await p.evaluate(() => window.__mkApp.visListener());
    await p.evaluate(() => window.__mkApp.netListener());
    await p.evaluate(() => window.__mkApp.refreshCurrentTab());
    await p.waitForTimeout(500);
    check('the office role never triggers a GPS request off any of the three',
      (await geoCalls(p)) === before, `${before} -> ${await geoCalls(p)}`);
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
