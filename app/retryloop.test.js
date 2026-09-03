// A refusal that can never succeed must not be offered as retryable.
//
// The loop, as it reached the office: three deleted test jobs were still on a phone, each
// naming a technician who had been removed with them, so `tickets` failed
// `tickets_technician_id_fkey` and every row belonging to those jobs failed its own foreign
// key in turn — sixteen dead ops for three dead jobs. They were set aside correctly. Then
// the banner offered RETRY, which re-queues everything with a fresh budget, and sixteen
// guaranteed failures ran again. Banner, retry, sixteen failures, banner. The error log
// climbed 35 -> 38 -> 42 while nothing whatsoever changed.
//
// Retrying a foreign-key failure is not optimism, it is a promise the app cannot keep. A
// dropped connection is a different thing entirely and must still be retryable, so both
// halves are asserted here — a feature that stops working is not a fix.
const { chromium } = require('playwright-core');
const { TICKET, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

const DEAD = '9827d5db-4717-4ad1-b0d2-4f35d22e526a';
const FK_TICKET = 'insert or update on table "tickets" violates foreign key constraint "tickets_technician_id_fkey"';
const FK_CHILD = 'insert or update on table "audit_log" violates foreign key constraint "audit_log_ticket_id_fkey"';

const DB = makeDB();
assertStubParses(DB);

async function boot(b) {
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

const pile = (p) => p.evaluate(() => {
  const acct = (window.__mkApp.state.session || {}).email;
  return JSON.parse(localStorage.getItem(
    'makaman.outbox.refused.v1' + (acct ? '.' + acct.toLowerCase() : '')) || '[]');
});
const queue = (p) => p.evaluate(() => {
  const acct = (window.__mkApp.state.session || {}).email;
  return JSON.parse(localStorage.getItem(
    'makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : '')) || '[]');
});
const banner = (p) => p.evaluate(() => ({
  text: (document.body.innerText.match(/[^\n]*refused[^\n]*/i) || [''])[0],
  retry: !!Array.from(document.querySelectorAll('button')).find(x => /^RETRY$/.test(x.innerText || '')),
  dismiss: !!Array.from(document.querySelectorAll('button')).find(x => /^DISMISS$/.test(x.innerText || '')),
}));
// One dead job's worth of ops, exactly as the real queue held them: the job itself plus the
// rows that belong to it, each its own op with its own key.
const stageDeadJob = (p) => p.evaluate((tid) => {
  const acct = (window.__mkApp.state.session || {}).email;
  const k = 'makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : '');
  localStorage.setItem(k, JSON.stringify([
    { key: 'tickets:' + tid, table: 'tickets', action: 'upsert_ticket', seq: 1, acct: acct,
      row: { id: tid, version: 1, technician_id: '00000000-0000-4000-8000-0000deadbeef' } },
    { key: 'ticket_items:' + tid, table: 'ticket_items', action: 'replace', seq: 2, acct: acct,
      ticketId: tid, rows: [] },
    { key: 'audit_log:a1', table: 'audit_log', action: 'upsert', seq: 3, acct: acct,
      row: { id: 'a1', ticket_id: tid, kind: 'edit', text: 'one' } },
    { key: 'audit_log:a2', table: 'audit_log', action: 'upsert', seq: 4, acct: acct,
      row: { id: 'a2', ticket_id: tid, kind: 'edit', text: 'two' } },
  ]));
}, DEAD);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── A dead job is retired whole, and retry does not re-run it ────────────
  {
    const { ctx, p } = await boot(b);
    await p.evaluate(([t, c]) => {
      window.__failInsert = 'tickets'; window.__failMessage = t;
      window.__failInsert2 = 'audit_log'; window.__failMessage2 = c;
    }, [FK_TICKET, FK_CHILD]);
    await stageDeadJob(p);
    await p.evaluate(() => window.__mkApp.refresh().catch(() => {}));
    await p.waitForTimeout(1200);

    const dead = await pile(p);
    check('the dead job leaves the queue entirely', (await queue(p)).length === 0,
      JSON.stringify((await queue(p)).map(o => o.key)));
    check('and is set aside as ONE job, not one entry per row',
      dead.length === 1, dead.length + ' entries: ' + JSON.stringify(dead.map(d => d.op && d.op.key)));
    check('marked as something that can never be sent',
      dead.every(d => d.terminal === true), JSON.stringify(dead.map(d => d.terminal)));

    // The loop itself: press the banner's action and nothing must go to the server.
    await p.evaluate(() => { window.__writes = []; });
    const b1 = await banner(p);
    check('the banner does not offer RETRY when nothing can be retried',
      b1.retry === false, JSON.stringify(b1));
    check('but it does offer DISMISS, which is the only real option', b1.dismiss === true);

    const n = await p.evaluate(() => window.__mkApp.retryRefusedForTest());
    await p.waitForTimeout(900);
    check('retrying re-queues none of it', n === 0, String(n));
    check('and not one write is attempted', await p.evaluate(() =>
      (window.__writes || []).length) === 0,
      JSON.stringify(await p.evaluate(() => (window.__writes || []).map(w => w.table))));
    check('the record is kept rather than quietly dropped',
      (await pile(p)).length === 1, JSON.stringify((await pile(p)).length));
    await ctx.close();
  }

  // ── A refusal that WAS worth retrying still is ───────────────────────────
  //
  // H1 must not quietly disable the retry that A6 added. A row refused by a policy that an
  // admin has since corrected is exactly the case it exists for.
  {
    const { ctx, p } = await boot(b);
    await p.evaluate(() => {
      window.__failInsert = 'clients';
      window.__failMessage = 'new row violates row-level security policy for table "clients"';
      const acct = (window.__mkApp.state.session || {}).email;
      const k = 'makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : '');
      localStorage.setItem(k, JSON.stringify([
        { key: 'clients:c1', table: 'clients', action: 'upsert', seq: 1, acct: acct,
          row: { id: 'c1', name: 'A customer' } },
      ]));
    });
    // Five refusals to age it out into the pile.
    for (let i = 0; i < 6; i++) {
      await p.evaluate(() => window.__mkApp.refresh().catch(() => {}));
      await p.waitForTimeout(260);
    }
    const dead = await pile(p);
    check('a policy refusal reaches the pile', dead.length === 1, String(dead.length));
    check('and is NOT marked terminal — it might work later',
      dead[0] && dead[0].terminal !== true, JSON.stringify(dead[0] && dead[0].terminal));

    const b2 = await banner(p);
    check('so the banner still offers RETRY for it', b2.retry === true, JSON.stringify(b2));

    // The policy is fixed; the retry must actually send.
    await p.evaluate(() => { window.__failInsert = ''; window.__failMessage = ''; window.__writes = []; });
    const n = await p.evaluate(() => window.__mkApp.retryRefusedForTest());
    await p.waitForTimeout(900);
    check('retrying re-queues it', n === 1, String(n));
    check('and it reaches the server this time', await p.evaluate(() =>
      (window.__writes || []).some(w => w.table === 'clients')) === true);
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
