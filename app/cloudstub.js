// The fake Supabase client, in one place.
//
// It used to be copied into every suite that needed it. Three copies is three chances for
// one to fall behind the app — and it happened inside a single session: a fix to the
// stub's insert() went into one copy while another went on failing for the reason the fix
// removed, and the debugging cost more than the extraction. B-19.6 is about a fake that
// stops keeping up with the app; a fake that cannot keep up with ITSELF is the same
// failure with more places to hide.
//
// It implements only the query-builder surface the app actually calls, plus storage, and
// records every write so assertions can be about traffic rather than about outcomes.
// Anything the app grows that this does not implement is named out loud rather than
// answered with undefined.

const IDS = {
  TECH: '11111111-1111-4111-8111-111111111111',
  OPS: '22222222-2222-4222-8222-222222222222',
  CLIENT: '33333333-3333-4333-8333-333333333333',
  TICKET: '44444444-4444-4444-8444-444444444444',
  JOB: '55555555-5555-4555-8555-555555555555',
};
const { TECH, OPS, CLIENT, TICKET, JOB } = IDS;

// A fresh fixture every call. Shared mutable state between suites — or between two pages
// of one suite — is a second device pretending to be the same one.
function makeDB() {
  return JSON.parse(JSON.stringify(BASE_DB));
}

// The rows the fake starts with. Deliberately a job in progress with two log lines and
// a crew of one — the shape a technician's phone actually holds.
const BASE_DB = {
  profiles: [
    { id: TECH, email: 'yousef@makaman.ly', full_name: 'Yousef Al-Harbi', role: 'technician', status: 'active' },
    { id: OPS, email: 'omar@makaman.ly', full_name: 'Omar Al-Saleh', role: 'ops_manager', status: 'active' },
  ],
  clients: [{ id: CLIENT, name: 'Kuwait Oil Group', currency: 'USD' }],
  price_list_items: [
    { id: 'p1', client_id: CLIENT, item_number: 'MKN-1801', description: 'Pick-up with tools travelling to wells', uom: 'Km', unit_cost: 3.9, unit_cost_additional: null, currency: 'USD', has_valid_code: true },
  ],
  job_types: [{ id: JOB, name: 'RBP FOR CEMENT JOB' }],
  ticket_numbering: [{ id: 'n1', prefix: '', label: 'Special Tools', next_number: 1883, floor: 1883 }],
  org_defaults: [{ id: true, base_location: 'Ahmadi Base', customer_rep: 'Workover Office' }],
  asset_questions: [
    { id: 'q1', key: 'reclaimed', label: 'Tools allocated reclaimed or back-to-base?', tone: 'warning', multi: false, presets: ['Yes', 'Not yet', 'Handed over to replacement'], sort_order: 0 },
  ],
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
    // S11. Every row carries one; the migration made the column NOT NULL DEFAULT 1, so a
    // fixture without it is a fixture no real row can match.
    version: 1,
  }],
  ticket_lines: [
    { id: 'l1', ticket_id: TICKET, logged_at: '2026-08-19T06:48:00.000Z', text: 'On location, JSA completed with rig supervisor.', edited_by: null, edited_at: null },
    { id: 'l2', ticket_id: TICKET, logged_at: '2026-08-19T08:05:00.000Z', text: 'Rigging up combination string.', edited_by: null, edited_at: null },
  ],
  ticket_items: [],
  ticket_assets: [],
  ticket_crew: [{ ticket_id: TICKET, profile_id: TECH, position: 0 }],
  audit_log: [],
  ticket_notes: [],
  ticket_attachments: [],
};

