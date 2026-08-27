// Signed paperwork coming back: the Service Ticket and the Job Log the client signs and
// stamps and returns, collected per ticket number once the office has approved the job.
//
// Not a general attachment box, and the difference is the whole feature. Three rules
// carry it, and each is checked from both sides:
//   - Nothing before approval. There is no signed paperwork yet.
//   - Only the technician who DID the job, or the office. A technician who can merely see
//     the ticket is not part of this.
//   - Each file says which of the two documents it is, because "pending" is unanswerable
//     otherwise — and pending is what the office chases.
//
// It is also the one feature that cannot work offline: everything else queues in the
// outbox and drains later, but a 15MB scan does not fit in a 5MB quota (B-19.1). So the
// assertions are as much about what does NOT happen — nothing queued, no bytes in the
// replica, no orphan in the bucket when a write fails — as about the upload itself.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const { TECH, OPS, CLIENT, TICKET, JOB, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const DB = makeDB();
assertStubParses(DB);

const PDF = (bytes, name) => ({ name: name || 'signed-service-ticket.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(bytes, 0x41) });

// A technician who did NOT do this job. The rule is "the technician who did the job", not
// "a technician", and nothing checks the difference unless somebody else exists.
const OTHER = '66666666-6666-4666-8666-666666666666';
DB.profiles.push({ id: OTHER, email: 'mahmoud@makaman.ly', full_name: 'Mahmoud Zaki', role: 'technician', status: 'active' });
// The job is approved: that is when collecting the paperwork begins.
Object.assign(DB.tickets[0], { status: 'approved', ticket_number: '1883', approved_by: OPS, approved_at: '2026-08-20T09:00:00.000Z' });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  // Service workers off: sw.js answers same-origin GETs with its own fetch, and a worker's
  // fetch is invisible to page.route, so the stub would never be served.
  const ctx = await browser.newContext({ viewport: { width: 1240, height: 1100 }, serviceWorkers: 'block' });

  const openCloud = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    await p.route('**/vendor/supabase.umd.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB(DB) }));
    await p.addInitScript(() => {
      window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
      window.__DRAIN_TEST_MS = 120;
      // window.open would spawn a real tab; recorded instead so the signed link can be
      // read back and checked.
      window.__opened = [];
      window.open = function (u) { window.__opened.push(u); return null; };
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
    await p.waitForTimeout(1800);
  };
  const openTicket = async (p) => {
    await p.evaluate(() => {
      const app = window.__mkApp;
      const t = app.state.data.tickets[0];
      app.setState({ activeId: t.id, mgrScreen: 'review', techScreen: 'log', roleTab: 'tickets' });
    });
    await p.waitForTimeout(800);
  };
  const slots = (p) => p.locator('input[type=file]');

  // ── the panel names the two documents it is waiting for ─────────────────────────────
  const p = await openCloud();
  await login(p, 'yousef@makaman.ly');
  await openTicket(p);
  let body = await p.innerText('body');
  // innerText applies text-transform, so headings arrive uppercased.
  check('the ticket has a signed-paperwork panel', /SIGNED PAPERWORK/.test(body));
  check('and it names the Service Ticket by name', /Signed Service Ticket/.test(body));
  check('and the Job Log by name', /Signed Job Log/.test(body));
  check('both start as awaited, not as a vague empty list',
    (body.match(/AWAITED/g) || []).length === 2, JSON.stringify((body.match(/AWAITED/g) || []).length));
  check('the panel says how many are outstanding', /Awaiting 2 of 2/.test(body));
  check('there is one send control per document', await slots(p).count() === 2,
    String(await slots(p).count()));

  // ── the technician who did the job sends the Service Ticket back ────────────────────
  await slots(p).nth(0).setInputFiles(PDF(2048));
  await p.waitForTimeout(1800);

  const up = await p.evaluate(() => window.__uploads);
  check('the bytes go to the private attachments bucket', up.length === 1 && up[0].bucket === 'attachments', JSON.stringify(up.length));
  check('under a path whose FIRST segment is the ticket id — the storage policy keys on it',
    up.length === 1 && up[0].path.split('/')[0] === TICKET, up[0] && up[0].path);
  check('not under the client\'s own filename, which would be a guessable object key',
    up.length === 1 && !/signed-service-ticket/.test(up[0].path), up[0] && up[0].path);

  const row = await p.evaluate(() => (window.__db.ticket_attachments || [])[0]);
  check('the row records WHICH document this is', !!row && row.doc_kind === 'service_ticket',
    row ? row.doc_kind : 'no row');
  check('with its name, size and who sent it',
    !!row && row.filename === 'signed-service-ticket.pdf' && row.bytes === 2048 && row.uploaded_by === TECH,
    JSON.stringify(row && { f: row.filename, b: row.bytes }));

  // The audit trail is what notifications derive from, so this is also what tells the
  // office a document arrived — no second wiring.
  const audit = await p.evaluate(() => (window.__db.audit_log || []).map(a => a.text || ''));
  check('the audit trail names the document, not just "a file"',
    audit.some(x => /sent back the Signed Service Ticket/.test(x)), JSON.stringify(audit));

  body = await p.innerText('body');
  check('the Service Ticket now reads as received', /RECEIVED/.test(body));
  check('and the panel says one is still outstanding', /Awaiting 1 of 2/.test(body));

  // ── the second document completes it ────────────────────────────────────────────────
  await slots(p).nth(1).setInputFiles(PDF(3072, 'signed-job-log.pdf'));
  await p.waitForTimeout(1800);
  const kinds = await p.evaluate(() => (window.__db.ticket_attachments || []).map(a => a.doc_kind).sort());
  check('the job log is stored as the job log, not as a second service ticket',
    JSON.stringify(kinds) === JSON.stringify(['job_log', 'service_ticket']), JSON.stringify(kinds));
  body = await p.innerText('body');
  check('with both in, the ticket reads as complete', /Both received/.test(body));
  check('and nothing is left reading as awaited', !/AWAITED/.test(body));

  // ── opening one goes through a link that expires ────────────────────────────────────
  await p.getByRole('button', { name: /^OPEN$/ }).first().click();
  await p.waitForTimeout(600);
  const signed = await p.evaluate(() => window.__signed);
  check('opening mints a signed URL rather than using a stored one', signed.length === 1 && signed[0].bucket === 'attachments');
  check('and that link expires — 60 seconds, as the master export does (B-12.4)',
    signed.length === 1 && signed[0].ttl === 60, signed[0] && String(signed[0].ttl));
  check('the browser is handed the link, so the bytes never pass through this app',
    (await p.evaluate(() => window.__opened)).length === 1);

  // ── the bytes never enter the replica ───────────────────────────────────────────────
  const cached = await p.evaluate(() => {
    let hit = false;
    for (let i = 0; i < localStorage.length; i++) {
      const v = localStorage.getItem(localStorage.key(i)) || '';
      if (/signed-service-ticket\.pdf/.test(v)) hit = true;
      if (/AAAAAAAAAAAAAAAAAAAA/.test(v) || /data:application\/pdf/.test(v)) return { bytes: true };
    }
    return { bytes: false, name: hit };
  });
  check('the file\'s BYTES are never written to localStorage — that is why this needs signal', !cached.bytes);
  check('but its name is, so a technician down a hole still sees what came back', cached.name === true);
  check('nothing was queued in the outbox for the paperwork itself',
    !(await p.evaluate(() => JSON.parse(localStorage.getItem('makaman.outbox.v1') || '[]')))
      .some(o => /attachment/.test(o.table || '')));

  // ── what is refused, and refused before anything is written ─────────────────────────
  const upCount = () => p.evaluate(() => window.__uploads.length);
  const before = await upCount();

  await slots(p).nth(0).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await p.waitForTimeout(900);
  check('a type the bucket does not accept is refused, with nothing uploaded', await upCount() === before);
  check('and the person is told why', /Only PDFs and photos/.test(await p.innerText('body')));

  await slots(p).nth(0).setInputFiles({ name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) });
  await p.waitForTimeout(900);
  check('an empty file is refused — no CHECK in the table would accept it', await upCount() === before);

  await slots(p).nth(0).setInputFiles(PDF(15728641));
  await p.waitForTimeout(1600);
  check('one byte over the bucket limit is refused before the upload starts', await upCount() === before);
  check('and the refusal names the actual size, not just "too big"', /15\.0 MB/.test(await p.innerText('body')));

  // ── a failed row write must not leave bytes behind ──────────────────────────────────
  await p.evaluate(() => { window.__failInsert = 'ticket_attachments'; });
  await p.evaluate(() => { window.__removed = []; });
  await slots(p).nth(0).setInputFiles(PDF(4096));
  await p.waitForTimeout(1800);
  const orphan = await p.evaluate(() => ({ up: window.__uploads.length, removed: window.__removed }));
  check('when the row is refused, the uploaded object is deleted again',
    orphan.removed.length === 1 && orphan.up === before + 1, JSON.stringify(orphan.removed.length));
  check('so the bucket never holds bytes nobody can see, list or delete',
    orphan.removed[0] && orphan.removed[0].path === (await p.evaluate(() => window.__uploads[window.__uploads.length - 1].path)));
  await p.evaluate(() => { window.__failInsert = ''; });

  // ── with no signal, the control says so BEFORE a file is chosen ─────────────────────
  await p.evaluate(() => { window.__mkApp.setState({ online: false }); });
  await p.waitForTimeout(500);
  check('offline, the send control is disabled', await slots(p).first().isDisabled());
  check('and says a scan cannot wait in the queue the way a job log can',
    /cannot wait in the queue/.test(await p.innerText('body')));
  await p.evaluate(() => { window.__mkApp.setState({ online: true }); });
  await p.waitForTimeout(400);
  check('a technician is not offered REMOVE — withdrawing signed paperwork is the office\'s call',
    await p.getByRole('button', { name: /^REMOVE$/ }).count() === 0);
  await p.close();

  // ── nothing before approval ─────────────────────────────────────────────────────────
  const p2 = await openCloud();
  await p2.evaluate(() => { window.__db.tickets[0].status = 'logging'; });
  await login(p2, 'yousef@makaman.ly');
  await openTicket(p2);
  const pre = await p2.innerText('body');
  check('before approval there is no send control at all', await slots(p2).count() === 0,
    String(await slots(p2).count()));
  check('and the panel explains why rather than just showing nothing',
    /once the office approves the job/.test(pre));
  check('the summary says the paperwork comes later, not that it is missing', /After approval/.test(pre));
  await p2.close();

  // ── a technician who did not do the job ─────────────────────────────────────────────
  const p3 = await openCloud();
  await login(p3, 'mahmoud@makaman.ly');
  await openTicket(p3);
  check('another technician gets no send control on somebody else\'s job',
    await slots(p3).count() === 0, String(await slots(p3).count()));
  check('and is told the rule rather than left guessing',
    /Only the technician who did this job/.test(await p3.innerText('body')));
  // The screen refusing is not the same as the app refusing. Drive the action directly.
  const forced = await p3.evaluate(async () => {
    const app = window.__mkApp;
    const t = app.state.data.tickets[0];
    const f = new File([new Uint8Array(64)], 'sneaky.pdf', { type: 'application/pdf' });
    const n = window.__uploads.length;
    await app.attachFile(t.id, f, 'service_ticket');
    return { grew: window.__uploads.length - n };
  });
  check('and calling it directly is refused too, not merely hidden', forced.grew === 0, String(forced.grew));
  await p3.close();

  // ── the office chases what has not come back ────────────────────────────────────────
  const p4 = await openCloud();
  await p4.evaluate(() => { window.__db.ticket_attachments.length = 0; });
  await login(p4, 'omar@makaman.ly');
  await p4.waitForTimeout(600);
  let inbox = await p4.innerText('body');
  check('the office sees an approved job with no paperwork back on its inbox',
    /still waiting on its signed paperwork|still waiting on their signed paperwork/.test(inbox), '');
  check('and the chase list names WHICH documents are missing',
    /Signed Service Ticket · Signed Job Log/.test(inbox));
  check('and names the ticket number so it can be chased', /1883/.test(inbox));

  // One arrives; the chase list narrows rather than clearing.
  await p4.evaluate(([tid, ops]) => {
    window.__db.ticket_attachments.push({ id: 'a-svc', ticket_id: tid, path: tid + '/s.pdf',
      filename: 'signed-service-ticket.pdf', mime: 'application/pdf', bytes: 2048,
      uploaded_by: ops, uploaded_at: '2026-08-21T09:00:00.000Z', doc_kind: 'service_ticket' });
  }, [TICKET, OPS]);
  await p4.evaluate(() => window.__mkApp.refresh());
  await p4.waitForTimeout(1500);
  inbox = await p4.innerText('body');
  check('with one document in, the chase list still lists the other',
    /Signed Job Log/.test(inbox) && !/Signed Service Ticket · Signed Job Log/.test(inbox));

  // Both in; the job leaves the list entirely.
  await p4.evaluate(([tid, ops]) => {
    window.__db.ticket_attachments.push({ id: 'a-log', ticket_id: tid, path: tid + '/l.pdf',
      filename: 'signed-job-log.pdf', mime: 'application/pdf', bytes: 3072,
      uploaded_by: ops, uploaded_at: '2026-08-21T09:30:00.000Z', doc_kind: 'job_log' });
  }, [TICKET, OPS]);
  await p4.evaluate(() => window.__mkApp.refresh());
  await p4.waitForTimeout(1500);
  inbox = await p4.innerText('body');
  check('once both are in the job drops off the chase list',
    !/still waiting on its signed paperwork|still waiting on their signed paperwork/.test(inbox));

  // The office may withdraw a wrong scan; the technician may not.
  await openTicket(p4);
  check('the office IS offered REMOVE', await p4.getByRole('button', { name: /^REMOVE$/ }).count() === 2,
    String(await p4.getByRole('button', { name: /^REMOVE$/ }).count()));
  await p4.close();

  // ── a build with no office connection is honest about it ────────────────────────────
  const p5 = await ctx.newPage();
  p5.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p5.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p5.goto(URL, { waitUntil: 'networkidle' });
  await p5.waitForTimeout(300);
  await p5.evaluate(() => localStorage.clear());
  await p5.reload({ waitUntil: 'networkidle' });
  await p5.waitForTimeout(800);
  const i5 = p5.locator('input');
  await i5.nth(0).fill('omar@makaman.ly'); await i5.nth(1).fill('makaman2026');
  await p5.getByRole('button', { name: /log in/i }).click();
  await p5.waitForTimeout(1400);
  await p5.evaluate(() => {
    const app = window.__mkApp;
    const t = app.state.data.tickets.find(x => x.status === 'approved') || app.state.data.tickets[0];
    app.setState({ activeId: t.id, mgrScreen: 'review', techScreen: 'log', roleTab: 'tickets' });
  });
  await p5.waitForTimeout(900);
  const n5 = await p5.locator('input[type=file]').count();
  check('in a build with no backend the control is disabled rather than misleading',
    n5 === 0 || await p5.locator('input[type=file]').first().isDisabled(), String(n5));
  await p5.close();

  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
