// A settled ticket's own field copy never sending was not the bug — discarding it was.
//
// 2026-09-10, reported live: TechTest's own approved ticket (#1881) generated 26+
// "Field copy discarded on sync" notifications and a dead-letter banner ("Updating the
// ticket... Ticket already approved and can no longer be edited") that kept reappearing
// within minutes of being dismissed. Root cause: syncClosedTickets' own reconciliation for
// a clashed (settled/office-closed) ticket used to set `x.synced = true` — a HEADER field
// (rowTicket sends synced/synced_at) — so marking a stale field copy as "handled" was
// itself a write to an approved ticket's header, refused every time by
// enforce_ticket_update_rules() exactly like any other technician edit to a sealed ticket.
// The refusal didn't matter for what the code was trying to do locally — except the next
// hydrate() rebuilds every ticket from server columns alone (shapeTicket) and carries
// nothing local forward, so the server's real, never-actually-written `synced` value (still
// false) landed straight back over the local optimistic flip. The ticket looked "pending"
// again on the very next sync cycle, discarded itself again, queued the same doomed header
// write again — forever, once every sync/hydrate cycle, on this or any device that ever
// hits it.
//
// Fixed by never writing to the header for this at all: a dedicated, never-synced,
// per-account localStorage record (syncDiscardedAdd/syncDiscardedHas) that a hydrate can
// never see or touch. This file proves the loop is actually broken — across a real
// drain-and-hydrate cycle against the cloud stub, not just a single local check — and that
// Dismiss gives an already-stuck device the same fix immediately rather than waiting for
// the next cycle.
const { chromium } = require('playwright-core');
const { IDS, TICKET, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
assertStubParses();
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
  await i.nth(0).fill('yousef@makaman.ly'); await i.nth(1).fill('x');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1600);
  return { ctx, p };
}
const discardedIds = (p) => p.evaluate(() => {
  const acct = (window.__mkApp.state.session || {}).email;
  const key = 'makaman.sync.discarded.v1' + (acct ? '.' + acct.toLowerCase() : '');
  return JSON.parse(localStorage.getItem(key) || '[]');
});
const deadLetterCount = (p) => p.evaluate(() => {
  const acct = (window.__mkApp.state.session || {}).email;
  const key = 'makaman.outbox.refused.v1' + (acct ? '.' + acct.toLowerCase() : '');
  return JSON.parse(localStorage.getItem(key) || '[]').length;
});
const auditCount = (p) => p.evaluate((id) => {
  const t = window.__mkApp.state.data.tickets.find(x => x.id === id);
  return (t.audit || []).filter(a => /Field copy discarded on sync/.test(a.text)).length;
}, TICKET);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── The loop itself: discard, hydrate, and it must NOT come back ────────────────────
  {
    const DB = makeDB();
    // The server's own truth: approved, and this device's field copy was never actually
    // written (synced stays false forever — nothing will ever make the header write that
    // would set it true succeed once the ticket is sealed).
    Object.assign(DB.tickets[0], {
      status: 'approved', synced: false, synced_at: null,
      approved_by: IDS.OPS, approved_at: '2026-09-01T09:00:00.000Z',
    });
    const { ctx, p } = await boot(b, DB);
    check('the field copy starts pending, matching the live incident',
      await p.evaluate((id) => window.__mkApp.state.data.tickets.find(x => x.id === id).synced === false, TICKET));

    await p.evaluate(() => { window.__writes = []; });
    await p.evaluate(() => window.__mkApp.renderVals().sync());
    await p.waitForTimeout(900);

    const writesAfterFirstSync = await p.evaluate(() => window.__writes.slice());
    check('the discard never attempts a write to the ticket header',
      !writesAfterFirstSync.some(w => w.table === 'tickets'), JSON.stringify(writesAfterFirstSync));
    check('the discard is recorded once', await auditCount(p) === 1);
    check('and the ticket is in the sync-discarded record',
      (await discardedIds(p)).indexOf(TICKET) !== -1);
    check('nothing was dead-lettered by this — it was never queued in the first place',
      await deadLetterCount(p) === 0);

    // The actual regression: pull fresh data from the server (still synced:false, since
    // nothing was ever written there) the way a real hydrate/reconnect does, and confirm
    // the ticket does NOT reappear as pending on the very next sync pass.
    await p.evaluate(() => window.__mkApp.refresh().catch(() => {}));
    await p.waitForTimeout(500);
    check('after a real hydrate, the sync-discarded record survived it',
      (await discardedIds(p)).indexOf(TICKET) !== -1);

    await p.evaluate(() => window.__mkApp.renderVals().sync());
    await p.waitForTimeout(900);
    check('and a second sync pass writes no second discard entry — the loop is broken',
      await auditCount(p) === 1, 'audit discard count: ' + await auditCount(p));
    check('still no header write attempted on the second pass either',
      !(await p.evaluate(() => window.__writes.slice())).some(w => w.table === 'tickets'));
    await ctx.close();
  }

  // ── Dismiss gives an already-stuck device the same fix immediately ──────────────────
  {
    const DB = makeDB();
    Object.assign(DB.tickets[0], {
      status: 'approved', synced: false, synced_at: null,
      approved_by: IDS.OPS, approved_at: '2026-09-01T09:00:00.000Z',
    });
    const { ctx, p } = await boot(b, DB);
    // Model a device that already hit this before the fix shipped: a dead-lettered LOCKED
    // refusal sitting on record for this exact ticket, and no sync-discarded record yet.
    await p.evaluate((id) => {
      const acct = (window.__mkApp.state.session || {}).email;
      const key = 'makaman.outbox.refused.v1' + (acct ? '.' + acct.toLowerCase() : '');
      localStorage.setItem(key, JSON.stringify([{
        at: new Date().toISOString(),
        op: { key: 'tickets:' + id, table: 'tickets', action: 'upsert_ticket', row: { id } },
        why: 'Ticket already approved and can no longer be edited. Nothing to retry; if the '
          + 'change still needs to happen, it has to be made from the review screen in the office.',
        n: 3, terminal: true,
      }]));
    }, TICKET);
    await p.evaluate(() => window.__mkApp.setState({ tick: Date.now() }));
    await p.waitForTimeout(400);
    check('the stale banner is showing, matching the live incident',
      /has been refused by the server/i.test(await p.innerText('body')));

    await p.getByRole('button', { name: /^DISMISS$/ }).click();
    await p.waitForTimeout(300);
    await p.getByRole('button', { name: /^Give up on them$/ }).click();
    await p.waitForTimeout(400);

    check('dismissing clears the dead-letter pile', await deadLetterCount(p) === 0);
    check('and immediately records the ticket as sync-discarded — not on the next cycle',
      (await discardedIds(p)).indexOf(TICKET) !== -1);

    // The device's field copy is still locally unsynced (it always was) — pressing Sync
    // right after dismissing must not bring the banner straight back. Compared against
    // whatever the count already was the moment Dismiss finished (an automatic background
    // pass — "hooked into refresh and the realtime pipeline" — may already have run once
    // by then), not assumed to be zero: what matters is that THIS explicit call adds none.
    const beforeThisSync = await auditCount(p);
    await p.evaluate(() => { window.__writes = []; });
    await p.evaluate(() => window.__mkApp.renderVals().sync());
    await p.waitForTimeout(900);
    check('and a sync pass right afterwards writes no fresh discard or header write',
      await auditCount(p) === beforeThisSync
        && !(await p.evaluate(() => window.__writes.slice())).some(w => w.table === 'tickets'),
      'audit discard count before/after: ' + beforeThisSync + '/' + await auditCount(p));
    check('the banner stays gone', !/has been refused by the server/i.test(await p.innerText('body')));
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
