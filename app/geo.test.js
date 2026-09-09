// Drives the real geolocation flow against a mocked GPS.
const { chromium } = require('playwright-core');
const OUT = '/tmp/claude-0/-home-user-makaman-app/d91117f5-d40f-52d2-8052-784fa32d1e1b/scratchpad';
const URL = 'http://localhost:8934/index.html';
const A = { latitude: 32.887209, longitude: 13.191338, accuracy: 12 };
const B = { latitude: 32.901544, longitude: 13.205871, accuracy: 9 };
const C = { latitude: 32.914477, longitude: 13.219903, accuracy: 6 };

let pass = 0, fail = 0;
const check = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (extra ? '   ' + extra : '')); };

async function boot(ctx, errs) {
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });
  await page.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await page.addInitScript(() => {
    // Count every request the app makes to the GPS, so a log line can be proven to be
    // exactly what asks for one — not a timer, not a keystroke, not the render that
    // follows it.
    window.__geoCalls = 0;
    const orig = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = function (ok, err, opts) {
      window.__geoCalls++;
      return orig(ok, err, opts);
    };
  });
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
// The one real trigger under test: write a line, tap the log button, wait for the fake
// GPS round trip and the mutate()+render it drives. By placeholder, not `textarea`
// alone — every existing line gets its own editable textarea (see the log screen's
// per-line edit box), so once a first line exists it is no longer the only one on
// screen, and `.first()` would land on an existing line's box instead of a fresh one.
async function logLine(page, text) {
  await page.getByPlaceholder(/Describe the event as it happens/i).fill(text);
  await page.getByRole('button', { name: /^Log line/i }).click();
  await page.waitForTimeout(600);
}

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

  // ── The re-pin is now a log line, not a clock (2026-09-09, owner's request) ─────────
  await ctx.setGeolocation(B);
  const beforeWait = await page.evaluate(() => window.__geoCalls);
  await page.waitForTimeout(1500);
  const afterWait = await page.evaluate(() => window.__geoCalls);
  check('nothing asks the GPS merely because time passed — no timer left to fire',
    afterWait === beforeWait, `${beforeWait} -> ${afterWait}`);

  await logLine(page, 'Rigging up, function testing surface equipment.');
  g = await geoOf(page);
  check('writing a log line captures the device\'s current position',
    g.geo.last.lat.toFixed(4) === B.latitude.toFixed(4), `last lat ${g.geo.last.lat.toFixed(4)}`);
  check('opening fix never rewritten', g.geo.open.ts === openTs && g.geo.open.lat.toFixed(4) === A.latitude.toFixed(4));
  check('keeps only open+last, no breadcrumb trail',
    Object.keys(g.geo).sort().join(',') === 'last,open,pingedAt', Object.keys(g.geo).sort().join(','));
  const afterOneLine = await page.evaluate(() => window.__geoCalls);
  check('exactly one GPS call for the one log line, not a burst',
    afterOneLine - afterWait === 1, `${afterWait} -> ${afterOneLine}`);

  await ctx.setGeolocation(C);
  await logLine(page, 'Circulating bottoms up.');
  g = await geoOf(page);
  check('a second log line asks again and replaces the fix, not appends to it',
    g.geo.last.lat.toFixed(4) === C.latitude.toFixed(4)
    && Object.keys(g.geo).sort().join(',') === 'last,open,pingedAt');
  const afterTwoLines = await page.evaluate(() => window.__geoCalls);
  check('one GPS call per line — two lines, two calls, not more',
    afterTwoLines - afterOneLine === 1, `${afterOneLine} -> ${afterTwoLines}`);

  // Job Done stops it
  await page.getByRole('button', { name: /^Job done$/i }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Yes, job done/i }).click();
  await page.waitForTimeout(700);
  g = await geoOf(page);
  check('ticket marked done', g.status === 'done', `status=${g.status}`);
  const frozen = JSON.stringify(g.geo.last);
  await ctx.setGeolocation(A);
  // The log-line UI is gone once a job is done, so nothing in the app can call this any
  // more in the ordinary run of things — called directly here to prove the function's OWN
  // guard holds, not merely that the button that used to trigger it is out of reach.
  await page.evaluate((tid) => window.__mkApp.geoLogPing(tid), id);
  await page.waitForTimeout(500);
  g = await geoOf(page);
  check('a done ticket cannot be pinged any more, even called directly',
    JSON.stringify(g.geo.last) === frozen);

  // The office's record of where the ticket was worked is still the office's, and it
  // stays off the technician's own ticket view.
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
      // 2026-09-09: ops/admin gained location.edit, so the fix now renders as an
      // editable input (pre-filled with the value) rather than plain text — its value
      // never shows up in textContent/innerText, an input's value is not a text node.
      // Read both: the label as page text, the coordinate from whichever the role sees.
      const coords = await page.evaluate(() => Array.from(document.querySelectorAll('input'))
        .map(i => i.value).join(' | '));
      check(`${who}: sees position panel`, /Device position/.test(body));
      check(`${who}: sees opening fix`,
        /When opened/.test(body) && (/32\.887209/.test(body) || /32\.887209/.test(coords)));
      check(`${who}: sees last fix before Job Done`,
        /Last position before Job Done/.test(body) && (/32\.914477/.test(body) || /32\.914477/.test(coords)));
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
    // No periodic retry exists any more to keep re-triggering this in the background
    // (see geoLogPing) — one attempt, one backstop, one settled state.
    await dpage.waitForTimeout(300);
    check('and the backstop actually releases geoBusy rather than leaving it stuck',
      (await dpage.evaluate(() => window.__mkApp.geoBusy)) === false);

    // Backdate the arrival past the missing-pin threshold instead of waiting 20 real
    // seconds — the binding only reads the elapsed time, not the wall clock it ran on.
    await dpage.evaluate(() => {
      window.__mkApp.mutate((d) => {
        const t = d.tickets.find((x) => x.field === 'DeniedFld');
        t.arrival = new Date(Date.now() - 25000).toISOString();
      });
    });
    await dpage.waitForTimeout(300);
    // Capture Now / Ask Again Later, then Are you here? / YES / NOT YET — the missing
    // pin is no longer one button, it is a message plus a two-step choice, so nothing
    // captures on the first tap any more.
    const missingMsg = dpage.getByText(/Well location not captured/i);
    check('the missing pin is surfaced on the ticket itself, with a way to act on it',
      await missingMsg.isVisible());
    const captureNowBtn = dpage.getByRole('button', { name: 'CAPTURE NOW' });
    const yesBtn = dpage.getByRole('button', { name: 'YES' });

    // Standing in for the moment a real technician taps Allow on the prompt YES
    // provokes — a resolved position handed straight to the callback the app itself
    // registered, the same technique this file already uses to count calls.
    await dpage.evaluate(([lat, lon]) => {
      navigator.geolocation.getCurrentPosition = function (ok) {
        ok({ coords: { latitude: lat, longitude: lon, accuracy: 10 }, timestamp: Date.now() });
      };
    }, [A.latitude, A.longitude]);
    await captureNowBtn.click();
    await dpage.waitForTimeout(200);
    check('Capture Now turns the message into a direct question',
      await dpage.getByText(/Are you in the well location right now/i).isVisible());
    await yesBtn.click();
    await dpage.waitForTimeout(800);
    dg = await geoOf(dpage);
    check('tapping YES pins the well location once permission is actually granted',
      !!(dg && dg.geo && dg.geo.open), JSON.stringify(dg && dg.geo));
    check('and the missing-pin line clears once it lands',
      !(await missingMsg.isVisible().catch(() => false)));

    await dpage.close();
    await deniedCtx.close();
  }

  // ---- a genuine platform denial stops offering a retry that cannot work ----
  //
  // Reported live: "tap to try again" kept reappearing with no way through it, on both
  // a browser tab and the Save-to-Home-Screen app. Once the browser's OWN permission
  // state is denied, nothing in JS can make it prompt again — the FIRST refusal is kept
  // as an ordinary retry (this project's own history says a session's first call can
  // come back denied before anyone saw a prompt at all), but a SECOND refusal, on a call
  // the person themselves asked for by tapping retry, is trusted as real and the message
  // has to stop suggesting a tap will fix it.
  for (const standalone of [false, true]) {
    const who = standalone ? 'the installed app' : 'a browser tab';
    const dCtx = await browser.newContext({ viewport: { width: 430, height: 950 } });
    const dpage = await boot(dCtx, errs);
    await dpage.addInitScript((sa) => {
      if (sa) {
        try { Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true }); } catch (e) {}
        const origMM = window.matchMedia ? window.matchMedia.bind(window) : null;
        window.matchMedia = (q) => {
          if (/display-mode:\s*standalone/.test(q)) return { matches: true, media: q };
          return origMM ? origMM(q) : { matches: false, media: q };
        };
      }
      // Denies immediately, the way a browser with the permission already switched off
      // actually behaves — no delay, no prompt, straight to the error callback.
      navigator.geolocation.getCurrentPosition = function (ok, err) {
        err({ code: 1, message: 'User denied Geolocation' });
      };
    }, standalone);
    await dpage.reload({ waitUntil: 'networkidle' });
    await dpage.waitForTimeout(600);
    await login(dpage, 'yousef@makaman.ly');
    await dpage.getByRole('button', { name: /New Job Ticket/i }).click();
    await dpage.waitForTimeout(400);
    await dpage.locator('select').first().selectOption({ index: 1 });
    await dpage.locator('input').nth(0).fill('BlockedFld');
    await dpage.locator('input').nth(1).fill('BK-1');
    await dpage.locator('input').nth(2).fill('RIG-B');
    await dpage.getByRole('button', { name: /Start Logging/i }).click();
    await dpage.waitForTimeout(500);

    await dpage.evaluate(() => {
      window.__mkApp.mutate((d) => {
        const t = d.tickets.find((x) => x.field === 'BlockedFld');
        t.arrival = new Date(Date.now() - 25000).toISOString();
      });
    });
    await dpage.waitForTimeout(300);
    const firstDenialMsg = dpage.getByText(/Well location not captured/i);
    check(`${who}: a first, automatic denial is still offered as an ordinary retry`,
      await firstDenialMsg.isVisible());

    // Capture Now, then YES, is what actually fires the real geolocation call now — the
    // one this context stubs to deny immediately.
    await dpage.getByRole('button', { name: 'CAPTURE NOW' }).click();
    await dpage.waitForTimeout(200);
    await dpage.getByRole('button', { name: 'YES' }).click();
    const blocked = dpage.getByText(/Location is blocked/i);
    // The state change is a real setState round trip (geoFix's error callback, then a
    // re-render), not instant — waits for the actual DOM change rather than a fixed
    // sleep guessed to be long enough, which is what made this flaky the first time.
    await blocked.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    check(`${who}: a second denial, on the tap the person made themselves, is not offered as a retry any more`,
      !(await dpage.getByText(/Well location not captured/i).isVisible().catch(() => false)));
    check(`${who}: it explains the block instead`, await blocked.isVisible().catch(() => false));
    const said = await blocked.textContent().catch(() => '');
    check(`${who}: and points at the right place to fix it`,
      standalone ? /below the regular apps/.test(said) : /Settings for Websites|address bar/.test(said),
      said);

    await dpage.close();
    await dCtx.close();
  }

  // ---- consent toggle honoured — for the opening pin AND the per-line one ----
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
  await page.waitForTimeout(600);
  // Master off silences the log-line ping too — it is a refinement of this switch, not
  // a second consent, so writing a line must not reach the GPS either.
  await logLine(page, 'Testing with location sharing off.');
  const offCalls = await page.evaluate(() => window.__geoCalls);
  const offGeo = await geoOf(page);
  // The rule the toggle enforces: "never tell the office", not "never ask the GPS" —
  // it must not put a fix on a ticket, where it would sync, even while it is off.
  check('sharing off: nothing lands on the ticket, opening pin or log line alike',
    !offGeo, JSON.stringify(offGeo));
  const stored = await page.evaluate(() => localStorage.getItem('makaman.jobtickets.v2') || '');
  check('sharing off: no coordinate is written to the store at all',
    !/"lat"\s*:/.test(stored), '(gps calls=' + offCalls + ')');
  await page.close();

  // ---- the per-line switch is a refinement of Arrival location, not a second consent ----
  //
  // 2026-09-09, owner's request: the two switches that used to be one ("Share my
  // position") merged into "Arrival location" on the Account tab, plus this second one
  // governing whether each log line also refreshes the position. Off, with Arrival
  // location still on: the opening pin still fires, but a log line must not move it.
  {
    page = await boot(ctx, errs);
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
      d.settings = Object.assign({}, d.settings, { shareLocation: true, periodicLocation: false });
      d.tickets = [];
      localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await login(page, 'yousef@makaman.ly');
    await page.getByRole('button', { name: /New Job Ticket/i }).click();
    await page.waitForTimeout(400);
    await page.locator('select').first().selectOption({ index: 1 });
    await page.locator('input').nth(0).fill('SplitFld');
    await page.locator('input').nth(1).fill('SP-1');
    await page.locator('input').nth(2).fill('RIG-S');
    await page.getByRole('button', { name: /Start Logging/i }).click();
    await page.waitForTimeout(1200);

    g = await geoOf(page);
    check('Arrival location alone still captures the opening pin', !!(g && g.geo.open));

    await ctx.setGeolocation(B);
    await logLine(page, 'Line while the per-line switch is off.');
    g = await geoOf(page);
    check('but a log line does not move the position while the per-line switch is off',
      g.geo.last.lat.toFixed(4) === A.latitude.toFixed(4), `last lat ${g.geo.last.lat.toFixed(4)}`);

    // updateSettings is the real instance method the Account tab's switch itself calls
    // (see togglePeriodicLocation in the render output) — this exercises the same write
    // path without needing to navigate to Account and back mid-ticket. The switch's own
    // presence and wiring in the DOM is covered separately, in roles.test.js.
    await page.evaluate(() => window.__mkApp.updateSettings({ periodicLocation: true }));
    await page.waitForTimeout(200);
    await logLine(page, 'Line after turning the per-line switch on.');
    g = await geoOf(page);
    check('turning the per-line switch on lets the next log line move the position',
      g.geo.last.lat.toFixed(4) === B.latitude.toFixed(4), `last lat ${g.geo.last.lat.toFixed(4)}`);

    await page.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('errors:', errs.length ? JSON.stringify(errs, null, 1) : 'none');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
