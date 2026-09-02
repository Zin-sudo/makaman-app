// The error log, and the two smaller fixes that shipped beside it.
//
// The log exists because "the server would not accept this change from your account" is
// true and useless. It names no change, no rule and no table, and the person reading it
// is at a wellhead rather than in a debugger. Every fault in this project so far has cost
// a screenshot, a description and a round of guessing before anyone could look at the
// right line — the uuid primary key took two reports to place.
//
// So the thing under test is not "does it record something". It is: does the file that
// comes out let somebody fix the bug without asking a single question.
const { chromium } = require('playwright-core');
const { makeDB, STUB } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const P = {
  LATERI: 'ef5a965c-d0e8-4d15-99be-8c96d7091535',
  AWHIDA: '4b7958ce-a880-4d0c-a478-b1c585648b10',
  TECH:   '10c39f80-d975-48d1-968d-692b9362f05a',
};
function db() {
  const DB = makeDB();
  DB.profiles = [
    { id: P.LATERI, email: 'Lateri@makaman.ly', full_name: 'Lateri', role: 'admin', status: 'active', base: 'MKN Headquarters' },
    { id: P.AWHIDA, email: 'awhida@makaman.ly', full_name: 'Abobaker Awhida', role: 'ops_manager', status: 'active', base: 'MKN Operations Base' },
    { id: P.TECH, email: 'tech@makaman.ly', full_name: 'Tech1', role: 'technician', status: 'active', base: 'MKN Operations Base' },
  ];
  return DB;
}
async function signIn(b, DB, email, mode) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  if (mode !== 'local') {
    await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
      status: 200, contentType: 'application/javascript', body: STUB(DB) }));
  }
  await p.addInitScript((m) => {
    window.MAKAMAN_CONFIG = m === 'local' ? { authMode: 'local' }
      : { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
    window.__DRAIN_TEST_MS = 100;
  }, mode || 'cloud');
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill(mode === 'local' ? 'makaman2026' : 'x');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1600);
  return { ctx, p };
}
const openAccount = async (p) => {
  await p.getByText('Account', { exact: true }).first().click();
  await p.waitForTimeout(600);
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // The log, read the way anything else would read it — off the device. Nothing about
  // this is a test hook: it is where the file is built from.
  const log = (p) => p.evaluate(() =>
    JSON.parse(localStorage.getItem('makaman.errorlog.v1') || '[]'));

  // Makes the fake server refuse the next write with a real Postgres sentence, then does
  // something that writes. Driven through the app's own queue rather than by calling the
  // recorder, because what is being tested is that the recorder is WIRED IN — a classifier
  // nothing calls would pass every assertion about classification.
  const refuseWith = async (p, message, table) => {
    await p.evaluate(([msg, tbl]) => {
      window.__failInsert = tbl || 'audit_log';
      window.__failMessage = msg;
    }, [message, table]);
    await p.evaluate(() => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || [])[0];
      if (t) app.logOn(t.id, 'A change made at ' + Date.now() + '.', 'lifecycle');
    });
    // A refused op is retried OUTBOX_TRIES times before it is set aside, which is
    // deliberate — a dropped connection must not look like a rejection. So the queue is
    // driven that far, the way a device with signal would drive it: one drain per
    // attempt. Anything less tests the retry, not the refusal.
    // Drains are exclusive now — a second caller joins the one already running rather
    // than starting its own — so each attempt has to be allowed to finish before the next
    // is asked for. Looping faster than that lands fewer real attempts than iterations
    // and the op never reaches the give-up limit, which made this flaky.
    for (let i = 0; i < 8; i++) {
      await p.evaluate(() => window.__mkApp.refresh().catch(() => {}));
      await p.waitForTimeout(280);
    }
    await p.evaluate(() => { window.__failInsert = ''; window.__failMessage = ''; });
  };

  // ── A real refusal is recorded, with a code that says what it was ──
  {
    const { ctx, p } = await signIn(b, db(), 'awhida@makaman.ly');
    // The exact sentence the office was shown, from the uuid fault.
    await refuseWith(p, 'invalid input syntax for type uuid: "k1787950609277"');
    let l = await log(p);
    check('a refused change reaches the log at all', l.length > 0, l.length + ' entries');
    check('and a wrong-type value is coded MK-SYNC-TYPE',
      l.some((e) => e.code === 'MK-SYNC-TYPE'), l.map((e) => e.code).join(' '));
    check('with the server sentence kept word for word',
      l.some((e) => /invalid input syntax for type uuid: "k1787950609277"/.test(e.raw)));
    check('and the table it was refused on',
      l.some((e) => (e.ctx || {}).table === 'audit_log'), JSON.stringify((l[0] || {}).ctx));

    // Different sentences must not collapse into one code.
    await refuseWith(p, 'new row violates row-level security policy for table "audit_log"');
    await refuseWith(p, 'duplicate key value violates unique constraint "tickets_ticket_number_key"');
    l = await log(p);
    const codes = l.map((e) => e.code);
    check('a policy refusal is MK-SYNC-RLS', codes.indexOf('MK-SYNC-RLS') >= 0, codes.join(' '));
    check('a clashing key is MK-SYNC-DUP', codes.indexOf('MK-SYNC-DUP') >= 0, codes.join(' '));
    check('three different faults are three different codes',
      new Set(codes).size === 3, codes.join(' '));

    // The same fault over and over is one entry saying how many. A file nobody will read
    // is a file nobody will send.
    for (let i = 0; i < 4; i++) {
      await refuseWith(p, 'new row violates row-level security policy for table "audit_log"');
    }
    l = await log(p);
    const worst = Math.max.apply(null, l.map((e) => e.n));
    check('a fault repeated is counted, not repeated',
      l.length === 3 && worst >= 5, l.length + ' entries, worst x' + worst);
    await ctx.close();
  }

  // ── The file itself ──
  {
    const { ctx, p } = await signIn(b, db(), 'awhida@makaman.ly');
    await refuseWith(p, 'invalid input syntax for type uuid: "k1787950609277"');
    const md = await p.evaluate(() => window.__mkApp.errorReport());
    check('it names the build', /\*\*Build:\*\*\s*\S/.test(md));
    check('and who was signed in, with their role',
      /awhida@makaman\.ly/.test(md) && /Ops Manager|ops_manager|mgr/i.test(md));
    check('it leads with the code', /### `MK-SYNC-TYPE`/.test(md));
    check('it says what the app was doing in plain words',
      /Sending a change to the office/.test(md));
    check('and what the failure class means', /wrong type or shape/.test(md));
    // The whole point: the server's own sentence, not the app's paraphrase. That string
    // is what names the column and lets somebody go straight to it.
    check('it quotes the server VERBATIM',
      /invalid input syntax for type uuid: "k1787950609277"/.test(md));
    check('and carries the context that makes it actionable',
      /\*\*table:\*\* `audit_log`/.test(md) && /\*\*action:\*\*/.test(md));
    check('there is a summary table to read first', /\| Code \| Times \|/.test(md));

    // What must NOT be in it. This file gets emailed and pasted around.
    check('no password reaches the file', !/makaman2026|"password"/i.test(md));
    check('and no customer or price does either',
      !/Kuwait Oil Group/.test(md) && !/3\.9/.test(md));
    await ctx.close();
  }

  // ── It is on the Account screen, for every role ──
  for (const [email, who] of [['awhida@makaman.ly', 'the Ops Manager'], ['tech@makaman.ly', 'a technician']]) {
    const { ctx, p } = await signIn(b, db(), email);
    await openAccount(p);
    const seen = await p.evaluate(() => ({
      there: /ERROR LOG/i.test(document.body.innerText),
      download: !!Array.from(document.querySelectorAll('button')).find(x => /DOWNLOAD \.MD/i.test(x.innerText || '')),
      empty: (Array.from(document.querySelectorAll('button')).find(x => /DOWNLOAD \.MD/i.test(x.innerText || '')) || {}).disabled,
    }));
    check(who + ' has the error log on Account', seen.there && seen.download);
    check('and it is inert while there is nothing to send', seen.empty === true);
    await ctx.close();
  }

  // ── Queued work the server can never take does not haunt the device ──
  //
  // The reported symptom: a standing banner reading "10 changes were refused ... invalid
  // input syntax for type uuid: k1787950609277", every session, with no ticket by that
  // name anywhere on the device and no way to clear it. The old repair only looked at
  // ids it could still SEE on a ticket, so an op orphaned by a withdrawal was immortal.
  {
    const { ctx, p } = await signIn(b, db(), 'awhida@makaman.ly');
    await p.evaluate(() => {
      localStorage.setItem('makaman.outbox.v1', JSON.stringify([
        { key: 'tickets:k1787950609277', table: 'tickets', action: 'upsert_ticket', row: { id: 'k1787950609277' } },
        { key: 'ticket_lines:abc', table: 'ticket_lines', action: 'upsert', row: { id: 'abc', ticket_id: 'k1787950609277' } },
        { key: 'numbering_claim', table: 'numbering_claim', action: 'upsert', row: { id: true } },
      ]));
      localStorage.setItem('makaman.outbox.refused.v1', JSON.stringify([
        { at: new Date().toISOString(), why: 'invalid input syntax for type uuid',
          op: { key: 'tickets:k1787950609277', table: 'tickets', row: { id: 'k1787950609277' } } },
      ]));
    });
    // Through a reload, which is where this has to work: the purge runs in the store
    // loader, and the symptom was a banner that came back every single session.
    //
    // Offline for the reload, deliberately. With a live server the good op sends and
    // leaves the queue on its own, so "it is still there" would be unprovable and the
    // assertion below would pass for the wrong reason — the queue would be empty either
    // way. Offline, the only thing that can remove anything is the purge.
    // Set before the page runs, not after: the app starts draining during boot, and
    // switching the fake offline once the reload had settled was already too late — the
    // good op had been tried, retried and set aside, which is the very outcome this is
    // supposed to prove does not happen to it.
    await p.addInitScript(() => { window.__offline = true; });
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(1800);
    const after = await p.evaluate(() => ({
      left: JSON.parse(localStorage.getItem('makaman.outbox.v1') || '[]').map(o => o.key),
      refused: JSON.parse(localStorage.getItem('makaman.outbox.refused.v1') || '[]').length,
      said: document.body.innerText,
    }));
    check('an op naming a ticket id no server can accept is dropped',
      after.left.indexOf('tickets:k1787950609277') < 0, after.left.join(','));
    check('and so is its child row, which named it too',
      after.left.indexOf('ticket_lines:abc') < 0, after.left.join(','));
    check('while a perfectly good op is left alone',
      after.left.indexOf('numbering_claim') >= 0, after.left.join(','));
    check('the standing refusal goes with it', after.refused === 0, String(after.refused));
    check('and the person is told rather than left wondering',
      /queued change\(s\) were cleared|never going to send/i.test(after.said),
      after.said.slice(0, 120).replace(/\n/g, ' '));
    await ctx.close();
  }

  // ── The office can raise a job for itself ──
  {
    const { ctx, p } = await signIn(b, db(), 'awhida@makaman.ly');
    await p.evaluate(() => window.__mkApp.setState({ role: 'mgr', mgrScreen: 'new',
      mgrDraft: { customer: '', field: '', well: '', rig: '', tech: '' } }));
    await p.waitForTimeout(500);
    const opts = await p.evaluate(() => Array.from(document.querySelectorAll('select'))
      .map(s => Array.from(s.options).map(o => o.textContent))
      .find(list => list.some(x => /Select a technician/i.test(x))) || []);
    check('the Ops Manager can assign the job to himself',
      opts.some(o => /Abobaker Awhida/.test(o)), JSON.stringify(opts));
    check('and his own name is marked as such',
      opts.some(o => /\(myself\)/.test(o)), JSON.stringify(opts));
    check('the technicians are still there', opts.some(o => /Tech1/.test(o)), JSON.stringify(opts));
    await ctx.close();
  }

  // ── The customer can be corrected in review ──
  {
    const { ctx, p } = await signIn(b, db(), 'omar@makaman.ly', 'local');
    const before = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || []).find(x => !app.settled(x) && !x.deletedAt);
      app.openReview(t.id);
      return { id: t.id, customer: t.customer, items: (t.items || []).length };
    });
    await p.waitForTimeout(600);
    const has = await p.evaluate(() => /Customer/.test(document.body.innerText));
    check('the office gets a customer control on the review screen', has);

    const changed = await p.evaluate(() => {
      const app = window.__mkApp;
      const cur = (app.state.data.tickets.find(t => t.id === app.state.activeId) || {}).customer;
      const other = (app.state.data.clients || []).map(c => c.name).find(n => n !== cur);
      // Driven through the <select> the binding is wired to, not by writing the store.
      const sel = Array.from(document.querySelectorAll('select')).find(s =>
        Array.from(s.options).some(o => o.textContent === other)
        && Array.from(s.options).some(o => o.textContent === cur));
      if (!sel) return { ok: false, other: other };
      sel.value = other;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, to: other };
    });
    await p.waitForTimeout(800);
    const now = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || []).find(x => x.id === app.state.activeId);
      return {
        customer: t.customer,
        items: (t.items || []).length,
        audit: (t.audit || []).filter(a => /Customer changed/.test(a.text || '')).length,
        said: document.body.innerText,
      };
    });
    check('changing it actually changes the ticket',
      changed.ok && now.customer === changed.to, now.customer + ' vs ' + changed.to);
    // B-13.2: never invent item numbers, never average prices, never drop rows. The lines
    // came off the OLD customer's price list; repricing them here would invent figures
    // nobody agreed, and dropping them would destroy the technician's work.
    check('the charged lines are NOT silently repriced or dropped',
      now.items === before.items, before.items + ' -> ' + now.items);
    check('but the office is told they need checking',
      before.items ? /old price list/i.test(now.said) : true, '');
    check('and the change is in the audit trail', now.audit === 1, String(now.audit));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
