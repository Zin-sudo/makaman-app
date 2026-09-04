// Reported live: a technician's "Job Done" did not show on the Ops Manager's
// Save-to-Home-Screen app until the app was relaunched — AUTO_SYNC_INTERVAL_MS is
// fifteen minutes, and nothing else pulled in between. subscribeRealtime() closes that
// gap with a channel on `tickets`; this proves the channel actually opens on sign-in,
// that a change on it schedules an ordinary refresh() rather than a second data path,
// that a burst of changes collapses into one refresh rather than one per row, and that
// signing out actually closes the channel rather than leaving a socket open with
// nothing left under RLS to receive.
//
// There is no real WebSocket here — cloudstub.js's channel()/subscribe() only records
// what was asked for and lets a test fire the registered callback by hand
// (window.__fireRealtime). What that proves is this app's own half of the contract:
// given a change notification, does it do the right thing. Whether Postgres Changes
// actually delivers one, filtered correctly by RLS, is a fact about Supabase's own
// infrastructure — confirmed against the live project instead (publication enabled,
// policies unchanged), not something a fake socket could stand in for either way.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const { makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const DB = makeDB();
assertStubParses(DB);

const armSpy = (p) => p.evaluate(() => {
  const app = window.__mkApp;
  // Wraps from the TRUE original every time, cached once — re-arming later in the run
  // (block 3, after block 2 already wrapped it) must reset the count, not wrap an
  // already-wrapped refresh a second time, which would double-count every real call.
  if (!app.__origRefresh) app.__origRefresh = app.refresh.bind(app);
  app.__refreshCount = 0;
  app.refresh = () => { app.__refreshCount += 1; return app.__origRefresh(); };
});
const refreshCount = (p) => p.evaluate(() => window.__mkApp.__refreshCount);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: STUB(DB) }));
  await p.addInitScript(() => {
    window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
    window.__DRAIN_TEST_MS = 120;
    window.__REALTIME_TEST_MS = 200;
  });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('whatever');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1600);

  // ── Signing in opens exactly one channel, on the right table ──────────────
  {
    const chans = await p.evaluate(() => (window.__realtimeChannels || []).map(c => ({
      name: c.name,
      // s.event is .on()'s own first argument — the Realtime EVENT TYPE, always the
      // literal string 'postgres_changes' for this kind of subscription. Which table
      // and which row operations (insert/update/delete/'*') is the FILTER, s.filter's
      // own fields — a different question, asked separately below.
      subs: c.subs.map(s => ({ kind: s.event, event: s.filter && s.filter.event,
        table: s.filter && s.filter.table, schema: s.filter && s.filter.schema })),
    })));
    check('exactly one channel is opened on sign-in', chans.length === 1, JSON.stringify(chans));
    check('it watches public.tickets, every event',
      chans[0] && chans[0].subs.some(s => s.kind === 'postgres_changes'
        && s.table === 'tickets' && s.schema === 'public' && s.event === '*'),
      JSON.stringify(chans[0]));
    // 2026-09-04: a permission grant took a full relaunch to reach an already-open
    // session, the same gap this file's own tickets subscription closed one table over
    // (migration 0057) — same channel, one more subscription, not a second channel.
    check('it also watches public.user_permissions, every event, on the same channel',
      chans[0] && chans[0].subs.some(s => s.kind === 'postgres_changes'
        && s.table === 'user_permissions' && s.schema === 'public' && s.event === '*'),
      JSON.stringify(chans[0]));
    check('still exactly one channel — the second subscription did not open a second one',
      chans[0] && chans[0].subs.length === 2, JSON.stringify(chans[0]));
  }

  // ── A change notification refreshes, not a second data path ──────────────
  {
    await armSpy(p);
    const before = await p.evaluate(() => window.__fireRealtime());
    check('firing the channel is acknowledged', before === true);
    await p.waitForTimeout(500);
    const n = await refreshCount(p);
    check('a single change schedules exactly one refresh()', n === 1, n + ' call(s)');
  }

  // ── A burst collapses to one refresh, the same debounce scheduleDrain uses ──
  {
    await armSpy(p);
    await p.evaluate(() => { window.__fireRealtime(); window.__fireRealtime(); window.__fireRealtime(); });
    await p.waitForTimeout(80);
    const mid = await refreshCount(p);
    check('nothing has fired yet mid-burst — it is debounced, not immediate', mid === 0, mid + ' call(s)');
    await p.waitForTimeout(500);
    const n = await refreshCount(p);
    check('three changes in quick succession still schedule exactly one refresh()',
      n === 1, n + ' call(s)');
  }

  // ── Signing out closes the channel ────────────────────────────────────────
  {
    const chanBefore = await p.evaluate(() => window.__realtimeChannels[0]);
    await p.getByRole('button', { name: /^Account$/i }).last().click();
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /^Log out$/ }).first().click();
    await p.waitForTimeout(500);
    const removed = await p.evaluate(() => (window.__realtimeRemoved || []).map(c => c.name));
    check('logging out removes the channel that was opened at sign-in',
      removed.length === 1 && removed[0] === chanBefore.name, JSON.stringify(removed));
  }

  // ── Signing back in opens a fresh one, not a second one stacked on the old ──
  {
    const i2 = p.locator('input');
    await i2.nth(0).fill('omar@makaman.ly'); await i2.nth(1).fill('whatever');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(1600);
    const chans = await p.evaluate(() => (window.__realtimeChannels || []).length);
    check('signing back in opens exactly one new channel, not a second stacked on the old',
      chans === 2, chans + ' channel(s) ever opened this session');
  }

  // ── Reported live, 2026-09-04: two accounts testing "does the other one's change ──
  // ── show up live" always needed a reload or a PWA relaunch — the socket a backgrounded
  // ── tab or Home-Screen app was holding had died, and subscribeRealtime()'s own "already
  // ── have a channel" guard meant nothing ever asked for a new one. The fix: both
  // ── 'online' and visibilitychange now tear down whatever channel exists and open a
  // ── fresh one, on the theory that there is no cheap way to ask a channel object
  // ── whether its socket actually survived — proven here as a torn-down-and-replaced
  // ── pair, not merely "a channel exists" (which the stale one already satisfied).
  {
    const before = await p.evaluate(() => ({
      chans: window.__realtimeChannels.length,
      removed: (window.__realtimeRemoved || []).length,
      staleName: window.__realtimeChannels[window.__realtimeChannels.length - 1].name,
    }));
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForTimeout(500);
    const after = await p.evaluate(() => ({
      chans: window.__realtimeChannels.length,
      removedNames: (window.__realtimeRemoved || []).map((c) => c.name),
    }));
    check('the page coming back into view opens a fresh channel',
      after.chans === before.chans + 1, `${before.chans} -> ${after.chans}`);
    check('...and actually tears down the one that was there before, not just adding a second',
      after.removedNames.indexOf(before.staleName) >= 0, JSON.stringify(after.removedNames));
  }

  // ── The same reconnect happens when the browser reports coming back online — a ──
  // ── network blip, not necessarily a page that was ever hidden, closes the same gap ──
  {
    const before = await p.evaluate(() => window.__realtimeChannels.length);
    await p.evaluate(() => window.dispatchEvent(new Event('online')));
    await p.waitForTimeout(500);
    const after = await p.evaluate(() => window.__realtimeChannels.length);
    check('coming back online also opens a fresh channel, not just re-pulling data',
      after === before + 1, `${before} -> ${after}`);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await ctx.close();
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
