// Two faults the office reported, both about a thing that looked done and was not.
//
//  1. "Lateri gave Awhida the numbering claim; Awhida sees it as nobody has it."
//     The claim reaches the database as holder_id, resolved from the holder's email. When
//     that lookup came up empty the app sent NULL — and null in that column does not mean
//     "we could not tell", it means NOBODY HOLDS IT. So a hand-over that could not be
//     expressed was written as a hand-over to no one, and the app said it had worked.
//
//  2. "A ticket Lateri created and assigned to Tech1 didn't reach anyone."
//     It never reached the database: the insert policy required technician_id = auth.uid(),
//     so raising a job in somebody else's name was refused by RLS while the app showed it
//     locally and queued it. Fixed in migration 0042 and verified there by impersonation;
//     what is asserted here is the client half — that the row the app queues names the
//     technician it was raised for, which is the thing the policy now permits.
const { chromium } = require('playwright-core');
const { makeDB, STUB } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

// The five real accounts as the live database holds them, capital L and all — the
// spelling matters, because the claim is resolved through the email.
const P = {
  LATERI: 'ef5a965c-d0e8-4d15-99be-8c96d7091535',
  OBS:    '7bc6a9e0-b3ba-480a-a0be-4a85f91f7dce',
  AWHIDA: '4b7958ce-a880-4d0c-a478-b1c585648b10',
  OPS:    '75317356-ba12-470d-8307-4fdc6a069d52',
  TECH:   '10c39f80-d975-48d1-968d-692b9362f05a',
};
function db() {
  const DB = makeDB();
  DB.profiles = [
    { id: P.LATERI, email: 'Lateri@makaman.ly', full_name: 'Lateri', role: 'admin', status: 'active', base: 'MKN Headquarters' },
    { id: P.OBS, email: 'obs@makaman.ly', full_name: 'Obs', role: 'founder', status: 'active', base: 'MKN Headquarters' },
    { id: P.AWHIDA, email: 'awhida@makaman.ly', full_name: 'Abobaker Awhida', role: 'ops_manager', status: 'active', base: 'MKN Operations Base' },
    { id: P.OPS, email: 'ops@makaman.ly', full_name: 'Ops', role: 'ops_manager', status: 'active', base: 'MKN Operations Base' },
    { id: P.TECH, email: 'tech@makaman.ly', full_name: 'Tech1', role: 'technician', status: 'active', base: 'MKN Operations Base' },
  ];
  DB.numbering_claim = [{ id: true, holder_id: null, since: '2026-08-20T13:28:30.000Z' }];
  DB.tickets = []; DB.ticket_lines = []; DB.ticket_crew = []; DB.audit_log = [];
  return DB;
}

