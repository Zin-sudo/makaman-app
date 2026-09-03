// Drives the real geolocation flow against a mocked GPS.
const { chromium } = require('playwright-core');
const OUT = '/tmp/claude-0/-home-user-makaman-app/d91117f5-d40f-52d2-8052-784fa32d1e1b/scratchpad';
const URL = 'http://localhost:8934/index.html';
const A = { latitude: 32.887209, longitude: 13.191338, accuracy: 12 };
const B = { latitude: 32.901544, longitude: 13.205871, accuracy: 9 };
const C = { latitude: 33.500000, longitude: 14.500000, accuracy: 5 };

const PING = 2500, TICK = 500;
let pass = 0, fail = 0;
const check = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   ' + extra : '')); };

async function boot(ctx, errs) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });
  await page.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await page.addInitScript(([p, t]) => {
    window.__GEO_PING_TEST_MS = p;
    window.__GEO_TICK_TEST_MS = t;
    // Count every request the app makes to the GPS, so ping-rate can be asserted
    // rather than inferred from whether the stored value happened to change.
    window.__geoCalls = 0;
    const orig = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = function (ok, err, opts) {
      window.__geoCalls++;
      return orig(ok, err, opts);
    };
  }, [PING, TICK]);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.evaluate(() => localStorage.removeItem('makaman.jobtickets.session.v1'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  return page;
}
async function login(page, email) {
  const i = page.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForTimeout(900);
}
const geoOf = (page) => page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || '{}');
  const t = (d.tickets || []).filter(x => x.geo).pop();
  return t ? { id: t.id, status: t.status, geo: t.geo } : null;
});

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 430, height: 950 }, permissions: ['geolocation'], geolocation: A });

  let page = await boot(ctx, errs);
  await login(page, 'yousef@makaman.ly');
  await page.getByRole('button', { name: /New Job Ticket/i }).click();
  await page.waitForTimeout(400);
  await page.locator('select').first().selectOption({ index: 1 });
  // Field / Well / Rig. The customer is a <select>, chosen above, so these are the
  // only three inputs on the screen — nth(3) is off the end of the form.
  await page.locator('input').nth(0).fill('Test Field');
  await page.locator('input').nth(1).fill('TG-1');
  await page.locator('input').nth(2).fill('RIG-9');
  await page.getByRole('button', { name: /Start Logging/i }).click();
  await page.waitForTimeout(1500);

  let g = await geoOf(page);
  check('opening fix recorded', !!(g && g.geo.open),
    g && g.geo.open ? `lat ${g.geo.open.lat.toFixed(4)} lon ${g.geo.open.lon.toFixed(4)}` : '');
  const openTs = g.geo.open.ts, id = g.id;

  // move the device, let a couple of ping windows elapse
  await ctx.setGeolocation(B);
  await page.waitForTimeout(PING * 2 + 1200);
  g = await geoOf(page);
  check('periodic fix follows the device', g.geo.last.lat.toFixed(4) === B.latitude.toFixed(4),
    `last lat ${g.geo.last.lat.toFixed(4)}`);
  check('opening fix never rewritten', g.geo.open.ts === openTs && g.geo.open.lat.toFixed(4) === A.latitude.toFixed(4));
  check('keeps only open+last, no breadcrumb trail',
    Object.keys(g.geo).sort().join(',') === 'last,open,pingedAt', Object.keys(g.geo).sort().join(','));

  // ping rate: over a fixed window, calls must track the ping interval, not the tick
  const before = await page.evaluate(() => window.__geoCalls);
  const WINDOW = PING * 4;
  await page.waitForTimeout(WINDOW);
  const after = await page.evaluate(() => window.__geoCalls);
  const calls = after - before;
  const ceiling = Math.ceil(WINDOW / PING) + 1;      // allow one boundary straddle
  const tickRate = Math.floor(WINDOW / TICK);         // what unthrottled would look like
  check('ping rate throttled to the interval, not the tick',
    calls <= ceiling && calls < tickRate / 2, `${calls} calls in ${WINDOW}ms (ceiling ${ceiling}, unthrottled would be ~${tickRate})`);

  // Job Done stops it
  await page.getByRole('button', { name: /^Job done$/i }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Yes, job done/i }).click();
  await page.waitForTimeout(700);
  g = await geoOf(page);
  check('ticket marked done', g.status === 'done', `status=${g.status}`);
  const frozen = JSON.stringify(g.geo.last);
  await ctx.setGeolocation(C);
  await page.waitForTimeout(PING * 3);
  g = await geoOf(page);
  // Asserted on this ticket only: the seed leaves another ticket of the same
  // technician's still being logged, and that one is *supposed* to keep pinging.
  check('done ticket stops recording', JSON.stringify(g.geo.last) === frozen,
    g.geo.last.lat.toFixed(4) === C.latitude.toFixed(4) ? 'followed device after done!' : 'unchanged');

  // The office's record of where the ticket was worked is still the office's, and it
  // stays off the technician's own ticket view.
  // innerText, not textContent: the x-dc template lives inside <body>, so textContent
  // hands back the markup for every screen including the office panel this is asserting
  // is absent — it would pass or fail on source code rather than on what is rendered.
  const techBody = await page.innerText('body');
  check('the office position panel stays out of the technician\'s ticket view',
    !/Device position|Opening fix|Last fix/i.test(techBody));
  await page.screenshot({ path: OUT + '/60-tech.png' });
  await page.close();

  // ---- office roles ----
  for (const [email, who] of [['omar@makaman.ly', 'ops manager'], ['founder@makaman.ly', 'observer']]) {
    page = await boot(ctx, errs);
    await page.setViewportSize({ width: 1300, height: 980 });
    // The inbox only lists synced tickets. Mark them up, then reload — the app reads
    // localStorage once at construction, so a write after boot would not be seen.
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
      d.tickets.forEach(t => { t.synced = true; t.syncedAt = new Date().toISOString(); });
      localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await login(page, email);
    if (who === 'ops manager') {
      // Pick the row for the ticket this test created (Test Field / TG-1), not
      // whichever seeded ticket happens to sort first.
      const row = page.locator('tr', { hasText: 'TG-1' }).first();
      const btn = row.getByRole('button', { name: /^(Review|View)$/i }).first();
      await btn.click(); await page.waitForTimeout(900);
      const body = await page.textContent('body');
      check(`${who}: sees position panel`, /Device position/.test(body));
      check(`${who}: sees opening fix`, /When opened/.test(body) && /32\.887209/.test(body));
      check(`${who}: sees last fix before Job Done`, /Last position before Job Done/.test(body) && /32\.901544/.test(body));
      await page.screenshot({ path: OUT + '/61-mgr.png' });
    }
    await page.close();
  }

  // ---- an unanswered permission prompt does not disable location forever ----
  //
  // A bare context with geolocation never explicitly granted or denied does not make
  // getCurrentPosition's error callback fire — it never resolves at all, discovered
  // live while writing this: geoBusy stayed stuck true from the very first attempt,
  // before this test ever touched anything. That is a real, worse-than-denial failure
  // mode (nothing to reset — geoDenied is never even set) and exactly the shape of a
  // Save-to-Home-Screen PWA's least reliable moment, where the standalone permission
  // broker has a real history of never resolving the session's first request at all.
  // geoFix's own backstop (GEO_FIX_BACKSTOP_MS) is what turns that into an ordinary,
  // recoverable failure instead of a permanent one.
  {
    const deniedCtx = await browser.newContext({ viewport: { width: 430, height: 950 } });
    const dpage = await boot(deniedCtx, errs);
    // Sped up for the test; stacks on top of boot()'s own init script and takes effect
    // on the reload below, same pattern bootrace.test.js uses for its own slow-restore hook.
    await dpage.addInitScript(() => { window.__GEO_BACKSTOP_TEST_MS = 700; });
    await dpage.reload({ waitUntil: 'networkidle' });
    await dpage.waitForTimeout(600);
    await login(dpage, 'yousef@makaman.ly');
    await dpage.getByRole('button', { name: /New Job Ticket/i }).click();
    await dpage.waitForTimeout(400);
    await dpage.locator('select').first().selectOption({ index: 1 });
    await dpage.locator('input').nth(0).fill('DeniedFld');
    await dpage.locator('input').nth(1).fill('DN-1');
    await dpage.locator('input').nth(2).fill('RIG-D');
    await dpage.getByRole('button', { name: /Start Logging/i }).click();
    // The opening attempt's own getCurrentPosition never answers in this context; only
    // the backstop timer (700ms, sped up) frees it, which is the thing under test.
    await dpage.waitForTimeout(1200);

    let dg = await geoOf(dpage);
    check('an unanswered permission prompt leaves the ticket with no geo.open, not a hang',
      !(dg && dg.geo && dg.geo.open), JSON.stringify(dg));
    // geoTick's own periodic retry (still due — nothing has landed yet) means geoBusy
    // cycles true/false roughly every backstop interval rather than settling once, so
    // this polls for a free moment instead of sampling a single instant that could land
    // on either side of that cycle.
    let everFree = false;
    for (let i = 0; i < 6 && !everFree; i++) {
      everFree = (await dpage.evaluate(() => window.__mkApp.geoBusy)) === false;
      if (!everFree) await dpage.waitForTimeout(200);
    }
    check('and the backstop actually releases geoBusy rather than leaving it stuck', everFree);

    // Backdate the arrival past the missing-pin threshold instead of waiting 20 real
    // seconds — the binding only reads the elapsed time, not the wall clock it ran on.
    await dpage.evaluate(() => {
      window.__mkApp.mutate((d) => {
        const t = d.tickets.find((x) => x.field === 'DeniedFld');
        t.arrival = new Date(Date.now() - 25000).toISOString();
      });
    });
    await dpage.waitForTimeout(300);
    const retryBtn = dpage.getByRole('button', { name: /Well location not captured/i });
    check('the missing pin is surfaced on the ticket itself, with a retry action',
      await retryBtn.isVisible());

    // Standing in for the moment a real technician taps Allow on the prompt the retry
    // itself provokes — a resolved position handed straight to the callback the app
    // itself registered, the same technique this file already uses to count calls.
    await dpage.evaluate(([lat, lon]) => {
      navigator.geolocation.getCurrentPosition = function (ok) {
        ok({ coords: { latitude: lat, longitude: lon, accuracy: 10 }, timestamp: Date.now() });
      };
    }, [A.latitude, A.longitude]);
    // geoTick's own periodic retry is still due and can be mid-flight (on the old
    // hanging behaviour, with its own backstop still counting down) at the instant this
    // clicks — wait for a free moment first so the click's own call is the one that
    // actually reaches getCurrentPosition, now that the stub answers instantly.
    for (let i = 0; i < 6; i++) {
      if ((await dpage.evaluate(() => window.__mkApp.geoBusy)) === false) break;
      await dpage.waitForTimeout(200);
    }
    await retryBtn.click();
    await dpage.waitForTimeout(800);
    dg = await geoOf(dpage);
    check('tapping the retry pins the well location once permission is actually granted',
      !!(dg && dg.geo && dg.geo.open), JSON.stringify(dg && dg.geo));
    check('and the missing-pin line clears once it lands',
      !(await retryBtn.isVisible().catch(() => false)));

    await dpage.close();
    await deniedCtx.close();
  }

  // ---- consent toggle honoured ----
  page = await boot(ctx, errs);
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    d.settings = Object.assign({}, d.settings, { shareLocation: false });
    d.tickets = [];
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await login(page, 'yousef@makaman.ly');
  await page.getByRole('button', { name: /New Job Ticket/i }).click();
  await page.waitForTimeout(400);
  await page.locator('select').first().selectOption({ index: 1 });
  await page.locator('input').nth(0).fill('X'); await page.locator('input').nth(1).fill('Y'); await page.locator('input').nth(2).fill('Z');
  await page.getByRole('button', { name: /Start Logging/i }).click();
  await page.waitForTimeout(PING * 2);
  const offCalls = await page.evaluate(() => window.__geoCalls);
  const offGeo = await geoOf(page);
  // The rule the toggle enforces: "never tell the office", not "never ask the GPS" —
  // it must not put a fix on a ticket, where it would sync, even while it is off.
  check('sharing off: nothing lands on the ticket', !offGeo, JSON.stringify(offGeo));
  const stored = await page.evaluate(() => localStorage.getItem('makaman.jobtickets.v2') || '');
  check('sharing off: no coordinate is written to the store at all',
    !/"lat"\s*:/.test(stored), '(gps calls=' + offCalls + ')');
  await page.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length ? JSON.stringify(errs, null, 1) : 'none');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
