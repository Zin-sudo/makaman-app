// Attachments: the signed sheet coming back, a photo of the wellhead, a third-party
// invoice.
//
// This is the one feature in the app that cannot work offline, and most of what needs
// checking follows from that. Everything else a person does with no signal lands in the
// outbox and drains later; a file cannot, because the outbox lives in localStorage and a
// 15MB photo does not fit in a 5MB quota (B-19.1 is the record of what happens when
// something tries). So the assertions are as much about what does NOT happen — nothing
// queued, no bytes in the replica, no orphan left in the bucket when a write fails — as
// about the upload itself.
//
// The fake implements the storage surface as well as the query builder, and records every
// call, so the checks can be about what actually crossed the wire rather than about how
// the screen looked afterwards.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const TECH = '11111111-1111-4111-8111-111111111111';
const OPS = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const TICKET = '44444444-4444-4444-8444-444444444444';
const JOB = '55555555-5555-4555-8555-555555555555';

const DB = {
  profiles: [
    { id: TECH, email: 'yousef@makaman.ly', full_name: 'Yousef Al-Harbi', role: 'technician', status: 'active' },
    { id: OPS, email: 'omar@makaman.ly', full_name: 'Omar Al-Saleh', role: 'ops_manager', status: 'active' },
  ],
  clients: [{ id: CLIENT, name: 'Kuwait Oil Group', currency: 'USD' }],
  price_list_items: [],
  job_types: [{ id: JOB, name: 'RBP FOR CEMENT JOB' }],
  ticket_numbering: [{ id: 'n1', prefix: '', label: 'Special Tools', next_number: 1883, floor: 1883 }],
  org_defaults: [{ id: true, base_location: 'Ahmadi Base', customer_rep: 'Workover Office' }],
  asset_questions: [],
  numbering_claim: [{ id: true, holder_id: OPS, since: '2026-08-01T00:00:00.000Z' }],
  user_settings: [{ user_id: TECH, theme: 'dark', accent: 'red', timezone: 'Africa/Tripoli', hour12: false, share_location: true }],
  tickets: [{
    id: TICKET, technician_id: TECH, holder_id: TECH, client_id: CLIENT, job_type_id: JOB,
    customer: 'Kuwait Oil Group', field_name: 'Burgan North', well_no: 'BG-214', rig_name: 'WS-11',
    arrival_at: '2026-08-19T06:20:00.000Z', start_job_at: '2026-08-19T06:48:00.000Z', end_job_at: null,
    status: 'logging', synced: false, synced_at: null, ticket_number: null, mileage_one_way: null,
    currency: 'USD', base_location: 'Ahmadi Base', customer_rep: 'Workover Office',
    office_closed: false, closed_by: null, closed_at: null, approved_by: null, approved_at: null,
    geo_open: null, geo_last: null, geo_pinged_at: null, asset_check: null,
  }],
  ticket_lines: [{ id: 'l1', ticket_id: TICKET, logged_at: '2026-08-19T06:48:00.000Z', text: 'On location, JSA completed.', edited_by: null, edited_at: null }],
  ticket_items: [],
  ticket_assets: [],
  ticket_crew: [{ ticket_id: TICKET, profile_id: TECH, position: 0 }],
  audit_log: [],
  ticket_notes: [],
  ticket_attachments: [],
};