// A fake client good enough for what the app asks of it: select-all, select-eq-single,
// upsert, insert, delete-eq. Every write is appended to window.__writes so the test can
// assert on how much traffic a change produced, not merely on its effect.
const STUB = (db) => `
// Every request this fake answers. The app's latency is dominated by how many times it
// goes to the server, not by how long each one takes locally, so that count is the thing
// worth asserting on — and it is invisible unless something counts it.
window.__rtt = 0;
// Round trips are only half the story: what costs is how many of them are SEQUENTIAL.
// Set this and every answer is delayed, so a suite can measure the critical path in
// wall-clock rather than counting requests and guessing at the shape.
window.__stubLatency = 0;
window.__wire = function (body) {
  var ms = window.__stubLatency || 0;
  if (!ms) return Promise.resolve(body);
  return new Promise(function (r) { setTimeout(function () { r(body); }, ms); });
};
window.__writes = [];
window.__uploads = [];
window.__removed = [];
window.__signed = [];
window.__db = ${JSON.stringify(db)};
window.__offline = false;
// Fault knobs, so the failure paths can be driven rather than reasoned about.
window.__failUpload = false;
window.__failInsert = '';
window.supabase = {
  createClient: function () {
    var db = window.__db;
    function fail() { return Promise.resolve({ data: null, error: { message: 'network down' } }); }
    function q(table) {
      var rows = db[table] || (db[table] = []);
      var api = {
        select: function (cols, opts) {
          var filtered = rows.slice();
          var wantCount = !!(opts && opts.count);
          var head = !!(opts && opts.head);
          // The count PostgREST returns is the size of the whole result set, BEFORE the
          // range is applied — that is the entire point of asking for it alongside a
          // page. This used to report the length AFTER the slice, which is the size of
          // the PAGE, and a pager driven by that count would read one page here
          // and stop, then read one page in production and stop. A fake that agrees with
          // a bug is worse than no fake.
          var ranged = false;
          var preRangeCount = 0;
          var chain = {
            eq: function (col, val) { filtered = filtered.filter(function (r) { return r[col] === val; }); return chain; },
            // The app orders and limits the export_runs lookup. Both are called
            // synchronously while the Promise.all array is being built, so a missing one
            // is not a failed query — it throws before a single request is made, and
            // hydrate() never runs. That is what left this whole suite reading seeded
            // defaults while printing PASS.
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
            // Paging, and the cap that made paging necessary.
            //
            // PostgREST answers a plain select with at most db-max-rows -- 1,000 by
            // default — and says nothing about the rows it withheld. The app read the
            // first page as if it were the table, so customers whose price-list rows fell
            // past the cut had no items at all. window.__maxRows lets a suite reproduce
            // that exactly: set it, and this fake truncates every page the same way the
            // real server does.
            range: function (from, to) {
              var cap = window.__maxRows || Infinity;
              var want = Math.min(to - from + 1, cap);
              if (!ranged) { ranged = true; preRangeCount = filtered.length; }
              filtered = filtered.slice(from, from + want);
              return chain;
            },
            single: function () {
              window.__rtt++;
              if (window.__offline) return fail();
              return window.__wire(filtered.length
                ? { data: filtered[0], error: null }
                : { data: null, error: { message: 'no rows' } });
            },
            then: function (ok, no) {
              window.__rtt++;
              // head:true asks for the tally and no rows. The self-check compares that
              // tally against what the device holds, so a stub that ignored it would
              // hand the app undefined and let it report a shortfall of NaN.
              var body = wantCount
                ? { data: head ? null : filtered,
                    count: ranged ? preRangeCount : filtered.length, error: null }
                : { data: filtered, error: null };
              return (window.__offline ? fail() : window.__wire(body)).then(ok, no);
            },
          };
              // Anything the app calls that this stub has not learned yet is named out loud.
          // Twice now a method was added to hydrate() -- rpc, then order/limit -- and the
          // stub answered undefined, which threw somewhere unhelpful and left the suite
          // looking half-alive. A stub that cannot keep up should say so.
          return new Proxy(chain, {
            get: function (target, prop) {
              if (prop in target || typeof prop === 'symbol') return target[prop];
              throw new Error('cloud.test.js stub has no .' + String(prop) + '() — the app has grown a call this fake client does not implement');
            },
          });
        },
        // S11. The version guard writes through update(...).eq('id').eq('version'), and
        // what it needs back is HOW MANY rows matched — zero means somebody got there
        // first. A stub that always answered "fine" would make the conflict path
        // untestable and, worse, invisible.
        update: function (row) {
          var conds = [];
          var chain = {
            eq: function (col, val) { conds.push([col, val]); return chain; },
            select: function () {
              if (window.__offline) return fail();
              var hit = rows.filter(function (r) {
                return conds.every(function (c) { return r[c[0]] === c[1]; });
              });
              window.__writes.push({ table: table, action: 'update', n: hit.length });
              hit.forEach(function (r) {
                Object.assign(r, row);
                // The trigger's job, mirrored: the client never sets this.
                if ('version' in r) r.version = r.version + 1;
              });
              return Promise.resolve({ data: hit.map(function (r) { return { id: r.id, version: r.version }; }), error: null });
            },
            then: function (ok, no) { return chain.select().then(ok, no); },
          };
          return chain;
        },
        upsert: function (row, opts) {
          if (window.__offline) return fail();
          window.__writes.push({ table: table, action: 'upsert', n: 1 });
          var key = (opts && opts.onConflict) || (table === 'user_settings' ? 'user_id' : 'id');
          var at = -1;
          for (var i = 0; i < rows.length; i++) if (rows[i][key] === row[key]) { at = i; break; }
          if (at >= 0) rows[at] = Object.assign({}, rows[at], row); else rows.push(row);
          return Promise.resolve({ data: [row], error: null });
        },
        insert: function (rs) {
          if (window.__offline) return fail();
          if (window.__failInsert === table) return Promise.resolve({ data: null, error: { message: 'row refused by the database' } });
          // supabase-js takes a single row or an array. This took only an array, so the
          // app inserting one object hit rs.forEach === undefined — a TypeError thrown
          // inside the send, which looks exactly like the server refusing the write.
          // B-19.6: a hand-written fake has to keep up with what the app asks of it.
          var list = Array.isArray(rs) ? rs : [rs];
          window.__writes.push({ table: table, action: 'insert', n: list.length });
          list.forEach(function (r) { rows.push(r); });
          return Promise.resolve({ data: list, error: null });
        },
        delete: function () {
          return { eq: function (col, val) {
            if (window.__offline) return fail();
            window.__writes.push({ table: table, action: 'delete', n: 1 });
            db[table] = rows.filter(function (r) { return r[col] !== val; });
            return Promise.resolve({ data: null, error: null });
          } };
        },
      };
      return api;
    }
    return {
      // Postgres functions. The app calls c.rpc('my_permissions') as part of hydration
      // (P1.8, the permission registry). Without this the call was undefined(...),
      // which threw inside the Promise.all that loads EVERY table — so nothing landed in
      // state, and the assertions before the crash went on "passing" against seeded
      // defaults rather than database values. A stub has to keep up with what the app
      // asks of it, or it stops testing and starts reassuring.
      rpc: function () {
        if (window.__offline) return fail();
        // my_permissions() is declared "returns table (permission_id, granted, source)",
        // so supabase-js hands back an ARRAY of rows — hydrate() reduces over it. An
        // object here is truthy, so the "|| []" guard does not catch it and the reduce
        // throws, taking the whole Promise.all down with it. Empty is the honest answer
        // for a person with no explicit exceptions: hasPermission() then falls back to
        // the role defaults, which is what this suite is about. permissions.test.js
        // covers the registry itself.
        return Promise.resolve({ data: [], error: null });
      },
      auth: {
        signInWithPassword: function (c) {
          if (window.__offline) return fail();
          // Case-insensitively, because GoTrue is. The live project holds a profile
          // spelled 'Lateri@makaman.ly' while the app sends what was typed in lower
          // case, and a stub that compared exactly refused a sign-in the real server
          // accepts — which is a fake inventing a bug rather than reproducing one.
          var want = String(c.email || '').toLowerCase();
          var p = db.profiles.filter(function (r) {
            return String(r.email || '').toLowerCase() === want;
          })[0];
          if (p) window.__stubUser = p.id;
          return Promise.resolve(p
            ? { data: { user: { id: p.id } }, error: null }
            : { error: { message: 'Invalid login credentials' } });
        },
        signOut: function () { return Promise.resolve({ error: null }); },
        // Who the SERVER says is signed in, which is the question the self-check asks and
        // a different question from who the app believes. Remembers whoever last signed
        // in, so a report can be checked against the account that produced it.
        getUser: function () {
          var p = window.__stubUser
            ? db.profiles.filter(function (r) { return r.id === window.__stubUser; })[0]
            : null;
          return Promise.resolve({ data: { user: p ? { id: p.id, email: p.email } : null }, error: null });
        },
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
// Checked here, once, before any browser is opened.
function assertStubParses(db) {
  const out = STUB(db || makeDB());
  if (/`/.test(out)) { console.error('  FATAL  the injected stub contains a backtick, which truncates it'); process.exit(1); }
  try { new Function(out); } catch (e) { console.error('  FATAL  the injected stub does not parse: ' + e.message); process.exit(1); }
}

module.exports = { IDS, TECH, OPS, CLIENT, TICKET, JOB, makeDB, STUB, assertStubParses };
