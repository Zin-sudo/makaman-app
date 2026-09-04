// The busy ring — visible, progressive feedback for an action that waits on a live round
// trip instead of the offline-first, write-then-sync kind (see runBusy() and mutate()
// for why most of the app never needs this at all).
//
// 2026-09-04, owner's request: an action that is slow on a weak connection used to give
// no sign it was doing anything until it either finished or produced a banner — on a bad
// connection, indistinguishable from a hang. This proves the ring appears the instant the
// action starts, climbs while the request is still in flight (never claiming 100% before
// the real answer), and resolves to either a quiet success or a plain-language reason —
// the same classifier the error log already uses, so "a weak connection" reads the same
// way here as it does everywhere else in the app.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const { makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const ADMIN = '99999999-9999-4999-8999-999999999999';
const MGR = '22222222-2222-4222-8222-222222222222'; // OPS, already seeded by makeDB()
const DB = makeDB();
DB.profiles.push({ id: ADMIN, email: 'lateri@makaman.ly', full_name: 'Lateri', role: 'admin', status: 'active' });
assertStubParses(DB);

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
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
  await i.nth(0).fill('lateri@makaman.ly'); await i.nth(1).fill('whatever');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1500);

  const target = () => ({ id: MGR, email: 'omar@makaman.ly', name: 'Omar Al-Saleh', roleKey: 'mgr' });

  // ── The ring appears the instant the action starts, and climbs while it waits ──
  {
    await p.evaluate(() => { window.__stubWriteLatency = 900; });
    await p.evaluate((u) => window.__mkApp.setPermissionOverride(u, 'pricelist.delete', true), target());
    await p.waitForTimeout(80);
    const early = await p.evaluate(() => {
      const el = document.querySelector('.mk-busy');
      return el ? el.textContent : null;
    });
    check('the ring is on screen almost immediately after the action starts', !!early, JSON.stringify(early));

    await p.waitForTimeout(400);
    const mid = await p.evaluate(() => {
      const el = document.querySelector('.mk-busy');
      return el ? parseInt((el.textContent.match(/(\d+)%/) || [0, '0'])[1], 10) : null;
    });
    check('by the middle of a 900ms wait, the ring has climbed off its starting value',
      mid !== null && mid > 4 && mid < 100, 'read: ' + mid + '%');

    // Never claims completion before the real answer — still short of 100% right up to
    // the edge of the artificial delay.
    await p.waitForTimeout(350);
    const late = await p.evaluate(() => {
      const el = document.querySelector('.mk-busy');
      return el ? parseInt((el.textContent.match(/(\d+)%/) || [0, '0'])[1], 10) : null;
    });
    check('still under 100% right up to the moment the real response is due',
      late !== null && late < 100, 'read: ' + late + '%');

    // The write actually lands, then the ring clears itself.
    await p.waitForTimeout(600);
    const gone = await p.evaluate(() => !document.querySelector('.mk-busy'));
    check('once the write lands, the ring clears itself without being told to', gone);
    await p.evaluate(() => { window.__stubWriteLatency = 0; });
  }

  // ── A refusal clears the ring, and never lets it read 100% on the way out ──
  // Supabase resolves a refused upsert with { error } set rather than rejecting, so this
  // is the exact shape that used to fool runBusy: the promise it was handed "succeeded"
  // (it resolved), and only the caller's own .then() noticed the error afterward — by
  // which point runBusy had already put the ring at 100% and green. Fixed by moving that
  // check inside the wrapped call itself (see setPermissionOverride()); this proves the
  // ring never climbs to completion for a call that actually failed.
  {
    await p.evaluate(() => {
      window.__stubWriteLatency = 200;
      window.__failInsert = 'user_permissions';
      window.__failMessage = 'network down';
    });
    // setPermissionOverride() does not return its internal promise chain — it is fired
    // from a button's onClick, nothing downstream awaits it — so this only starts it and
    // polls the DOM afterward, the same as a real click would.
    await p.evaluate((u) => { window.__mkApp.setPermissionOverride(u, 'pricelist.edit', true); }, target());
    await p.waitForTimeout(80);
    const whileWaiting = await p.evaluate(() => !!document.querySelector('.mk-busy'));
    check('the ring shows while the refusal is still in flight', whileWaiting);
    await p.waitForTimeout(110);
    const justBeforeRefusal = await p.evaluate(() => {
      const el = document.querySelector('.mk-busy');
      return el ? parseInt((el.textContent.match(/(\d+)%/) || [0, '0'])[1], 10) : null;
    });
    check('right up to the refusal arriving, it never reads 100%',
      justBeforeRefusal !== null && justBeforeRefusal < 100, 'read: ' + justBeforeRefusal + '%');

    await p.waitForTimeout(500);
    const afterFail = await p.evaluate(() => ({
      busyGone: !document.querySelector('.mk-busy'),
      // setPermissionOverride() keeps its own, more specific catch (toastOnError: false
      // on this call), which is why the raw stub text shows up rather than a classified
      // one — the point here is only that the RING itself never claimed success.
      toastText: (document.querySelector('.mk-toast') || {}).textContent || '',
    }));
    check('the ring clears once the refusal comes back, not left spinning', afterFail.busyGone);
    check('this action\'s own error message still reaches the toast, unchanged by the fix',
      /network down/i.test(afterFail.toastText), afterFail.toastText);
    await p.evaluate(() => { window.__stubWriteLatency = 0; window.__failInsert = ''; window.__failMessage = ''; });
  }

  // ── runBusy()'s own default behaviour, for a caller with no message of its own ──
  // Every wired call in this build already had a specific failure message and opts out
  // (toastOnError: false) to keep it — this is the DEFAULT any future caller gets for
  // free by simply not opting out, driven directly rather than through a business action.
  {
    await p.evaluate(() => {
      window.__mkApp.runBusy('test-default-reason', 'Testing',
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('network down')), 150)))
        // Caught here only because this test calls runBusy() directly with nothing else
        // downstream to catch it — a real caller always has its own .then()/.catch()
        // chain, as every other block in this file does.
        .catch(() => {});
    });
    await p.waitForTimeout(400);
    const toastText = await p.evaluate(() => (document.querySelector('.mk-toast') || {}).textContent || '');
    check('with no site-specific handling, the reason reads in the same plain language the error log already uses elsewhere',
      /server could not be reached/i.test(toastText), toastText);
  }

  await ctx.close();
  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
