// The data layer, driven against a fake database that lives in the page.
//
// The sandbox cannot route to the real project, and testing against it would be the
// wrong instrument anyway: what needs checking is not whether Supabase works but
// whether this app's translation of it does — that a row becomes the shape the screens
// expect, that an edit made with no signal is kept and sent later exactly once, and
// that a day's worth of edits does not become a day's worth of requests.
//
// The fake implements only the query-builder surface the app actually calls, and records
// every write so the assertions can be about traffic rather than about outcomes.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const { TECH, OPS, CLIENT, TICKET, JOB, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const DB = makeDB();
assertStubParses(DB);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  // Service workers off: sw.js answers same-origin GETs with its own fetch, and a
  // worker's fetch is invisible to page.route, so the stub would never be served.
  const ctx = await browser.newContext({ viewport: { width: 430, height: 940 }, serviceWorkers: 'block' });

  const open = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
      status: 200, contentType: 'application/javascript', body: STUB(DB),
    }));
    await p.addInitScript(() => {
      window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
      // A short debounce so a test does not spend a second per edit waiting for it.
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
    await p.waitForTimeout(1600);
  };
  const store = (p) => p.evaluate(() => window.__mkApp.state.data);
  const outbox = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('makaman.outbox.v1') || '[]'));
  const writes = (p) => p.evaluate(() => window.__writes);

  // ── a cold start in cloud mode shows no demo data ────────────────────────
  let p = await open();
  let body = await p.innerText('body');
  check('cloud mode with an empty cache does not open on demo tickets',
    !/Northern Gulf Petroleum|Al-Dhafra Energy/.test(body));

  // ── hydration ────────────────────────────────────────────────────────────
  await login(p, 'yousef@makaman.ly');
  let d = await store(p);
  const t = (d.tickets || [])[0];
  check('the database\'s ticket arrives', !!t, t ? t.customer : JSON.stringify((d.tickets || []).length));
  check('with its technician resolved to a name, not a uuid', t && t.tech === 'Yousef Al-Harbi', t && t.tech);
  check('and its job type resolved through the lookup table',
    t && t.jobType === 'RBP FOR CEMENT JOB', t && t.jobType);
  check('its log lines arrive in order', t && t.events.length === 2
    && /JSA completed/.test(t.events[0].text), t && t.events.length + ' lines');
  check('the crew carries a name and an email', t && t.crew.length === 1
    && t.crew[0].name === 'Yousef Al-Harbi' && t.crew[0].email === 'yousef@makaman.ly',
    t && JSON.stringify(t.crew));
  check('an unfinished job has no end date rather than an invalid one',
    t && t.end === '', t && JSON.stringify(t.end));
  check('the price list is attached to its customer',
    (d.clients || []).length === 1 && d.clients[0].items.length === 1
    && d.clients[0].items[0].code === 'MKN-1801');
  // Spelled in the app's own vocabulary, which is not the column names. This asserts the
  // translated keys specifically: an unrecognised key does not fail, it silently falls
  // back to the default, so 'a settings object arrived' proves nothing on its own.
  check('settings come from the database, not the defaults',
    (d.settings || {}).theme === 'dark' && d.settings.shareLocation === true,
    JSON.stringify(d.settings));
  check('and are spelled the way the settings screen reads them',
    d.settings.timeFormat === '24' && d.settings.hour12 === undefined,
    'timeFormat=' + d.settings.timeFormat + ' hour12=' + d.settings.hour12);
  // The zone is a company fact now, not a per-user preference, so it is not carried in
  // the settings the app reads — it is a constant the formatter uses. Hydrating one
  // would mean a stored value could quietly disagree with the one being formatted with.
  check('the operating timezone is not a setting anyone can hold a stale copy of',
    d.settings.timezone === undefined && d.settings.tz === undefined,
    'timezone=' + d.settings.timezone);
  check('the numbering claim names its holder',
    (d.numbering || {}).holderName === 'Omar Al-Saleh', JSON.stringify(d.numbering));
  check('and the screen shows the real job, not a seeded one',
    /Burgan North|Kuwait Oil Group/.test(await p.innerText('body')));

  // ── an edit with no signal is kept, not lost, and not sent ───────────────
  await p.evaluate(() => { window.__offline = true; window.__writes = []; });
  await p.evaluate(() => window.__mkApp.mutate(d => { d.tickets[0].well = 'BG-999'; }));
  await p.waitForTimeout(500);
  check('an offline edit is applied on the device immediately',
    (await store(p)).tickets[0].well === 'BG-999');
  let q = await outbox(p);
  check('and is queued rather than dropped', q.some(o => o.table === 'tickets'),
    JSON.stringify(q.map(o => o.key)));
  check('nothing reached the database while it was unreachable',
    (await writes(p)).length === 0, JSON.stringify(await writes(p)));

  // ── coalescing: many edits to one row are one write ──────────────────────
  await p.evaluate(() => {
    for (let n = 0; n < 10; n++) window.__mkApp.mutate(d => { d.tickets[0].rig = 'RIG-' + n; });
  });
  await p.waitForTimeout(400);
  q = await outbox(p);
  const ticketOps = q.filter(o => o.table === 'tickets');
  check('ten edits to one ticket collapse to one queued write',
    ticketOps.length === 1, ticketOps.length + ' ops');
  check('and the one kept is the latest', ticketOps[0].row.rig_name === 'RIG-9',
    ticketOps[0].row.rig_name);

  // ── reconnecting drains, once ────────────────────────────────────────────
  await p.evaluate(() => { window.__offline = false; });
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await p.waitForTimeout(1800);
  check('the queue empties on reconnect', (await outbox(p)).length === 0,
    JSON.stringify((await outbox(p)).map(o => o.key)));
  const w = await writes(p);
  check('the ticket reached the database with the last value typed',
    await p.evaluate(([id]) => (window.__db.tickets.find(r => r.id === id) || {}).rig_name, [TICKET]) === 'RIG-9');
  // Counted by table rather than by action name. The header moved from upsert to a
  // version-guarded update (S11) and this assertion went red while the behaviour it names
  // was unchanged — a check pinned to a mechanism stops testing the claim the moment the
  // mechanism moves.
  check('a day of edits did not become a day of requests',
    w.filter(x => x.table === 'tickets').length === 1,
    w.filter(x => x.table === 'tickets').length + ' ticket writes');

  // ── children are replaced, not duplicated, on replay ─────────────────────
  await p.evaluate(() => window.__mkApp.mutate(d => {
    d.tickets[0].events.push({ ts: new Date().toISOString(), text: 'Rigged down, released.' });
  }));
  await p.waitForTimeout(1200);
  const lines = await p.evaluate(([id]) => window.__db.ticket_lines.filter(r => r.ticket_id === id).length, [TICKET]);
  check('adding one log line leaves three rows, not five', lines === 3, lines + ' rows');
  await p.evaluate(() => window.__mkApp.mutate(d => { d.tickets[0].events[2].text = 'Rigged down and released.'; }));
  await p.waitForTimeout(1200);
  const lines2 = await p.evaluate(([id]) => window.__db.ticket_lines.filter(r => r.ticket_id === id), [TICKET]);
  check('editing a line rewrites it rather than appending a second',
    lines2.length === 3 && lines2.some(r => /and released/.test(r.text)), lines2.length + ' rows');

  // ── an untouched ticket is not rewritten ─────────────────────────────────
  await p.evaluate(() => { window.__writes = []; });
  await p.evaluate(() => window.__mkApp.mutate(d => { d.settings.timeFormat = '12'; }));
  await p.waitForTimeout(1200);
  const after = await writes(p);
  check('changing a setting does not rewrite the tickets',
    !after.some(x => x.table === 'tickets' || x.table === 'ticket_lines'),
    JSON.stringify(after.map(x => x.table)));
  check('but the setting itself is saved', after.some(x => x.table === 'user_settings'),
    JSON.stringify(after.map(x => x.table)));
  // The round trip is where a one-way spelling mistake hides: writing the wrong key
  // still produces a write, and only reading it back shows it never landed.
  const saved = await p.evaluate(() => window.__db.user_settings[0]);
  check('a 12-hour preference reaches the database as a boolean', saved.hour12 === true,
    JSON.stringify({ hour12: saved.hour12, timezone: saved.timezone }));

  // ── the length cap holds at the last gate ────────────────────────────────
  // The inputs cap what can be typed and pasted, but a value can reach the store any
  // number of other ways. This is the one that matters for the database: whatever is on
  // the device, the row that goes over the wire is within the cap — and the customer,
  // which is deliberately exempt, still goes in full.
  await p.evaluate(() => window.__mkApp.mutate(d => {
    const t = d.tickets[0];
    t.field = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    t.well = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    t.rig = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    t.customer = 'Sirte Oil Company for Petroleum Operations';
  }));
  await p.waitForTimeout(1300);
  const sent = await p.evaluate(([id]) => window.__db.tickets.find(r => r.id === id), [TICKET]);
  check('an over-long oilfield reaches the database capped at ten',
    sent.field_name.length === 10, JSON.stringify(sent.field_name));
  check('and so do the well and the rig',
    sent.well_no.length === 10 && sent.rig_name.length === 10,
    sent.well_no + ' | ' + sent.rig_name);
  check('while the customer goes over in full', sent.customer.length === 42,
    sent.customer.length + ' chars');

  // ── logout clears the replica ────────────────────────────────────────────
  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(500);
  const out = p.getByRole('button', { name: /log ?out|sign out/i }).last();
  if (await out.count()) { await out.click(); await p.waitForTimeout(800); }
  const cached = await p.evaluate(() => localStorage.getItem('makaman.cloud.v1'));
  check('signing out leaves no tickets cached for the next person', !cached, String(cached).slice(0, 40));
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
