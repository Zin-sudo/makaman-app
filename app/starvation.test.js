// One dead row must not stop everything behind it.
//
// The bug, exactly as it reached the office: an audit-log entry was queued against a ticket
// that had since been deleted, so it failed its foreign key and could never succeed. The
// drain stopped at it — `step()` returned without recursing while the op was still under
// its retry limit — and the numbering-claim handover sitting behind it was never ATTEMPTED.
// Not refused, not misfiled, not the wrong shape. Never reached. Three separate fixes went
// into the claim itself while the thing blocking it was an unrelated dead row.
//
// The dependency the old behaviour protected is real — a job's child rows cannot be written
// before the job itself — but it is per TICKET, not global. A numbering claim depends on no
// ticket at all.
//
// So this drives the exact shape of the failure: something permanently refused, with
// unrelated work queued behind it, and the question is whether that work still goes.
const { chromium } = require('playwright-core');
const { TECH, TICKET, OPS, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
// The claim starts with somebody ELSE, so handing it to OPS is a change that can be seen.
// Left on OPS it would read the same before and after and prove nothing either way.
function db() { const d = makeDB(); d.numbering_claim = [{ id: true, holder_id: TECH,
  since: '2026-08-31T23:03:53.000Z' }]; assertStubParses(d); return d; }
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

const FK = 'insert or update on table "audit_log" violates foreign key constraint "audit_log_ticket_id_fkey"';

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
  await p.waitForTimeout(1700);
  return { ctx, p };
}

// Puts a permanently-failing op at the head of the queue and a numbering-claim op behind
// it, by hand, so the ORDER is the thing under test and not an accident of timing.
const stage = (p, deadTable, deadKey) => p.evaluate(([tbl, key, ticketId, opsId]) => {
  const acct = (window.__mkApp.state.session || {}).email;
  const k = 'makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : '');
  localStorage.setItem(k, JSON.stringify([
    // Refused for ever: its ticket is gone from the server.
    { key: key, table: tbl, action: 'upsert', seq: 1, acct: acct,
      row: { id: 'dead-row-1', ticket_id: ticketId, kind: 'edit', text: 'orphaned' } },
    // Depends on nothing, and on no ticket at all.
    { key: 'numbering_claim', table: 'numbering_claim', action: 'update', id: true, seq: 2,
      acct: acct, row: { holder_id: opsId, since: new Date().toISOString() } },
  ]));
}, [deadTable, deadKey, '00000000-0000-4000-8000-00000000dead', OPS]);

const claimHolder = (p) => p.evaluate(() =>
  ((window.__db.numbering_claim || [])[0] || {}).holder_id || null);
const queueKeys = (p) => p.evaluate(() => {
  const acct = (window.__mkApp.state.session || {}).email;
  return JSON.parse(localStorage.getItem(
    'makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : '')) || '[]').map(o => o.key);
});
const pile = (p) => p.evaluate(() => {
  const acct = (window.__mkApp.state.session || {}).email;
  return JSON.parse(localStorage.getItem(
    'makaman.outbox.refused.v1' + (acct ? '.' + acct.toLowerCase() : '')) || '[]');
});

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── The handover goes even though a dead row is ahead of it ──────────────
  {
    const { ctx, p } = await boot(b, db());
    await p.evaluate((msg) => {
      window.__failInsert = 'audit_log';
      window.__failMessage = msg;
    }, FK);
    await stage(p, 'audit_log', 'audit_log:dead-row-1');

    const before = await claimHolder(p);
    await p.evaluate(() => window.__mkApp.refresh().catch(() => {}));
    await p.waitForTimeout(1200);
    const after = await claimHolder(p);

    check('the claim behind a permanently-refused op is still sent',
      after === OPS && after !== before, 'holder ' + JSON.stringify(before) + ' -> ' + JSON.stringify(after));
    check('and it leaves the queue, because it actually went',
      (await queueKeys(p)).indexOf('numbering_claim') < 0,
      JSON.stringify(await queueKeys(p)));
    await ctx.close();
  }

  // ── A foreign-key refusal is given up on at once, not five times ─────────
  //
  // Retrying cannot help: the row it points at is not there. Five attempts is five more
  // chances for a permanent failure to be mistaken for a flaky connection.
  {
    const { ctx, p } = await boot(b, db());
    await p.evaluate((msg) => {
      window.__failInsert = 'audit_log';
      window.__failMessage = msg;
    }, FK);
    await stage(p, 'audit_log', 'audit_log:dead-row-1');

    await p.evaluate(() => window.__mkApp.refresh().catch(() => {}));
    await p.waitForTimeout(1000);

    const dead = await pile(p);
    check('one drain is enough to set it aside', dead.length === 1,
      dead.length + ' in the pile');
    check('and the queue is not still carrying it',
      (await queueKeys(p)).indexOf('audit_log:dead-row-1') < 0,
      JSON.stringify(await queueKeys(p)));
    check('the refusal names the job it belonged to, not just the table',
      !!(dead[0] && dead[0].op && (dead[0].op.row || {}).ticket_id),
      JSON.stringify(dead[0] && dead[0].why));
    check('and says the job is gone rather than blaming the account',
      !!(dead[0] && /no longer on the server|not on the server|belongs to/i.test(dead[0].why || '')),
      JSON.stringify(dead[0] && dead[0].why));
    await ctx.close();
  }

  // ── The real dependency still holds: same ticket stays in order ──────────
  //
  // G1 must not become "send everything regardless". A child row still must not be written
  // ahead of the job it belongs to.
  {
    const { ctx, p } = await boot(b, db());
    await p.evaluate((tid) => {
      window.__failInsert = 'tickets';
      window.__failMessage = 'insert or update on table "tickets" violates row-level security policy';
      const acct = (window.__mkApp.state.session || {}).email;
      const k = 'makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : '');
      localStorage.setItem(k, JSON.stringify([
        { key: 'tickets:' + tid, table: 'tickets', action: 'upsert', seq: 1, acct: acct,
          row: { id: tid, well_no: 'BLOCKED' } },
        // Same ticket: must wait behind its parent.
        { key: 'ticket_lines:child-1', table: 'ticket_lines', action: 'upsert', seq: 2,
          acct: acct, row: { id: 'child-1', ticket_id: tid, text: 'a line' } },
      ]));
      window.__writes = [];
    }, TICKET);

    await p.evaluate(() => window.__mkApp.refresh().catch(() => {}));
    await p.waitForTimeout(1000);
    const wrote = await p.evaluate(() =>
      (window.__writes || []).filter(w => w.table === 'ticket_lines').length);
    check('a child row is still held back behind its own failing ticket', wrote === 0,
      wrote + ' ticket_lines writes');
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
