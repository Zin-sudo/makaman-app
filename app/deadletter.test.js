// A6: the "N changes were refused" banner used to come back every launch with no way out
// but Dismiss — which threw the record of the failed work away for good, the only thing a
// person could actually do about it. This drives the third option: Retry puts the ops
// back in the queue and tries again, and Dismiss now asks first, since it means something
// a person could regret.
const { chromium } = require('playwright-core');
const { makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function boot(b, DB) {
  const ctx = await b.newContext({ viewport: { width: 1180, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: STUB(DB) }));
  await p.addInitScript(() => {
    window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
    window.__DRAIN_TEST_MS = 100;
  });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('x');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1600);
  return { ctx, p };
}

// Drives one real op all the way into the dead-letter pile, the way it actually happens:
// through the app's own queue, refused OUTBOX_TRIES times, not by writing the pile by hand.
async function deadLetterOneChange(p, message) {
  await p.evaluate((msg) => {
    window.__failInsert = 'audit_log';
    window.__failMessage = msg;
  }, message);
  await p.evaluate(() => {
    const app = window.__mkApp;
    const t = (app.state.data.tickets || [])[0];
    app.logOn(t.id, 'A6 probe change at ' + Date.now() + '.', 'lifecycle');
  });
  for (let i = 0; i < 8; i++) {
    await p.evaluate(() => window.__mkApp.refresh().catch(() => {}));
    await p.waitForTimeout(280);
  }
  await p.evaluate(() => { window.__failInsert = ''; window.__failMessage = ''; });
}
const deadLetterCount = (p) => p.evaluate(() =>
  JSON.parse(localStorage.getItem('makaman.outbox.refused.v1') || '[]').length);
const banner = (p) => p.evaluate(() => ({
  shown: /refused by the server/.test(document.body.innerText),
  retryBtn: !!Array.from(document.querySelectorAll('button')).find(x => /^RETRY$/.test(x.innerText || '')),
  dismissBtn: !!Array.from(document.querySelectorAll('button')).find(x => /^DISMISS$/.test(x.innerText || '')),
}));

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── Retry re-queues and actually drains ──────────────────────────────────
  {
    const { ctx, p } = await boot(b, makeDB());
    await deadLetterOneChange(p, 'new row violates row-level security policy for table "audit_log"');
    check('the change reached the dead-letter pile', await deadLetterCount(p) === 1);
    let b1 = await banner(p);
    check('the banner shows, with both actions', b1.shown && b1.retryBtn && b1.dismissBtn,
      JSON.stringify(b1));

    // The reason it was refused is gone now — the point of Retry, since a real refusal
    // is very often exactly this: transient, or since resolved another way.
    await p.evaluate(() => { window.__writes = []; });
    await p.getByRole('button', { name: /^RETRY$/ }).click();
    await p.waitForTimeout(900);

    check('the dead-letter pile is empty once retried', await deadLetterCount(p) === 0);
    const reached = await p.evaluate(() =>
      window.__writes.some(w => w.table === 'audit_log' && w.action === 'upsert'));
    check('the retried change actually reached the server this time', reached === true);
    const b2 = await banner(p);
    check('and the banner is gone, not still showing a settled refusal', b2.shown === false,
      JSON.stringify(b2));
    const toastSeen = await p.evaluate(() => /Trying (that change|1 changes)? ?again/i
      .test(document.body.innerText) || /Trying that change again/.test(document.body.innerText));
    check('and the person is told something happened', toastSeen === true);
    await ctx.close();
  }

  // ── Dismiss asks first, and only actually discards after the second tap ──
  {
    const { ctx, p } = await boot(b, makeDB());
    await deadLetterOneChange(p, 'new row violates row-level security policy for table "audit_log"');
    check('the change reached the dead-letter pile again', await deadLetterCount(p) === 1);

    await p.getByRole('button', { name: /^DISMISS$/ }).click();
    await p.waitForTimeout(400);
    const asked = await p.evaluate(() => document.body.innerText);
    check('dismissing asks first, naming what it costs',
      /Give up on these changes\?/.test(asked) && /only record/.test(asked), asked.slice(0, 40));
    check('nothing is discarded yet', await deadLetterCount(p) === 1);

    // Backing out keeps the record.
    await p.getByRole('button', { name: /^Keep them$/ }).click();
    await p.waitForTimeout(300);
    check('cancelling keeps the refusal on record', await deadLetterCount(p) === 1);
    let b3 = await banner(p);
    check('and the banner is still there to act on', b3.shown === true);

    // Asking again and actually confirming this time.
    await p.getByRole('button', { name: /^DISMISS$/ }).click();
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /^Give up on them$/ }).click();
    await p.waitForTimeout(400);
    check('confirming actually discards it', await deadLetterCount(p) === 0);
    const b4 = await banner(p);
    check('and the banner clears', b4.shown === false);
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
