// The banner used to say "N changes were refused" and then one sentence — the reason on
// the LAST entry in the pile, whichever one that happened to be, regardless of how many
// there were or whether it had anything to do with the rest. The error log export was no
// better: an op only ever carried its table and action, never what it actually WAS or
// which job it belonged to, so "12 failures recorded on this device" answered nothing a
// person could act on without reading raw context fields by hand.
//
// This proves the fix reaches the screen: the banner now lists one row per distinct
// refusal, each one naming the ACTION (opDescribe's verb, reusing opLabel where it
// already has one) and the JOB it belongs to (jobLabel, resolved to a customer name —
// on-screen only; errorlog.test.js already proves the exported .md file stops at the
// ticket number instead, per its own privacy contract).
const { chromium } = require('playwright-core');
const { makeDB, TICKET, STUB, assertStubParses } = require('./cloudstub.js');
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

// Drives one real op all the way into the dead-letter pile through the app's own queue —
// refused OUTBOX_TRIES times, not staged by hand — the same technique deadletter.test.js
// and errorlog.test.js already use.
async function deadLetterOneChange(p, table, message, act) {
  await p.evaluate(([tbl, msg]) => {
    window.__failInsert = tbl;
    window.__failMessage = msg;
  }, [table, message]);
  await p.evaluate(act, [TICKET]);
  for (let i = 0; i < 8; i++) {
    await p.evaluate(() => window.__mkApp.refresh().catch(() => {}));
    await p.waitForTimeout(280);
  }
  await p.evaluate(() => { window.__failInsert = ''; window.__failMessage = ''; });
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── One refusal names the action, the words, and the job ────────────────────────────
  {
    const DB = makeDB();
    assertStubParses(DB);
    const { ctx, p } = await boot(b, DB);
    await deadLetterOneChange(p, 'ticket_notes',
      'new row violates row-level security policy for table "ticket_notes"',
      ([id]) => window.__mkApp.addNote(id, 'Please confirm the mileage on this one.'));
    const body = await p.innerText('body');
    check('the ACTION is named, not just a generic "a change"',
      /Adding a note/.test(body), body.slice(0, 400));
    check('the actual words raised are shown',
      /Please confirm the mileage on this one/.test(body));
    check('the JOB it belongs to is named — the customer, not a bare uuid',
      /Kuwait Oil Group/.test(body) && !new RegExp(TICKET).test(body));
    check('the reason itself is still there too', /has not been confirmed|refused/i.test(body));
    await ctx.close();
  }

  // ── Two distinct refusals show as two distinct rows, not one blended sentence ───────
  {
    const DB = makeDB();
    assertStubParses(DB);
    const { ctx, p } = await boot(b, DB);
    await deadLetterOneChange(p, 'ticket_notes',
      'new row violates row-level security policy for table "ticket_notes"',
      ([id]) => window.__mkApp.addNote(id, 'First distinct note.'));
    await deadLetterOneChange(p, 'audit_log',
      'new row violates row-level security policy for table "audit_log"',
      ([id]) => window.__mkApp.logOn(id, 'A distinct audit line.', 'lifecycle'));
    const body = await p.innerText('body');
    check('the first refusal is named', /Adding a note/.test(body) && /First distinct note/.test(body));
    check('the second refusal is ALSO named, separately',
      /Recording an audit entry/.test(body) && /A distinct audit line/.test(body));
    const count = await p.evaluate(() => {
      const acct = (window.__mkApp.state.session || {}).email;
      const key = 'makaman.outbox.refused.v1' + (acct ? '.' + acct.toLowerCase() : '');
      return JSON.parse(localStorage.getItem(key) || '[]').length;
    });
    check('and the pile really does hold two distinct entries, not one', count === 2, String(count));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
