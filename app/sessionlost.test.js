// Live report, 2026-09-09: a technician's own Self-check showed "Auth session missing!"
// and every other line failing the same way ("permission denied for function
// current_role", "permission denied for function my_permissions", "Tickets visible: "
// blank) while the app kept rendering as if she were still signed in. Hitting Force
// Refresh produced "Refresh — The database refused it under a row-level security policy
// — the signed-in account is not permitted to write that row" — the wrong diagnosis for
// a read, and one with nothing to retry: current_role()/is_staff()/my_permissions()/
// has_permission() are granted EXECUTE to `authenticated` only (confirmed against the
// real grants), never `anon`, so "permission denied for function X" from any of them can
// only mean the request went out as anon — the session is gone, not merely refused one
// row.
//
// This proves errorKind() now tells the two apart and that either refresh path — the
// Force Refresh button, or the passive background one (boot, reconnect, the autosync
// tick) — recovers by signing the device out cleanly with an honest message, rather than
// leaving someone stuck re-reading the same wrong banner on every future refresh.
const { chromium } = require('playwright-core');
const { TECH, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function boot(b, DB) {
  const ctx = await b.newContext({ viewport: { width: 420, height: 900 }, serviceWorkers: 'block' });
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
  return { ctx, p };
}
const isSignedIn = (p) => p.evaluate(() => !!window.__mkApp.state.session);
const authError = (p) => p.evaluate(() => window.__mkApp.state.authError || '');
const sessionKey = (p) => p.evaluate(() => localStorage.getItem('makaman.jobtickets.session.v1'));

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── errorKind() tells a dead session apart from an ordinary RLS refusal ─────────────
  {
    const DB = makeDB();
    assertStubParses(DB);
    const { ctx, p } = await boot(b, DB);
    const kind = await p.evaluate(() => window.__mkApp.errorKindForTest({
      message: 'permission denied for function current_role' }));
    check('errorKind classifies a helper-function permission refusal as NOSESSION, not RLS',
      kind === 'NOSESSION', kind);
    const stillRls = await p.evaluate(() => window.__mkApp.errorKindForTest({
      message: 'new row violates row-level security policy for table "tickets"' }));
    check('and an ordinary RLS violation is still classified as RLS, unaffected',
      stillRls === 'RLS', stillRls);
    await ctx.close();
  }

  // ── Force Refresh recovers instead of repeating the wrong banner ────────────────────
  {
    const DB = makeDB();
    assertStubParses(DB);
    const { ctx, p } = await boot(b, DB);
    check('signed in to start with', await isSignedIn(p));

    // Every table's plain select now fails exactly the way an anon request actually
    // would — this is what the technician's own device was doing on every read.
    await p.evaluate(() => {
      window.__failSelect = { '*': 'permission denied for function current_role' };
    });
    await p.getByRole('button', { name: 'Refresh current tab' }).click();
    await p.waitForTimeout(1200);

    check('the device is signed out rather than left looking signed in over a dead session',
      !(await isSignedIn(p)));
    check('and told the true reason, not "not permitted to write that row"',
      /expired at the server/i.test(await authError(p)), await authError(p));
    check('the local session is actually cleared, not just hidden for this render',
      !(await sessionKey(p)));
    await ctx.close();
  }

  // ── The passive/background refresh path recovers the same way, unprompted ──────────
  {
    const DB = makeDB();
    assertStubParses(DB);
    const { ctx, p } = await boot(b, DB);
    check('signed in to start with', await isSignedIn(p));

    await p.evaluate(() => {
      window.__failSelect = { '*': 'permission denied for function is_staff' };
    });
    // The same event netListener already uses to trigger the passive refresh() —
    // nobody has to press anything for this path to matter.
    await p.evaluate(() => window.dispatchEvent(new Event('online')));
    await p.waitForTimeout(1200);

    check('a dead session recovers on its own, without the person ever touching Refresh',
      !(await isSignedIn(p)));
    check('with the same honest reason',
      /expired at the server/i.test(await authError(p)), await authError(p));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
