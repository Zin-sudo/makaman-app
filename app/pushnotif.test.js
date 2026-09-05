// Web Push (0058): the client half — "Notify this device" in Settings, subscribing and
// writing push_subscriptions, and unsubscribing and removing that row again.
//
// The actual Web Push protocol (VAPID JWT signing, RFC 8291 encryption, delivery through
// a real push service) lives in supabase/functions/send-push and was proven separately,
// live, against the real project: notify_push() was called directly with a planted
// push_subscriptions row pointing at a URL that answers 410, and the row was pruned —
// see the session notes for that run. Nothing in THIS process can reach a real push
// service or the live Supabase REST API, so what this file proves is this app's own half
// of the contract: given permission and a working PushManager, does it ask to subscribe
// with the right key, save the right row, and clean up on the way back off — the same
// division cloud.test.js and realtime.test.js already draw between "this app's logic"
// and "Supabase's own infrastructure, confirmed separately".
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const { makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const DB = makeDB();
assertStubParses(DB);

const FAKE_ENDPOINT = 'https://fake.push.example/subscription/ep-1';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: STUB(DB) }));
  await p.addInitScript(() => {
    window.MAKAMAN_CONFIG = {
      authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub',
      // Any base64url string atob() can decode — the fake PushManager below never
      // actually validates it as an EC point, that part of the real crypto is
      // send-push's job and was proven live, not this file's.
      vapidPublicKey: 'BM6G4YIktE9kod_JV7Napbrbm0yvd09s7ja9z_SheYWCT-YGq8-zDm7Rhz_ao_m2vy7ae4piM9ENC9Uuq8g-SMw',
    };
    // A fake PushManager that behaves like the real one for exactly the calls this app
    // makes: subscribe() records what key it was asked to use and hands back a
    // subscription; getSubscription()/unsubscribe() track the one it made. Overriding
    // the .ready getter (an own property shadows the prototype's accessor) works whether
    // or not a real service worker ever installs, which is what serviceWorkers:'block'
    // above guarantees it will not.
    window.__pushSub = null;
    window.__subscribeCalls = [];
    const makeFakeSub = () => ({
      endpoint: window.__pushSub.endpoint,
      toJSON: () => window.__pushSub,
      unsubscribe: () => { window.__pushSub = null; return Promise.resolve(true); },
    });
    const fakeReg = {
      pushManager: {
        subscribe: (opts) => {
          window.__subscribeCalls.push(opts);
          window.__pushSub = {
            endpoint: 'https://fake.push.example/subscription/ep-1',
            keys: { p256dh: 'BPhonyClientPublicKeyBase64Url', auth: 'PhonyAuthSecret' },
          };
          return Promise.resolve(makeFakeSub());
        },
        getSubscription: () => Promise.resolve(window.__pushSub ? makeFakeSub() : null),
      },
    };
    Object.defineProperty(navigator.serviceWorker, 'ready', {
      configurable: true, get: () => Promise.resolve(fakeReg),
    });
    // Real Notification.requestPermission() needs a browser-level grant this harness has
    // no reason to wire up separately from the fake PushManager above — this app treats
    // "permission granted" and "the browser will actually let me subscribe" as the one
    // fact it needs, which the stub above supplies directly.
    Object.defineProperty(window, 'Notification', {
      configurable: true, writable: true,
      value: { permission: 'default', requestPermission: () => Promise.resolve('granted') },
    });
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

  await p.evaluate(() => window.__mkApp.setState({ showSettings: true }));
  await p.waitForTimeout(300);

  // ── The toggle is offered, and starts off ─────────────────────────────────
  {
    const label = p.getByText('Notify this device', { exact: true });
    check('the toggle is offered once permission/PushManager/a VAPID key are all present',
      await label.count() > 0);
    const checked = await p.evaluate(() => {
      const row = Array.from(document.querySelectorAll('div')).find(d => d.textContent.trim() === 'Notify this device');
      const card = row && row.closest('div[style*="border"]');
      const btn = card && card.querySelector('button[role="switch"]');
      return btn ? btn.getAttribute('aria-checked') : null;
    });
    check('...and starts off', checked === 'false', 'aria-checked=' + checked);
  }

  // ── Turning it on asks PushManager for the right key, and saves the row ───
  {
    const btn = p.locator('button[role="switch"]').last();
    await btn.click();
    await p.waitForTimeout(500);
    const state = await p.evaluate(() => ({
      subscribeCalls: window.__subscribeCalls.length,
      userVisibleOnly: window.__subscribeCalls[0] && window.__subscribeCalls[0].userVisibleOnly,
      keyLen: window.__subscribeCalls[0] && window.__subscribeCalls[0].applicationServerKey
        && window.__subscribeCalls[0].applicationServerKey.length,
      writes: (window.__writes || []).filter(w => w.table === 'push_subscriptions'),
      notifPushOn: window.__mkApp.state.notifPushOn,
    }));
    check('subscribe() was asked for exactly once', state.subscribeCalls === 1, JSON.stringify(state));
    check('...with userVisibleOnly (required by the spec, or Chrome refuses the subscribe)',
      state.userVisibleOnly === true);
    check('...and the VAPID key as actual bytes, not the base64url text', state.keyLen > 0, 'keyLen=' + state.keyLen);
    check('exactly one push_subscriptions upsert was sent',
      state.writes.length === 1 && state.writes[0].action === 'upsert', JSON.stringify(state.writes));
    check('the component now reflects on', state.notifPushOn === true);
    const checked = await p.evaluate(() => {
      const row = Array.from(document.querySelectorAll('div')).find(d => d.textContent.trim() === 'Notify this device');
      const card = row && row.closest('div[style*="border"]');
      const btn2 = card && card.querySelector('button[role="switch"]');
      return btn2 ? btn2.getAttribute('aria-checked') : null;
    });
    check('...and the switch itself now reads on', checked === 'true', 'aria-checked=' + checked);
  }

  // ── Turning it back off unsubscribes and removes the row ─────────────────
  {
    const before = await p.evaluate(() => (window.__writes || []).filter(w => w.table === 'push_subscriptions').length);
    const btn = p.locator('button[role="switch"]').last();
    await btn.click();
    await p.waitForTimeout(500);
    const state = await p.evaluate(() => ({
      sub: window.__pushSub,
      writes: (window.__writes || []).filter(w => w.table === 'push_subscriptions'),
      notifPushOn: window.__mkApp.state.notifPushOn,
    }));
    check('the fake subscription itself was torn down', state.sub === null);
    check('a delete on push_subscriptions was sent',
      state.writes.length === before + 1 && state.writes[state.writes.length - 1].action === 'delete',
      JSON.stringify(state.writes));
    check('the component now reflects off', state.notifPushOn === false);
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await ctx.close();
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
