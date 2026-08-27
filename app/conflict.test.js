// S11 / B8 — a sync conflict is flagged, never resolved by overwriting.
//
// The case: a technician edits a job with no signal while the office edits the same job.
// Until now the last device to reach the server won and nothing anywhere said a change
// had been lost. The settled-ticket case was closed earlier (a closed or approved job
// cannot be overwritten from the field); this is the general one, for a job both sides
// are still working on.
//
// Every ticket row carries a version. The client sends the version its edit was made
// against and the update is conditioned on it, so a stale edit matches no row at all.
// What these assertions are really about is the difference between the three outcomes the
// app must tell apart: taken, somebody-got-there-first, and this-ticket-does-not-exist-
// yet. Confusing the last two would throw away every ticket a technician raises offline,
// so it is checked directly.
//
// The fake client comes from cloudstub.js, shared with cloud.test.js and
// attachments.test.js. It was copied at first, and the copies drifted inside one session:
// a fix to insert() landed in one and not the others, and this suite spent a debugging
// cycle failing for a reason that had already been fixed ten feet away.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const { TECH, OPS, CLIENT, TICKET, JOB, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const DB = makeDB();
assertStubParses(DB);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1240, height: 1000 }, serviceWorkers: 'block' });

  const open = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    await p.route('**/vendor/supabase.umd.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB(DB) }));
    await p.addInitScript(() => {
      window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
      window.__DRAIN_TEST_MS = 120;
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
    await p.waitForTimeout(1700);
  };
  const dbTicket = (p) => p.evaluate(([id]) => window.__db.tickets.find(r => r.id === id), [TICKET]);
  const setAside = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('makaman.outbox.refused.v1') || '[]'));
  const outbox = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('makaman.outbox.v1') || '[]'));

  // ── the version reaches the device at all ───────────────────────────────────────────
  const p = await open();
  await login(p, 'yousef@makaman.ly');
  let v = await p.evaluate(([id]) => (window.__mkApp.state.data.tickets.find(t => t.id === id) || {}).version, [TICKET]);
  check('a ticket arrives carrying the version it was read at', v === 1, String(v));

  // ── an ordinary edit is taken, and the device learns the new version ────────────────
  await p.evaluate(([id]) => window.__mkApp.mutate(d => { d.tickets.find(t => t.id === id).rig = 'RIG-A'; }), [TICKET]);
  await p.waitForTimeout(1200);
  check('an uncontested edit reaches the database', (await dbTicket(p)).rig_name === 'RIG-A', (await dbTicket(p)).rig_name);
  check('and the server moves the row on', (await dbTicket(p)).version === 2, String((await dbTicket(p)).version));
  v = await p.evaluate(([id]) => (window.__mkApp.state.data.tickets.find(t => t.id === id) || {}).version, [TICKET]);
  check('the device adopts the new version rather than staying a step behind', v === 2, String(v));

  // This is the trap the echo exists for. Without it the SECOND edit to any ticket would
  // be refused as a conflict with the first: the server moves on, the background drain
  // never re-hydrates, and every device would jam after one write.
  await p.evaluate(([id]) => window.__mkApp.mutate(d => { d.tickets.find(t => t.id === id).rig = 'RIG-B'; }), [TICKET]);
  await p.waitForTimeout(1200);
  check('so a SECOND edit is taken too, and does not conflict with the first',
    (await dbTicket(p)).rig_name === 'RIG-B', (await dbTicket(p)).rig_name);
  check('nothing was set aside for an edit that was accepted', (await setAside(p)).length === 0);

  // ── the office changes the job while the technician is out of signal ────────────────
  await p.evaluate(() => { window.__offline = true; });
  await p.evaluate(([id]) => window.__mkApp.mutate(d => { d.tickets.find(t => t.id === id).well = 'FIELD-EDIT'; }), [TICKET]);
  await p.waitForTimeout(900);
  check('the technician\'s edit is on his device immediately',
    await p.evaluate(([id]) => window.__mkApp.state.data.tickets.find(t => t.id === id).well, [TICKET]) === 'FIELD-EDIT');
  check('and queued rather than dropped', (await outbox(p)).length > 0);

  // The office, meanwhile, writes to the same row directly.
  await p.evaluate(([id]) => {
    const r = window.__db.tickets.find(t => t.id === id);
    r.well_no = 'OFFICE-EDIT'; r.version = r.version + 1;
  }, [TICKET]);

  await p.evaluate(() => { window.__offline = false; });
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await p.waitForTimeout(2200);

  const after = await dbTicket(p);
  check('the office\'s change survives — the field copy did NOT overwrite it',
    after.well_no === 'OFFICE-EDIT', after.well_no);

  const dead = await setAside(p);
  check('and the refused change is kept rather than lost in silence', dead.length === 1, JSON.stringify(dead.length));
  check('with a reason a person can act on, not a constraint name',
    dead.length === 1 && /changed this job while you were out of signal/.test(dead[0].why || ''),
    dead.length ? (dead[0].why || '').slice(0, 70) : '');
  check('the ticket it refused is named in what was set aside',
    dead.length === 1 && (dead[0].op || {}).key === 'tickets:' + TICKET,
    dead.length ? (dead[0].op || {}).key : '');
  check('the queue is not left jammed behind it', (await outbox(p)).length === 0,
    JSON.stringify((await outbox(p)).map(o => o.key)));

  // A conflict cannot be retried into success, so it must not spend five attempts
  // looking like a flaky network first.
  // Not "tries === 1": the op legitimately failed once while the network was down, which
  // is a retryable failure and should be retried. What matters is that the CONFLICT did
  // not then spend the remaining attempts looking like a flaky connection — five refusals
  // that cannot succeed is five chances to mistake a lost change for a slow one.
  const tries = await p.evaluate(() => JSON.parse(localStorage.getItem('makaman.outbox.refused.v1') || '[]')[0].op.tries);
  check('a conflict is set aside at once rather than burning through every retry',
    tries < 5, tries + ' of 5 attempts used');

  check('and the person is told, on every screen, until they have seen it',
    /changed this job while you were out of signal/.test(await p.innerText('body')));

  // ── a ticket that does not exist on the server yet is NOT a conflict ────────────────
  // The same "no row matched" answer covers both, and treating them alike would throw
  // away every job a technician raises out of coverage.
  const fresh = await p.evaluate(() => {
    const app = window.__mkApp;
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const t = app.state.data.tickets[0];
    app.mutate(d => {
      d.tickets.push(Object.assign({}, JSON.parse(JSON.stringify(t)), {
        id: id, well: 'NEW-OFFLINE', version: 1, events: [], items: [], audit: [], notes: [], attachments: [],
      }));
    });
    return id;
  });
  await p.waitForTimeout(2000);
  const born = await p.evaluate(([id]) => window.__db.tickets.find(r => r.id === id), [fresh]);
  check('a ticket raised on the device is inserted, not refused as a conflict', !!born, born ? born.well_no : 'absent');
  check('and nothing extra was set aside for it', (await setAside(p)).length === 1,
    JSON.stringify((await setAside(p)).length));

  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
