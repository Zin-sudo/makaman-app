// MK-LOAD-RLS: "permission denied for function is_staff" on a cold boot.
//
// componentDidMount used to fire hydrate() as soon as this.state.session was truthy —
// the app's OWN locally-cached flag, read synchronously out of localStorage. The Supabase
// client's own session (the thing that actually attaches a bearer token to every request)
// restores asynchronously, out of its own storage. On a cold boot there was a window where
// the flag was already true and the client had not finished — the first requests in that
// window went out as anon, and every RLS check that calls is_staff() answered "permission
// denied for function is_staff."
//
// The fix waits on getSession() before firing the boot-time hydrate. This asserts the
// ordering directly: with the client's session restore held deliberately slow, nothing
// hydrate touches may start before that restore settles — and that the app is still on
// screen, signed in, the whole time, because the wait is on the network call only.
const { chromium } = require('playwright-core');
const { TICKET, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

const DB = makeDB();
assertStubParses(DB);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1180, height: 950 }, serviceWorkers: 'block' });
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

  // An ordinary sign-in. Not the cold-boot path being tested — that only fires when the
  // app mounts with an already-persisted session — but it is what leaves one behind.
  const i = p.locator('input');
  await i.nth(0).fill('yousef@makaman.ly'); await i.nth(1).fill('whatever');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1800);
  await p.evaluate(() => window.__mkApp.persist(window.__mkApp.state.data));
  await p.waitForTimeout(300);

  // Now arm a slow session restore for every navigation from here on (addInitScript
  // stacks and survives reload — a plain window.evaluate() does not, since a reload is a
  // real navigation and resets the JS realm). This is the cold-boot scenario: a device
  // reopening the app on a session it already had.
  await p.addInitScript(() => { window.__sessionRestoreMs = 500; });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1400);

  const slow = await p.evaluate((ticketId) => ({
    sessionRestoredAt: window.__sessionRestoredAt,
    firstEventStart: (window.__events || []).length
      ? Math.min(...window.__events.map(e => e.start)) : null,
    events: (window.__events || []).map(e => e.what),
    signedIn: !!(window.__mkApp && window.__mkApp.state.session
      && window.__mkApp.state.session.name),
    ticketOnScreen: (window.__mkApp.state.data.tickets || []).some(t => t.id === ticketId),
  }), TICKET);
  check('the session restore actually happened', slow.sessionRestoredAt > 0,
    'restoredAt=' + slow.sessionRestoredAt);
  check('and requests were actually made to check against', slow.events.length > 0,
    JSON.stringify(slow.events));
  check("hydrate's first request waits for the session restore to settle",
    slow.firstEventStart !== null && slow.firstEventStart >= slow.sessionRestoredAt,
    'first request at ' + slow.firstEventStart + ', session settled at ' + slow.sessionRestoredAt);
  check('the app is on screen and signed in the whole time regardless — the wait is on '
    + 'the network call, not on what the person sees', slow.signedIn === true);
  check('and the cached replica is already there, delay or not',
    slow.ticketOnScreen === true);

  // With no delay at all, the wait costs nothing observable — a fast client resolves
  // getSession() essentially immediately and hydrate proceeds as before.
  await p.addInitScript(() => { window.__sessionRestoreMs = 0; });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  const fast = await p.evaluate(() => ({
    events: (window.__events || []).map(e => e.what),
    signedIn: !!(window.__mkApp && window.__mkApp.state.session
      && window.__mkApp.state.session.name),
  }));
  check('and with no delay armed, the boot still reaches the server normally',
    fast.events.length > 0, JSON.stringify(fast.events));
  check('still signed in', fast.signedIn === true);

  // The failure this was actually built to close off: not a slow restore but one that
  // never settles at all, the way a stuck Web Locks mutex from a killed tab leaves the
  // real client's getSession() waiting forever. Before withTimeout this hung the boot-time
  // hydrate for the rest of the session — the exact "no tickets, closing and reopening
  // brings them back" report — since nothing about a promise that never resolves ever
  // throws for runLatest, componentDidMount, or anything downstream to catch.
  await p.addInitScript(() => { window.__sessionRestoreHang = true; });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(5200);
  const hung = await p.evaluate((ticketId) => ({
    events: (window.__events || []).map(e => e.what),
    signedIn: !!(window.__mkApp && window.__mkApp.state.session
      && window.__mkApp.state.session.name),
    ticketOnScreen: (window.__mkApp.state.data.tickets || []).some(t => t.id === ticketId),
  }), TICKET);
  check('a getSession() that never settles does not block the boot forever',
    hung.events.length > 0, JSON.stringify(hung.events));
  check('the app is still on screen and signed in despite the hang',
    hung.signedIn === true);
  check('and the cached replica is still there — a stuck lock costs a delay, not the data',
    hung.ticketOnScreen === true);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await ctx.close();
  await b.close();
  process.exit(fail ? 1 : 0);
})();
