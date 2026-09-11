// The purge tool (2026-09-10, owner's request): wipe every test ticket on the live
// project so the three dummy technician accounts can finally be deleted (delete_user
// already refuses anyone with a ticket-linked row) and the app can restart at 0 tickets
// for real technician onboarding. Destructive enough that it must not be a single tap:
// "make the purge a feature where the admin needs to input his password to activate it.
// And input a verification code that arrives to his email as a must. To activate again
// if necessary."
//
// This suite never calls the real admin-actions Edge Function or touches the live
// project — supabase/functions/admin-actions/index.ts's request_purge_code and
// purge_test_tickets actions are exercised there, live, separately (per the plan's own
// "built and verified against a branch, never run against live data by this session").
// What is testable here, and is exactly the part a live check cannot reach, is the
// client's own state machine: the typed phrase gates the password step, the password
// step's server refusal is shown and does not advance, a resend reuses the password
// already entered rather than asking again, a wrong code is shown and does not advance,
// and cancelling at any step clears every field rather than leaving a password sitting
// in memory. window.__invokeFunction (cloudstub.js) stands in for the Edge Function,
// returning the exact { data, error } shape adminAction() itself reads.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

const { OPS, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const DB = makeDB();
assertStubParses(DB);

const ADMIN = '77777777-7777-4777-8777-777777777777';
DB.profiles.push({ id: ADMIN, email: 'lateri@makaman.ly', full_name: 'Later Admin', role: 'admin', status: 'active' });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  // Service workers off: sw.js answers same-origin GETs with its own fetch, and a
  // worker's fetch is invisible to page.route, so the stub below would never be served.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });

  const openCloud = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    await p.route('**/vendor/supabase.umd.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB(DB) }));
    await p.addInitScript(() => {
      window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
    });
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    return p;
  };
  const login = async (p, email) => {
    const i = p.locator('input');
    await i.nth(0).fill(email); await i.nth(1).fill('whatever');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(1500);
  };
  const openDangerZone = (p) => p.evaluate(() => {
    window.__mkApp.setState({ roleTab: 'tickets', adminTab: 'system' });
  });

  // ── nobody but Admin sees the tool at all ───────────────────────────────────────────
  {
    const p = await openCloud();
    await login(p, 'omar@makaman.ly'); // ops_manager
    await openDangerZone(p);
    await p.waitForTimeout(400);
    check('ops_manager never sees the purge tool, even on the System screen',
      await p.getByRole('button', { name: /Purge all test tickets/i }).count() === 0);
    await p.close();
  }

  // ── the full flow, admin ────────────────────────────────────────────────────────────
  const p = await openCloud();
  await login(p, 'lateri@makaman.ly');
  await openDangerZone(p);
  await p.waitForTimeout(400);

  check('Admin sees the purge tool on the System screen',
    await p.getByRole('button', { name: /Purge all test tickets/i }).count() === 1);

  await p.getByRole('button', { name: /Purge all test tickets/i }).click();
  await p.waitForTimeout(300);
  let body = await p.innerText('body');
  check('step 1 states the count and requires the exact phrase',
    /permanently delete/i.test(body) && /DELETE ALL TICKETS/.test(body));

  const phraseField = p.getByPlaceholder('DELETE ALL TICKETS');
  await phraseField.fill('delete all tickets'); // wrong case
  await p.getByRole('button', { name: /^Continue$/ }).click();
  await p.waitForTimeout(300);
  body = await p.innerText('body');
  check('a near-miss phrase is refused, client-side, before any network call',
    /Type "DELETE ALL TICKETS" exactly/i.test(body));
  check('and it did not advance to the password step',
    await p.getByPlaceholder('Your password').count() === 0);

  await phraseField.fill('DELETE ALL TICKETS');
  await p.getByRole('button', { name: /^Continue$/ }).click();
  await p.waitForTimeout(300);
  check('the exact phrase advances to the password step',
    await p.getByPlaceholder('Your password').count() === 1);

  // Wrong password: the server's own refusal, and no advance.
  await p.evaluate(() => {
    window.__invokeFunction = (name, b) => {
      if (name === 'admin-actions' && b.action === 'request_purge_code') {
        return { data: { error: 'That password is incorrect.' }, error: { message: 'That password is incorrect.' } };
      }
      return { data: null, error: { message: 'unexpected call: ' + name + ' ' + b.action } };
    };
  });
  await p.getByPlaceholder('Your password').fill('wrongpass1');
  await p.getByRole('button', { name: /^Send code$/ }).click();
  await p.waitForTimeout(500);
  body = await p.innerText('body');
  check('a wrong password shows the server\'s exact refusal',
    /That password is incorrect\./.test(body));
  check('and stays on the password step, not the code step',
    await p.getByPlaceholder('Your password').count() === 1);

  // Correct password: advances, and the request actually carried it.
  await p.evaluate(() => {
    window.__functionCalls = [];
    window.__invokeFunction = (name, b) => {
      if (name === 'admin-actions' && b.action === 'request_purge_code') return { data: { ok: true }, error: null };
      return { data: null, error: { message: 'unexpected call: ' + name + ' ' + b.action } };
    };
  });
  await p.getByPlaceholder('Your password').fill('correcthorse1');
  await p.getByRole('button', { name: /^Send code$/ }).click();
  await p.waitForTimeout(500);
  check('the correct password advances to the code step',
    await p.getByPlaceholder('000000').count() === 1);
  const sentPwCall = await p.evaluate(() => (window.__functionCalls || []).slice(-1)[0]);
  check('and the real password just typed is what was actually sent',
    sentPwCall && sentPwCall.body.action === 'request_purge_code' && sentPwCall.body.password === 'correcthorse1',
    JSON.stringify(sentPwCall));

  // Resend: reuses the password already entered, does not ask again.
  await p.evaluate(() => { window.__functionCalls = []; });
  await p.getByRole('button', { name: /Resend the code/i }).click();
  await p.waitForTimeout(500);
  const resendCall = await p.evaluate(() => (window.__functionCalls || []).slice(-1)[0]);
  check('resend calls request_purge_code again with the same password, no re-prompt',
    resendCall && resendCall.body.action === 'request_purge_code' && resendCall.body.password === 'correcthorse1',
    JSON.stringify(resendCall));
  check('and the password field was never asked for again',
    await p.getByPlaceholder('Your password').count() === 0);

  // Wrong code: refused, stays on the code step.
  await p.evaluate(() => {
    window.__invokeFunction = (name, b) => {
      if (name === 'admin-actions' && b.action === 'purge_test_tickets') {
        return { data: { error: 'That code is incorrect.' }, error: { message: 'That code is incorrect.' } };
      }
      return { data: null, error: { message: 'unexpected call: ' + name + ' ' + b.action } };
    };
  });
  await p.getByPlaceholder('000000').fill('000000');
  await p.getByRole('button', { name: /Delete every ticket/i }).click();
  await p.waitForTimeout(500);
  body = await p.innerText('body');
  check('a wrong code shows the server\'s exact refusal', /That code is incorrect\./.test(body));
  check('and stays on the code step', await p.getByPlaceholder('000000').count() === 1);

  // Correct code: the confirm phrase is sent alongside it, and the count is shown back.
  // window.__db.tickets cleared here, not after the click, and IN-PAGE rather than on
  // the Node-side DB object: STUB() bakes a one-time JSON snapshot into window.__db when
  // the route is registered (cloudstub.js's own `window.__db = ${JSON.stringify(db)}`),
  // so the Node `DB` variable and the page's fake server are two disconnected copies
  // from that point on — mutating DB here would silently do nothing to what the page's
  // own hydrate() actually reads. Cleared before the click (not after) because the real
  // DELETE runs server-side before the Edge Function's response ever reaches the
  // client, so by the time purgeGo()'s own success handler runs, the server is already
  // at 0 rows — the same order of events a live purge actually has.
  await p.evaluate(() => {
    window.__functionCalls = [];
    window.__invokeFunction = (name, b) => {
      if (name === 'admin-actions' && b.action === 'purge_test_tickets') return { data: { ok: true, deletedCount: 42 }, error: null };
      return { data: null, error: { message: 'unexpected call: ' + name + ' ' + b.action } };
    };
    window.__db.tickets = [];
  });
  await p.getByPlaceholder('000000').fill('123456');
  await p.getByRole('button', { name: /Delete every ticket/i }).click();
  await p.waitForTimeout(1200); // room for refresh()'s own round trip through the stub
  body = await p.innerText('body');
  check('success names how many tickets were actually deleted', /\b42\b.*permanently deleted/i.test(body));
  const finalCall = await p.evaluate(() => (window.__functionCalls || []).slice(-1)[0]);
  check('the confirm phrase and code both travelled with the delete request',
    finalCall && finalCall.body.confirm === 'DELETE ALL TICKETS' && finalCall.body.code === '123456',
    JSON.stringify(finalCall));

  // 2026-09-11, owner's report: withdrawn tickets kept appearing to "survive" a purge.
  // The real Edge Function (verified separately, live) deletes every row unconditionally
  // — deleted_at included, nothing spared — so there was never a scope gap in the
  // delete itself. What was missing is proven here, without ever reloading the page:
  // purge_test_tickets above ran and this device's own local `tickets` still holds the
  // one seeded ticket from before the button was pressed, exactly the shape of the
  // owner's report. If purgeGo() calls refresh() on success, the very next hydrate — the
  // same one login/reconnect/Force Refresh already use — replaces that local array with
  // the server's now-actually-empty one (simulated here by clearing DB.tickets to match
  // what the real delete just did), and the survivor has nowhere left to be shown from.
  const afterRefreshFix = await p.evaluate(() => window.__mkApp.state.data.tickets.length);
  check('purging tells THIS DEVICE too — the local list is re-hydrated, not left stale',
    afterRefreshFix === 0, afterRefreshFix);

  await p.getByRole('button', { name: /^Done$/ }).click();
  await p.waitForTimeout(300);
  check('Done returns to the idle button, ready to be pressed again',
    await p.getByRole('button', { name: /Purge all test tickets/i }).count() === 1);

  // ── cancelling at any step clears everything, nothing lingers in state ──────────────
  await p.getByRole('button', { name: /Purge all test tickets/i }).click();
  await p.waitForTimeout(200);
  await phraseField.fill('DELETE ALL TICKETS');
  await p.getByRole('button', { name: /^Continue$/ }).click();
  await p.waitForTimeout(200);
  await p.getByPlaceholder('Your password').fill('shouldnotlinger');
  await p.getByRole('button', { name: /^Cancel$/ }).click();
  await p.waitForTimeout(200);
  const cleared = await p.evaluate(() => {
    const S = window.__mkApp.state;
    return { step: S.purgeStep, password: S.purgePassword, code: S.purgeCode, confirm: S.purgeConfirmText };
  });
  check('cancelling clears the password rather than leaving it sitting in state',
    cleared.step === 0 && !cleared.password && !cleared.code && !cleared.confirm,
    JSON.stringify(cleared));
  check('and the wall is fully closed again',
    await p.getByRole('button', { name: /Purge all test tickets/i }).count() === 1
      && await p.getByPlaceholder('Your password').count() === 0);

  await p.close();
  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
