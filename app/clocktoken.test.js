// MK-CLOCK ("JWT issued at future") is a fact about the MOMENT a request landed, not
// about the row or the action — and, live, 2026-09-09, not about the device either: the
// clock was already correct and set automatically, and the refusal came and went inside
// the same minute with nothing on the phone changed in between. Before this fix the app
// treated it exactly like a permanent RLS refusal: it counted against an outbox op's
// limited `tries` and could eventually set the change aside as "refused — check your
// device's clock" (bad advice when the clock is already right), and a foreground action
// (runBusy) surfaced the same accusatory message on the very first blip with no attempt
// to just try again a moment later.
//
// Both halves are proven here, the same way NET's identical treatment is already proven
// elsewhere in this suite: a queued write that keeps failing as CLOCK must never be
// counted against `tries` or set aside, only actually stop being retried once the
// underlying fault clears; and a foreground action must retry — with a short backoff, up
// to CLOCK_RETRY_MAX times (2026-09-10: widened from a single retry, since nothing says
// the disagreement clears inside one short pause) — silently, before ever bothering
// whoever is waiting on it.
const { chromium } = require('playwright-core');
const { makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const CLOCK_MSG = 'JWT issued at future';
const DB = makeDB();
assertStubParses(DB);

async function boot(b, extraInit) {
  const ctx = await b.newContext({ viewport: { width: 1180, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: STUB(DB) }));
  await p.addInitScript((extra) => {
    window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
    window.__DRAIN_TEST_MS = 100;
    window.__CLOCK_RETRY_TEST_MS = extra.clockRetryMs;
  }, extraInit || { clockRetryMs: 50 });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('x');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1700);
  return { ctx, p };
}

const queue = (p) => p.evaluate(() => {
  const acct = (window.__mkApp.state.session || {}).email;
  return JSON.parse(localStorage.getItem(
    'makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : '')) || '[]');
});
const pile = (p) => p.evaluate(() => {
  const acct = (window.__mkApp.state.session || {}).email;
  return JSON.parse(localStorage.getItem(
    'makaman.outbox.refused.v1' + (acct ? '.' + acct.toLowerCase() : '')) || '[]');
});

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── A queued write refused as MK-CLOCK is never counted against tries or set aside ──
  {
    const { ctx, p } = await boot(b);
    await p.evaluate(([msg]) => {
      window.__failInsert = 'ticket_notes';
      window.__failMessage = msg;
      const acct = (window.__mkApp.state.session || {}).email;
      const k = 'makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : '');
      localStorage.setItem(k, JSON.stringify([
        { key: 'ticket_notes:n1', table: 'ticket_notes', action: 'upsert', seq: 1, acct: acct,
          row: { id: 'n1', ticket_id: 'aaaaaaaa-0000-4000-8000-00000000a1a1', body: 'Confirm the count.' } },
      ]));
    }, [CLOCK_MSG]);

    // More drains than OUTBOX_TRIES (5) would ever tolerate for an ordinary refusal —
    // proving CLOCK survives past the point that would otherwise have set it aside.
    for (let i = 0; i < 7; i++) {
      await p.evaluate(() => window.__mkApp.refresh().catch(() => {}));
      await p.waitForTimeout(150);
    }

    const q1 = await queue(p);
    check('the write stays queued after repeated clock-skew refusals', q1.length === 1, JSON.stringify(q1));
    check('and its tries count was never touched', !q1[0] || !q1[0].tries, JSON.stringify(q1[0] && q1[0].tries));
    check('it never reaches the set-aside pile the way a real refusal would',
      (await pile(p)).length === 0, JSON.stringify(await pile(p)));

    // The underlying fault clears — the same way a phone's clock disagreement clears
    // within moments in real life — and the very next drain sends it normally.
    await p.evaluate(() => { window.__failInsert = ''; window.__failMessage = ''; window.__writes = []; });
    await p.evaluate(() => window.__mkApp.refresh().catch(() => {}));
    await p.waitForTimeout(400);
    check('and sends cleanly the moment the clock disagreement is gone',
      (await queue(p)).length === 0, JSON.stringify(await queue(p)));
    check('reaching the server for real', await p.evaluate(() =>
      (window.__writes || []).some(w => w.table === 'ticket_notes')) === true);
    await ctx.close();
  }

  // ── A foreground action retries, with a backoff, silently, before bothering anyone ──
  {
    const { ctx, p } = await boot(b);
    const r1 = await p.evaluate((msg) => {
      let calls = 0;
      return window.__mkApp.runBusy('test-clock-retry', 'Testing', () => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error(msg));
        return Promise.resolve('ok');
      }).then((result) => ({ result: result, calls: calls }), (err) => ({ error: err.message, calls: calls }));
    }, CLOCK_MSG);
    check('the action was retried once, automatically', r1.calls === 2, JSON.stringify(r1));
    check('and the retry\'s own success is what the caller sees', r1.result === 'ok', JSON.stringify(r1));
    await p.waitForTimeout(200);
    const toastAfterRecover = await p.evaluate(() => (document.querySelector('.mk-toast') || {}).textContent || '');
    check('nobody watching the ring is ever told anything went wrong', !/issued in the future/i.test(toastAfterRecover), toastAfterRecover);

    // ── A fault that never clears is retried CLOCK_RETRY_MAX times, not forever ──
    // 2026-09-10: widened from a single retry to a short backoff (up to 3 more tries)
    // — nothing says a real disagreement clears inside one short pause, only "within a
    // few seconds" — so one failed retry used to be a false negative here.
    const r2 = await p.evaluate((msg) => {
      let calls = 0;
      return window.__mkApp.runBusy('test-clock-persist', 'Testing', () => {
        calls += 1;
        return Promise.reject(new Error(msg));
      }).then(() => ({ calls: calls }), (err) => ({ error: err.message, calls: calls }));
    }, CLOCK_MSG);
    check('the fault is retried 3 more times (4 calls total), not once and not forever',
      r2.calls === 4, JSON.stringify(r2));
    await p.waitForTimeout(200);
    const toastAfterPersist = await p.evaluate(() => (document.querySelector('.mk-toast') || {}).textContent || '');
    check('a fault that does not clear after every retry is finally shown',
      /issued in the future/i.test(toastAfterPersist), toastAfterPersist);
    check('and it no longer tells someone to go check a clock that is probably fine',
      !/this device's clock is wrong/i.test(toastAfterPersist), toastAfterPersist);
    await ctx.close();
  }

  // ── refreshCurrentTab (the top-bar Force Refresh / Sync button) gets the same
  // treatment — it calls refreshCore() directly, not through runBusy, and used to show
  // the raw MK-CLOCK sentence on the very first refusal. ──
  {
    const { ctx, p } = await boot(b);
    await p.evaluate((msg) => { window.__failSelect = { '*': msg }; }, CLOCK_MSG);
    await p.getByRole('button', { name: 'Refresh current tab' }).click();
    // Worst case here is CLOCK_RETRY_MAX retries at the test's own short backoff
    // (clockRetryMs=50 doubling 3 times) plus the drain/hydrate round trips themselves —
    // comfortably inside this wait.
    await p.waitForTimeout(1500);
    const toast = await p.evaluate(() => (document.querySelector('.mk-toast') || {}).textContent || '');
    check('Force Refresh also retries a CLOCK refusal before ever showing it',
      /issued in the future/i.test(toast), toast);
    await p.evaluate(() => { window.__failSelect = {}; });
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