// Same shape as cloud.test.js's fake, plus the storage surface. Every upload, removal and
// signed-URL request is recorded, and two fault knobs let the failure paths be driven
// rather than reasoned about: __failUpload and __failInsert.
const STUB = (db) => `
window.__writes = [];
window.__uploads = [];
window.__removed = [];
window.__signed = [];
window.__db = ${JSON.stringify(db)};
window.__offline = false;
window.__failUpload = false;
window.__failInsert = '';
window.supabase = {
  createClient: function () {
    var db = window.__db;
    function fail() { return Promise.resolve({ data: null, error: { message: 'network down' } }); }
    function q(table) {
      var rows = db[table] || (db[table] = []);
      return {
        select: function () {
          var filtered = rows.slice();
          var chain = {
            eq: function (col, val) { filtered = filtered.filter(function (r) { return r[col] === val; }); return chain; },
            order: function (col, opts) {
              var asc = !(opts && opts.ascending === false);
              filtered = filtered.slice().sort(function (a, b) {
                var x = a[col], y = b[col];
                if (x === y) return 0;
                return (x > y ? 1 : -1) * (asc ? 1 : -1);
              });
              return chain;
            },
            limit: function (n) { filtered = filtered.slice(0, n); return chain; },
            single: function () {
              if (window.__offline) return fail();
              return Promise.resolve(filtered.length ? { data: filtered[0], error: null } : { data: null, error: { message: 'no rows' } });
            },
            then: function (ok, no) {
              return (window.__offline ? fail() : Promise.resolve({ data: filtered, error: null })).then(ok, no);
            },
          };
          return new Proxy(chain, {
            get: function (target, prop) {
              if (prop in target || typeof prop === 'symbol') return target[prop];
              throw new Error('attachments.test.js stub has no .' + String(prop) + '() on select');
            },
          });
        },
        upsert: function (row, opts) {
          if (window.__offline) return fail();
          window.__writes.push({ table: table, action: 'upsert' });
          var key = (opts && opts.onConflict) || (table === 'user_settings' ? 'user_id' : 'id');
          var at = -1;
          for (var i = 0; i < rows.length; i++) if (rows[i][key] === row[key]) { at = i; break; }
          if (at >= 0) rows[at] = Object.assign({}, rows[at], row); else rows.push(row);
          return Promise.resolve({ data: [row], error: null });
        },
        insert: function (rs) {
          if (window.__offline) return fail();
          if (window.__failInsert === table) return Promise.resolve({ data: null, error: { message: 'row refused by the database' } });
          var list = rs.length ? rs : [rs];
          window.__writes.push({ table: table, action: 'insert', rows: list });
          list.forEach(function (r) { rows.push(Object.assign({ id: 'row-' + rows.length }, r)); });
          return Promise.resolve({ data: list, error: null });
        },
        delete: function () {
          return { eq: function (col, val) {
            if (window.__offline) return fail();
            window.__writes.push({ table: table, action: 'delete', col: col, val: val });
            db[table] = rows.filter(function (r) { return r[col] !== val; });
            return Promise.resolve({ data: null, error: null });
          } };
        },
      };
    }
    return {
      rpc: function () { return window.__offline ? fail() : Promise.resolve({ data: [], error: null }); },
      auth: {
        signInWithPassword: function (c) {
          if (window.__offline) return fail();
          var p = db.profiles.filter(function (r) { return r.email === c.email; })[0];
          return Promise.resolve(p ? { data: { user: { id: p.id } }, error: null } : { error: { message: 'Invalid login credentials' } });
        },
        signOut: function () { return Promise.resolve({ error: null }); },
        signUp: function () { return Promise.resolve({ data: {}, error: null }); },
      },
      storage: {
        from: function (bucket) {
          return {
            upload: function (path, file, opts) {
              if (window.__failUpload) return Promise.resolve({ data: null, error: { message: 'bucket refused' } });
              window.__uploads.push({ bucket: bucket, path: path, size: file.size, type: (opts || {}).contentType, upsert: (opts || {}).upsert });
              return Promise.resolve({ data: { path: path }, error: null });
            },
            remove: function (paths) {
              paths.forEach(function (x) { window.__removed.push({ bucket: bucket, path: x }); });
              return Promise.resolve({ data: [], error: null });
            },
            createSignedUrl: function (path, ttl) {
              window.__signed.push({ bucket: bucket, path: path, ttl: ttl });
              return Promise.resolve({ data: { signedUrl: 'https://stub.test/object/sign/' + path + '?token=abc' }, error: null });
            },
          };
        },
      },
      from: q,
    };
  },
};`;

