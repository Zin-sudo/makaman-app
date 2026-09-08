// The top-bar Force Refresh button. A circular icon left of the notifications bell,
// same CSS, same 40px target — but its own class (mk-topbar-icon-btn), not .mk-bell:
// notify.test.js locates the actual bell as `.mk-bell` alone, and giving the refresh
// button that same class made it the FIRST .mk-bell in the bar and broke that lookup
// outright, caught while wiring this up.
//
// What this proves: the click is a genuine server reach (a real round trip, not a
// re-render), the icon spins for exactly the duration of that reach and stops at a
// definitive terminal state either way, a second click while one is already running is
// ignored rather than starting a second request, a failure is communicated rather than
// swallowed, and none of it touches the outbox — a pending queued change survives a
// force refresh, whether that refresh itself succeeds or fails.
const { chromium } = require('playwright-core');
const { TECH, TICKET, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
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
  await i.nth(0).fill('yousef@makaman.ly'); await i.nth(1).fill('whatever');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1500);
  return { ctx, p };
}
const refreshBtn = (p) => p.getByRole('button', { name: 'Refresh current tab' });
const isSpinning = (p) => p.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find(x => x.getAttribute('aria-label') === 'Refresh current tab');
  return !!(b && b.querySelector('svg') && b.querySelector('svg').classList.contains('mk-spin'));
});
const rtt = (p) => p.evaluate(() => window.__rtt || 0);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── Present, labelled, reaches the server for real, and spins only while it does ────
  {
    const DB = makeDB();
    assertStubParses(DB);
    const { ctx, p } = await boot(b, DB);

    check('the button is on screen with the accessible label the spec names',
      await refreshBtn(p).isVisible());
    check('it is not spinning at rest', !(await isSpinning(p)));

    // Slowed down for this one check only: the fake server otherwise resolves so many
    // microtasks in a row that a click-then-immediately-check misses the busy window
    // entirely — real about a fast connection, not about whether the spin logic works.
    await p.evaluate(() => { window.__stubLatency = 300; });
    const before = await rtt(p);
    await refreshBtn(p).click();
    check('the icon is spinning while the request is genuinely still in flight',
      await isSpinning(p));
    await p.waitForTimeout(900);
    check('and stops once the request actually settles', !(await isSpinning(p)));
    const after = await rtt(p);
    check('a real round trip happened — this is a server reach, not a re-render',
      after > before, `${before} -> ${after}`);
    await p.evaluate(() => { window.__stubLatency = 0; });

    // The connectivity read-out lives on the Sync tab, not wherever the click happened
    // to be made from.
    await p.evaluate(() => window.__mkApp.setState({ roleTab: 'sync' }));
    await p.waitForTimeout(200);
    check('the connectivity read-out on the Sync tab reflects it',
      /Last Force Refresh reached the server/.test(await p.innerText('body')));
    await ctx.close();
  }

  // ── A second call while one is already running is ignored, not queued ──────────────
  {
    const DB = makeDB();
    assertStubParses(DB);
    const { ctx, p } = await boot(b, DB);

    await p.evaluate(() => { window.__stubLatency = 300; });
    const before = await rtt(p);
    // The DOM `disabled` attribute already stops a real second tap at the browser level
    // — this calls the bound method directly instead, so what is actually under test is
    // refreshCurrentTab's OWN guard (`if (this.state.refreshBusy) return;`), not merely
    // that a disabled button ignores clicks.
    await p.evaluate(() => { window.__mkApp.refreshCurrentTab(); window.__mkApp.refreshCurrentTab(); });
    await p.waitForTimeout(900);
    await p.evaluate(() => { window.__stubLatency = 0; });
    const after = await rtt(p);
    check('duplicate calls collapse to exactly one refresh, not two',
      after - before <= 20, `${before} -> ${after} (one full hydrate reads several tables)`);
    await ctx.close();
  }

  // ── Failure is communicated, not swallowed, and nothing is left mid-spin ────────────
  {
    const DB = makeDB();
    assertStubParses(DB);
    const { ctx, p } = await boot(b, DB);

    await p.evaluate(() => { window.__offline = true; });
    await refreshBtn(p).click();
    await p.waitForTimeout(500);
    check('the spin stops at the failure — not left spinning forever', !(await isSpinning(p)));
    const body = await p.innerText('body');
    check('the failure reaches the person, attributed to Refresh specifically, in the same plain language errors use elsewhere',
      /Refresh —/.test(body) && /could not be reached|network|offline/i.test(body));
    await p.evaluate(() => { window.__offline = false; });
    await ctx.close();
  }

  // ── A pending queued change survives a force refresh, success or failure alike ──────
  {
    const DB = makeDB();
    assertStubParses(DB);
    const { ctx, p } = await boot(b, DB);

    // Queue a real offline edit the ordinary way.
    await p.evaluate(() => { window.__offline = true; });
    await p.evaluate(([id]) => window.__mkApp.mutate(d => { d.tickets.find(t => t.id === id).rig = 'RIG-FORCED'; }), [TICKET]);
    await p.waitForTimeout(400);
    const outboxOf = () => p.evaluate(() => {
      const acct = (window.__mkApp.state.session || {}).email;
      return JSON.parse(localStorage.getItem('makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : '')) || '[]');
    });
    let q = await outboxOf();
    check('the edit is queued before any refresh happens', q.some(o => o.table === 'tickets'), JSON.stringify(q.map(o => o.key)));

    // Force refresh while STILL offline: it fails, but must not destroy the queue.
    await refreshBtn(p).click();
    await p.waitForTimeout(500);
    q = await outboxOf();
    check('a FAILED force refresh does not reset or destroy the pending queue',
      q.some(o => o.table === 'tickets'), JSON.stringify(q.map(o => o.key)));

    // Reconnect and force-refresh again: refreshCore() drains before it pulls, so the
    // queued edit reaches the server as part of the same action, not a duplicate of it.
    await p.evaluate(() => { window.__offline = false; });
    await refreshBtn(p).click();
    await p.waitForTimeout(800);
    q = await outboxOf();
    check('a SUCCESSFUL force refresh drains the queue rather than duplicating or dropping it',
      q.length === 0, JSON.stringify(q.map(o => o.key)));
    const serverTicket = await p.evaluate(([id]) => window.__db.tickets.find(t => t.id === id), [TICKET]);
    check('and the queued edit actually reached the database',
      serverTicket.rig_name === 'RIG-FORCED', serverTicket.rig_name);
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
