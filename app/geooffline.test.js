// 2026-09-09, owner's request: "The log-line geo ping should update the LATEST/CURRENT
// LOCATION of the user without failing to do so unless the toggle is turned off. In the
// case the user is offline record coordinates locally then sync to the app when online so
// they others have the latest ping of that user."
//
// GPS itself needs no network — see geoLogPing's own comment — so the fix always lands in
// local state first, through mutate(), the exact same offline-first path every other field
// on a ticket already uses. This proves that promise specifically for the geo ping rather
// than assuming it rides along for free: offline, the fix is captured and queued; the
// server has not heard about it yet; back online, it reaches the server the same way any
// other queued edit would, so another viewer's Field Devices reads the technician's latest
// position.
const { chromium } = require('playwright-core');
const { TECH, TICKET, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
const A = { latitude: 32.887209, longitude: 13.191338, accuracy: 12 };
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const DB = makeDB();
  assertStubParses(DB);
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, permissions: ['geolocation'], geolocation: A, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: STUB(DB) }));
  await p.addInitScript(() => {
    window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
  });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill('yousef@makaman.ly'); await i.nth(1).fill('whatever');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1500);

  // Offline: the fix must still be captured and written to local state right away.
  await p.evaluate(() => { window.__offline = true; });
  await p.evaluate(([id]) => window.__mkApp.geoLogPing(id), [TICKET]);
  await p.waitForTimeout(600);

  const localGeo = await p.evaluate(([id]) => {
    const t = window.__mkApp.state.data.tickets.find(x => x.id === id);
    return t && t.geo;
  }, [TICKET]);
  check('offline: the fix lands locally right away, no network required',
    !!(localGeo && localGeo.last), JSON.stringify(localGeo));
  check('offline: it is the real position the mocked GPS gave',
    localGeo && localGeo.last.lat.toFixed(4) === A.latitude.toFixed(4),
    localGeo && localGeo.last.lat.toFixed(4));

  const serverBefore = await p.evaluate(([id]) => (window.__db.tickets.find(t => t.id === id) || {}).geo_last, [TICKET]);
  check('offline: the server has not heard about it yet', !serverBefore, JSON.stringify(serverBefore));

  const outbox = () => p.evaluate(() => {
    const acct = (window.__mkApp.state.session || {}).email;
    return JSON.parse(localStorage.getItem('makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : '')) || '[]');
  });
  let q = await outbox();
  check('offline: the change is actually queued for later, not merely held in memory',
    q.some(o => o.table === 'tickets'), JSON.stringify(q.map(o => o.key)));

  // Back online: the same queue every other field change already relies on carries it up.
  await p.evaluate(() => { window.__offline = false; });
  await p.evaluate(() => window.__mkApp.refreshCurrentTab());
  await p.waitForTimeout(1200);

  const serverAfter = await p.evaluate(([id]) => (window.__db.tickets.find(t => t.id === id) || {}).geo_last, [TICKET]);
  check('online again: the position reaches the server, so other viewers get the latest ping',
    !!serverAfter && serverAfter.lat.toFixed(4) === A.latitude.toFixed(4), JSON.stringify(serverAfter));
  q = await outbox();
  check('and the queue is actually drained, not left pretending to still be pending',
    !q.some(o => o.table === 'tickets'), JSON.stringify(q.map(o => o.key)));

  await ctx.close();

  // ── A second ping racing an in-flight one is queued, never silently dropped ──────────
  //
  // geoBusy is shared with every other geo ask. A log line landing while one of those is
  // still resolving used to just return — no different, from the technician's point of
  // view, than the toggle being off. This proves the fix: the second request is remembered
  // and gets its own attempt the moment the first settles, so Latest/Current location
  // still ends up reflecting the most recently requested fix, not the first one to happen
  // to ask.
  {
    const DB2 = makeDB();
    assertStubParses(DB2);
    const ctx2 = await b.newContext({ viewport: { width: 420, height: 900 }, permissions: ['geolocation'], geolocation: A, serviceWorkers: 'block' });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    await p2.route('**/vendor/supabase.umd.js', r => r.fulfill({
      status: 200, contentType: 'application/javascript', body: STUB(DB2) }));
    await p2.addInitScript(() => {
      window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
    });
    await p2.goto(URL, { waitUntil: 'networkidle' });
    await p2.waitForTimeout(300);
    await p2.evaluate(() => localStorage.clear());
    await p2.reload({ waitUntil: 'networkidle' });
    await p2.waitForTimeout(700);
    const i2 = p2.locator('input');
    await i2.nth(0).fill('yousef@makaman.ly'); await i2.nth(1).fill('whatever');
    await p2.getByRole('button', { name: /log in/i }).click();
    await p2.waitForTimeout(1500);

    // Hold the FIRST getCurrentPosition call open rather than answering it, so geoBusy
    // stays true until the test explicitly releases it; every call after the first
    // resolves immediately with a second, different position.
    await p2.evaluate(() => {
      window.__geoCalls = 0;
      window.__held = null;
      const SECOND = { latitude: 32.914477, longitude: 13.219903, accuracy: 6 };
      navigator.geolocation.getCurrentPosition = function (ok) {
        window.__geoCalls++;
        if (window.__geoCalls === 1) { window.__held = ok; return; }
        ok({ coords: { latitude: SECOND.latitude, longitude: SECOND.longitude, accuracy: SECOND.accuracy }, timestamp: Date.now() });
      };
    });

    await p2.evaluate(([id]) => window.__mkApp.geoLogPing(id), [TICKET]);
    await p2.waitForTimeout(200);
    check('the first call is genuinely in flight (geoBusy true, held open)',
      await p2.evaluate(() => window.__mkApp.geoBusy) === true);

    await p2.evaluate(([id]) => window.__mkApp.geoLogPing(id), [TICKET]);
    await p2.waitForTimeout(200);
    check('a second ping while the first is in flight does not call the GPS a second time',
      await p2.evaluate(() => window.__geoCalls) === 1);
    check('it is remembered instead, not dropped',
      await p2.evaluate(() => window.__mkApp.geoLogPingQueued) === TICKET);

    // Release the first call — geoBusy clears, the queued request should fire on its own.
    await p2.evaluate(() => {
      window.__held({ coords: { latitude: 32.887209, longitude: 13.191338, accuracy: 12 }, timestamp: Date.now() });
    });
    await p2.waitForTimeout(400);
    check('the queued request fires on its own once the first settles',
      await p2.evaluate(() => window.__geoCalls) === 2);
    check('and nothing is left queued behind it',
      await p2.evaluate(() => window.__mkApp.geoLogPingQueued) == null);

    const finalGeo = await p2.evaluate(([id]) => window.__mkApp.state.data.tickets.find(t => t.id === id).geo, [TICKET]);
    check('Latest/Current location ends up as the SECOND, more recently requested fix',
      finalGeo.last.lat.toFixed(4) === '32.9145', JSON.stringify(finalGeo.last));

    await ctx2.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