async function signIn(b, DB, email) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 980 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: STUB(DB) }));
  await p.addInitScript(() => {
    window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
    window.__DRAIN_TEST_MS = 100;
  });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('x');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1700);
  return { ctx, p };
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── The claim reaches the database as a person ──
  {
    const DB = db();
    const { ctx, p } = await signIn(b, DB, 'lateri@makaman.ly');
    // Signed in at all: the live project spells this profile with a capital L while the
    // app sends what was typed, lower case. GoTrue does not care and neither may we.
    check('an address stored with different case still signs in',
      await p.evaluate(() => !!(window.__mkApp.state.session || {}).email));

    const before = await p.evaluate(() => JSON.stringify(window.__db.numbering_claim));
    check('the claim starts held by nobody', /"holder_id":null/.test(before), before);

    await p.evaluate(() => window.__mkApp.mutate((d) => {
      d.numbering = { holderEmail: 'awhida@makaman.ly', holderName: 'Abobaker Awhida',
        since: new Date().toISOString(), history: [] };
    }));
    await p.waitForTimeout(900);
    const after = await p.evaluate(() => window.__db.numbering_claim[0]);
    check('handing it over writes a person, not a null',
      after.holder_id === P.AWHIDA, JSON.stringify(after.holder_id));

    // And the other side of it: Awhida must read it back as his.
    const seen = await p.evaluate(() => window.__mkApp.hydrateForTest().then((d) => d.numbering));
    check('and it reads back as the person it was given to',
      seen && seen.holderName === 'Abobaker Awhida', JSON.stringify(seen));
    await ctx.close();
  }

  // ── A claim that cannot be expressed is refused, not written as "nobody" ──
  {
    const DB = db();
    DB.numbering_claim = [{ id: true, holder_id: P.AWHIDA, since: '2026-08-20T13:28:30.000Z' }];
    const { ctx, p } = await signIn(b, DB, 'lateri@makaman.ly');
    const held = await p.evaluate(() => window.__db.numbering_claim[0].holder_id);
    check('the claim starts held by somebody', held === P.AWHIDA, String(held));

    // Somebody the device knows a name for and nothing else — never synced, no id, no
    // email. This is the shape that used to clear the claim.
    await p.evaluate(() => window.__mkApp.mutate((d) => {
      d.numbering = { holderEmail: '', holderName: 'Someone Not On The Server',
        since: new Date().toISOString(), history: [] };
    }));
    await p.waitForTimeout(900);
    const still = await p.evaluate(() => window.__db.numbering_claim[0].holder_id);
    check('a holder that cannot be resolved NEVER clears the claim',
      still === P.AWHIDA, String(still));
    await ctx.close();
  }

  // ── Releasing it is still allowed to mean nobody ──
  //
  // The rule is not "never write null", it is "null only when null is what is meant".
  {
    const DB = db();
    DB.numbering_claim = [{ id: true, holder_id: P.AWHIDA, since: '2026-08-20T13:28:30.000Z' }];
    const { ctx, p } = await signIn(b, DB, 'lateri@makaman.ly');
    await p.evaluate(() => window.__mkApp.mutate((d) => {
      d.numbering = { holderEmail: '', holderName: '', since: new Date().toISOString(), history: [] };
    }));
    await p.waitForTimeout(900);
    const released = await p.evaluate(() => window.__db.numbering_claim[0].holder_id);
    check('giving the claim up does write nobody', released === null, String(released));
    await ctx.close();
  }

  // ── The office raises a ticket for a technician ──
  {
    const DB = db();
    const { ctx, p } = await signIn(b, DB, 'lateri@makaman.ly');
    await p.evaluate(() => {
      window.__mkApp.setState({ role: 'mgr', mgrScreen: 'new',
        mgrDraft: { customer: 'Kuwait Oil Group', field: 'BURGAN', well: 'BG-1', rig: 'WS-1', tech: 'Tech1' } });
    });
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /raise ticket/i }).click();
    await p.waitForTimeout(1200);

    const row = await p.evaluate(() => (window.__db.tickets || [])[0] || null);
    check('the ticket reaches the server at all', !!row);
    // The heart of it. The row names Tech1, not the admin who raised it — which is what
    // the old insert policy refused and what 0042 now permits.
    check('and it names the technician it was raised FOR',
      row && row.technician_id === P.TECH, row && row.technician_id);
    check('who also holds it', row && row.holder_id === P.TECH, row && row.holder_id);
    // A real uuid, because tickets.id is a uuid column — the fault that meant nothing
    // ever synced. Guarded here too, since this is the other create path.
    check('with a real uuid for a primary key',
      row && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id),
      row && row.id);
    check('and nothing is left stuck in the outbox', await p.evaluate(() =>
      JSON.parse(localStorage.getItem('makaman.outbox.v1') || '[]').length === 0));
    await ctx.close();
  }

  // ── Tech1 sees it, and so does the office ──
  {
    const DB = db();
    const { ctx, p } = await signIn(b, DB, 'lateri@makaman.ly');
    await p.evaluate(() => {
      window.__mkApp.setState({ role: 'mgr', mgrScreen: 'new',
        mgrDraft: { customer: 'Kuwait Oil Group', field: 'BURGAN', well: 'BG-1', rig: 'WS-1', tech: 'Tech1' } });
    });
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /raise ticket/i }).click();
    await p.waitForTimeout(1200);
    // The fake server lives inside the page, so "the same server" means carrying its
    // state out and seeding the next page with it. Without this each role would be
    // looking at its own private database and the test would prove nothing about
    // whether a ticket reaches anyone.
    const server = await p.evaluate(() => window.__db);
    await ctx.close();

    // Tech1, on his own device, signing in fresh against the same server.
    const t = await signIn(b, server, 'tech@makaman.ly');
    const mine = await t.p.evaluate(() =>
      (window.__mkApp.state.data.tickets || []).map((x) => ({ tech: x.tech, well: x.well })));
    check('the technician it was raised for finds it waiting',
      mine.some((x) => x.tech === 'Tech1' && x.well === 'BG-1'), JSON.stringify(mine));
    await t.ctx.close();

    const a = await signIn(b, server, 'awhida@makaman.ly');
    const ops = await a.p.evaluate(() =>
      (window.__mkApp.state.data.tickets || []).map((x) => x.well));
    check('and the Ops Manager sees it in the office inbox',
      ops.indexOf('BG-1') >= 0, JSON.stringify(ops));
    await a.ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