// A stray backtick truncates the injected literal and leaves the page with no
// window.supabase at all — the suite then tests seeded defaults while printing PASS.
// Parsing it here turns that into one loud line before a browser is opened.
(function assertStubParses() {
  const out = STUB(DB);
  if (/`/.test(out)) { console.error('  FATAL  the injected stub contains a backtick, which truncates it'); process.exit(1); }
  try { new Function(out); } catch (e) { console.error('  FATAL  the injected stub does not parse: ' + e.message); process.exit(1); }
})();

const PDF = (bytes) => ({ name: 'signed-ticket.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(bytes, 0x41) });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  // Service workers off: sw.js answers same-origin GETs with its own fetch, and a worker's
  // fetch is invisible to page.route, so the stub would never be served.
  const ctx = await browser.newContext({ viewport: { width: 1240, height: 1000 }, serviceWorkers: 'block' });

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

  // ── the panel is there, and says what it is ─────────────────────────────────────────
  const p = await openCloud();
  await login(p, 'yousef@makaman.ly');
  await openTicket(p);
  // innerText applies text-transform, so the heading reads ATTACHMENTS on screen even
  // though the markup says Attachments.
  let body = await p.innerText('body');
  check('the ticket carries an attachments panel', /ATTACHMENTS/.test(body));
  check('and says so when there is nothing on it', /Nothing attached to this ticket/.test(body));
  check('the file control is on the page for a technician', await p.locator('input[type=file]').count() === 1);
  // The input itself is moved out of sight so the panel is not carrying the browser's own
  // grey chip. That only works if something visible replaces it — an invisible input with
  // nothing to click would pass every other check in this file.
  check('and there is something visible to press', /ATTACH A FILE/.test(await p.innerText('body')));
  // Measured, not asked. Playwright calls a 1x1 clipped element "visible" because it has
  // a box — which is its definition, not a person's. The box is the thing to check.
  const inputBox = await p.locator('input[type=file]').boundingBox();
  check('while the input itself occupies no visible area, only the label does',
    !!inputBox && inputBox.width <= 2 && inputBox.height <= 2, JSON.stringify(inputBox));

  // ── attaching one ───────────────────────────────────────────────────────────────────
  await p.locator('input[type=file]').setInputFiles(PDF(2048));
  await p.waitForTimeout(1800);

  const up = await p.evaluate(() => window.__uploads);
  check('the bytes go to the private attachments bucket', up.length === 1 && up[0].bucket === 'attachments', JSON.stringify(up));
  check('under a path whose FIRST segment is the ticket id — the storage policy keys on it',
    up.length === 1 && up[0].path.split('/')[0] === '44444444-4444-4444-8444-444444444444', up[0] && up[0].path);
  check('not under the client\'s own filename, which would be a guessable object key',
    up.length === 1 && !/signed-ticket/.test(up[0].path), up[0] && up[0].path);
  check('with the content type declared and upsert refused',
    up.length === 1 && up[0].type === 'application/pdf' && up[0].upsert === false, JSON.stringify(up[0]));

  const row = await p.evaluate(() => (window.__db.ticket_attachments || [])[0]);
  check('a row records what was attached', !!row && row.filename === 'signed-ticket.pdf', JSON.stringify(row));
  check('with its size and type, and the person who attached it',
    !!row && row.bytes === 2048 && row.mime === 'application/pdf' && row.uploaded_by === TECH, JSON.stringify(row));
  check('and it points at the object that was uploaded',
    !!row && !!up[0] && row.path === up[0].path);
  check('nothing was left in the bucket without a row pointing at it',
    (await p.evaluate(() => window.__removed)).length === 0);

  // The audit trail is what notifications are derived from, so recording the attachment
  // there is also what tells the office a signed sheet arrived — no second wiring.
  const audit = await p.evaluate(() => (window.__db.audit_log || []).map(a => a.text || a.detail || ''));
  check('the attachment is recorded in the audit trail, so the office is told',
    audit.some(x => /attached signed-ticket\.pdf/.test(x)), JSON.stringify(audit));

  // ── it shows, and it opens through a link that expires ───────────────────────────────
  body = await p.innerText('body');
  check('the file is listed by name', /signed-ticket\.pdf/.test(body));
  check('with who and how big', /Yousef Al-Harbi/.test(body) && /2 KB/.test(body));

  await p.getByRole('button', { name: /^OPEN$/ }).first().click();
  await p.waitForTimeout(600);
  const signed = await p.evaluate(() => window.__signed);
  check('opening it mints a signed URL rather than using a stored one', signed.length === 1 && signed[0].bucket === 'attachments');
  check('and that link expires — 60 seconds, as the master export does (B-12.4)',
    signed.length === 1 && signed[0].ttl === 60, signed[0] && String(signed[0].ttl));
  const opened = await p.evaluate(() => window.__opened);
  check('the browser is handed the link, so the bytes never pass through this app',
    opened.length === 1 && /object\/sign\//.test(opened[0]));

  // ── the bytes never enter the replica ───────────────────────────────────────────────
  const cached = await p.evaluate(() => {
    let n = 0, hit = false;
    for (let i = 0; i < localStorage.length; i++) {
      const v = localStorage.getItem(localStorage.key(i)) || '';
      n += v.length;
      if (/signed-ticket\.pdf/.test(v)) hit = true;
      if (/AAAAAAAAAAAAAAAAAAAA/.test(v) || /data:application\/pdf/.test(v)) return { bytes: true };
    }
    return { bytes: false, name: hit, size: n };
  });
  check('the file\'s BYTES are never written to localStorage — that is why this needs signal', !cached.bytes);
  check('but its name is, so a technician down a hole still sees the sheet came back', cached.name === true);
  check('nothing was queued in the outbox for the attachment itself',
    !(await p.evaluate(() => JSON.parse(localStorage.getItem('makaman.outbox.v1') || '[]')))
      .some(o => /attachment/.test(o.table || '')));

  // ── what is refused, and refused before anything is written ─────────────────────────
  const upCount = () => p.evaluate(() => window.__uploads.length);
  const before = await upCount();

  await p.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await p.waitForTimeout(900);
  check('a type the bucket does not accept is refused, with nothing uploaded', await upCount() === before);
  check('and the person is told why', /Only PDFs and photos/.test(await p.innerText('body')));

  await p.locator('input[type=file]').setInputFiles({ name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) });
  await p.waitForTimeout(900);
  check('an empty file is refused — no CHECK in the table would accept it', await upCount() === before);

  await p.locator('input[type=file]').setInputFiles(PDF(15728641));
  await p.waitForTimeout(1500);
  check('one byte over the bucket limit is refused before the upload starts', await upCount() === before);
  check('and the refusal names the actual size, not just "too big"',
    /15\.0 MB/.test(await p.innerText('body')), await p.innerText('body').then(b => (b.match(/That file is [^.]+\./) || [''])[0]));

  // ── a failed row write must not leave bytes behind ──────────────────────────────────
  await p.evaluate(() => { window.__failInsert = 'ticket_attachments'; });
  await p.locator('input[type=file]').setInputFiles(PDF(4096));
  await p.waitForTimeout(1800);
  const orphan = await p.evaluate(() => ({ up: window.__uploads.length, removed: window.__removed }));
  check('when the row is refused, the uploaded object is deleted again',
    orphan.removed.length === 1 && orphan.up === before + 1, JSON.stringify(orphan.removed));
  check('so the bucket never holds bytes nobody can see, list or delete',
    orphan.removed[0] && orphan.removed[0].path === (await p.evaluate(() => window.__uploads[window.__uploads.length - 1].path)));
  check('and the failure is reported rather than swallowed', /could not be attached|refused/i.test(await p.innerText('body')));
  await p.evaluate(() => { window.__failInsert = ''; });

  // ── with no signal, the control says so BEFORE a file is chosen ─────────────────────
  await p.evaluate(() => { window.__mkApp.setState({ online: false }); });
  await p.waitForTimeout(500);
  check('offline, the file control is disabled', await p.locator('input[type=file]').isDisabled());
  check('and says a file cannot wait in the queue the way a job log can',
    /cannot wait in the queue/.test(await p.innerText('body')));
  await p.evaluate(() => { window.__mkApp.setState({ online: true }); });
  await p.waitForTimeout(400);

  // ── who may withdraw one ────────────────────────────────────────────────────────────
  check('a technician is not offered REMOVE — withdrawing is the office\'s call',
    await p.getByRole('button', { name: /^REMOVE$/ }).count() === 0);

  // Each page is served a freshly serialised copy of DB, so page 1's row does not travel
  // to page 2 — the second browser is a second device, not a second tab on the first.
  // Seeding it here is what actually models the case: the office opening a job the
  // technician attached to from the field.
  DB.ticket_attachments.push({
    id: 'a-seeded', ticket_id: TICKET,
    path: TICKET + '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
    filename: 'signed-ticket.pdf', mime: 'application/pdf', bytes: 2048,
    uploaded_by: TECH, uploaded_at: '2026-08-19T09:00:00.000Z',
  });
  const p2 = await openCloud();
  await login(p2, 'omar@makaman.ly');
  await openTicket(p2);
  check('the ops manager sees the attachment the technician made', /signed-ticket\.pdf/.test(await p2.innerText('body')));
  check('and is offered REMOVE', await p2.getByRole('button', { name: /^REMOVE$/ }).count() === 1);

  await p2.evaluate(() => { window.__removed = []; window.__writes = []; });
  await p2.getByRole('button', { name: /^REMOVE$/ }).first().click();
  await p2.waitForTimeout(1800);
  const del = await p2.evaluate(() => ({
    writes: window.__writes.filter(w => w.table === 'ticket_attachments'),
    removed: window.__removed,
    left: (window.__db.ticket_attachments || []).length,
  }));
  check('removing deletes the row', del.writes.some(w => w.action === 'delete'), JSON.stringify(del.writes));
  check('the row goes FIRST, then the bytes — the other order leaves a listing pointing at nothing',
    del.writes.some(w => w.action === 'delete') && del.removed.length === 1);
  check('and the attachment is gone', del.left === 0);
  check('the removal is recorded in the audit trail too',
    (await p2.evaluate(() => (window.__db.audit_log || []).map(a => a.text || a.detail || '')))
      .some(x => /removed the attachment signed-ticket\.pdf/.test(x)));

  // ── a build with no office connection is honest about it ────────────────────────────
  const p3 = await ctx.newPage();
  p3.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p3.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p3.goto(URL, { waitUntil: 'networkidle' });
  await p3.waitForTimeout(300);
  await p3.evaluate(() => localStorage.clear());
  await p3.reload({ waitUntil: 'networkidle' });
  await p3.waitForTimeout(800);
  const i3 = p3.locator('input');
  await i3.nth(0).fill('omar@makaman.ly'); await i3.nth(1).fill('makaman2026');
  await p3.getByRole('button', { name: /log in/i }).click();
  await p3.waitForTimeout(1400);
  await p3.evaluate(() => {
    const app = window.__mkApp;
    const t = app.state.data.tickets.find(x => x.status !== 'approved') || app.state.data.tickets[0];
    app.setState({ activeId: t.id, mgrScreen: 'review', techScreen: 'log', roleTab: 'tickets' });
  });
  await p3.waitForTimeout(900);
  check('in a build with no backend the control is disabled rather than misleading',
    await p3.locator('input[type=file]').isDisabled());
  check('and says why', /no office connection/.test(await p3.innerText('body')));

  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
