// F1 — the Start Job stamp must not be a single point of failure.
//
// Proven live on ticket 7922f40c (AGOCO), 2026-09-04/05: the audit trail carried
// "First log line — Start Job date recorded." FOUR separate times, one per job-log line,
// and start_job_at stayed NULL on the server through all four. The mechanism: addEvent set
// `x.start` only once, on the line that found it empty; diffOps sent that as part of the
// whole ticket header, upsert_ticket, guarded by version; and a version race against any
// OTHER concurrent header edit — a job-type change, a hand-over, nothing to do with
// start_job_at — was terminal by design (MK_STALE), so the ENTIRE header write was thrown
// away, start_job_at included. hydrate() then overwrote the device with the server's
// (still-empty) copy, `!x.start` was true again on the next line, and the cycle repeated.
//
// The fix has three parts, and this file exercises all three against the real database
// query shape (cloudstub), not just the pure diff logic:
//   1. diffOps records exactly which header columns an edit touched (`changed`) and what
//      they moved from (`base`), so outboxSend can rebase a lost version race onto the
//      server's current row instead of discarding the whole edit — sending only the
//      columns THIS edit touched, at the version the server is actually on now.
//   2. addEvent derives `x.start` from the earliest job-log line on every call rather than
//      latching it once, so a start that was ever lost heals itself the next time anyone
//      logs to the job — without ever re-writing "First log line" a second time.
//   3. refresh() heals an already-broken ticket (events exist, start does not, or is later
//      than the earliest line) once on every hydrate, so a ticket that already has every
//      line it will ever get is not left waiting for a log line that is never coming.
//
// A genuine SAME-FIELD conflict must still be caught, not silently overwritten — that is
// what conflict.test.js's "office changes the job while the technician is out of signal"
// case already proves (both sides write well_no) and is not re-proven here.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const { TECH, TICKET, makeDB, STUB, assertStubParses } = require('./cloudstub.js');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  const open = async (DB) => {
    const ctx = await browser.newContext({ viewport: { width: 1240, height: 1000 }, serviceWorkers: 'block' });
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
    const i = p.locator('input');
    await i.nth(0).fill('yousef@makaman.ly'); await i.nth(1).fill('whatever');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(1500);
    await p.evaluate(([id]) => window.__mkApp.setState({ activeId: id, techScreen: 'log', roleTab: 'tickets' }), [TICKET]);
    await p.waitForTimeout(400);
    return { ctx, p };
  };
  const dbTicket = (p) => p.evaluate(([id]) => window.__db.tickets.find(r => r.id === id), [TICKET]);
  const scoped = (base) => (p) => p.evaluate((b) => {
    const acct = (window.__mkApp.state.session || {}).email;
    return JSON.parse(localStorage.getItem(b + (acct ? '.' + acct.toLowerCase() : '')) || '[]');
  }, base);
  const setAside = scoped('makaman.outbox.refused.v1');
  const logLine = async (p, text) => {
    await p.getByPlaceholder('Describe the event as it happens…').fill(text);
    await p.getByRole('button', { name: /^Log line/i }).click();
    await p.waitForTimeout(300);
  };

  // ── 1. A lost version race rebases onto an UNRELATED concurrent edit ────────────────
  {
    const DB = makeDB();
    assertStubParses(DB);
    DB.tickets[0].start_job_at = null;
    DB.ticket_lines.length = 0;
    const { ctx, p } = await open(DB);

    let t = await p.evaluate(() => window.__mkApp.ticket());
    check('the ticket starts with no Start Job stamp', !t.start, JSON.stringify(t.start));

    await p.evaluate(() => { window.__offline = true; });
    await logLine(p, 'On location, JSA completed.');
    t = await p.evaluate(() => window.__mkApp.ticket());
    check('the device stamps Start Job locally right away', !!t.start, JSON.stringify(t.start));
    check('and records exactly one "First log line" entry',
      (t.audit || []).filter(a => /First log line/.test(a.text)).length === 1);

    // The office, meanwhile, edits a DIFFERENT column directly on the server row and
    // bumps the version — exactly the race that used to throw the whole header away.
    await p.evaluate(([id]) => {
      const r = window.__db.tickets.find(x => x.id === id);
      r.job_type_text = 'OFFICE CHANGED JOB TYPE WHILE OFFLINE';
      r.version = r.version + 1;
    }, [TICKET]);

    await p.evaluate(() => { window.__offline = false; });
    await p.evaluate(() => window.dispatchEvent(new Event('online')));
    await p.waitForTimeout(2200);

    const after = await dbTicket(p);
    check('Start Job reaches the server — the race did not discard it',
      !!after.start_job_at, JSON.stringify(after.start_job_at));
    check('the office\'s unrelated edit survives untouched — the rebase did not overwrite it',
      after.job_type_text === 'OFFICE CHANGED JOB TYPE WHILE OFFLINE', after.job_type_text);
    check('the job-log line itself reached the server too', (await p.evaluate(([id]) => window.__db.ticket_lines.filter(l => l.ticket_id === id).length, [TICKET])) === 1);
    check('nothing was set aside — this was never a real conflict', (await setAside(p)).length === 0,
      JSON.stringify(await setAside(p)));
    await ctx.close();
  }

  // ── 2. addEvent derives, not latches — a lost stamp heals on the NEXT line, once ────
  {
    const DB = makeDB();
    assertStubParses(DB);
    DB.tickets[0].start_job_at = null;
    DB.ticket_lines.length = 0;
    const { ctx, p } = await open(DB);

    await logLine(p, 'Line one.');
    let t = await p.evaluate(() => window.__mkApp.ticket());
    const firstStart = t.start;
    check('the first line stamps Start Job', !!firstStart, JSON.stringify(firstStart));
    check('and records the "First log line" entry once', (t.audit || []).filter(a => /First log line/.test(a.text)).length === 1);

    // Simulate exactly what the live bug did to the device: the header write that carried
    // Start Job was lost, and the field came back empty on the next hydrate.
    await p.evaluate(([id]) => window.__mkApp.mutate(d => { d.tickets.find(x => x.id === id).start = ''; }), [TICKET]);
    t = await p.evaluate(() => window.__mkApp.ticket());
    check('the simulated loss actually cleared it', !t.start);

    await logLine(p, 'Line two.');
    t = await p.evaluate(() => window.__mkApp.ticket());
    check('the SECOND line heals it — Start Job is set again', !!t.start, JSON.stringify(t.start));
    check('healed to the EARLIEST line\'s time, not the second line\'s — this is a start date, not a "last fixed" date',
      t.start === firstStart, JSON.stringify({ healed: t.start, first: firstStart }));
    check('and "First log line" is still recorded exactly ONCE — this was never a first line again',
      (t.audit || []).filter(a => /First log line/.test(a.text)).length === 1,
      JSON.stringify((t.audit || []).filter(a => /First log line/.test(a.text))));
    await ctx.close();
  }

  // ── 3. hydrate() heals a ticket that is ALREADY broken, with no log line needed ─────
  {
    const DB = makeDB();
    DB.tickets[0].start_job_at = null;
    DB.ticket_lines = [
      { id: 'l1', ticket_id: TICKET, logged_at: '2026-09-04T22:33:18.666Z', text: 'M/U test', edited_by: null, edited_at: null },
      { id: 'l2', ticket_id: TICKET, logged_at: '2026-09-04T22:34:39.700Z', text: 'RIH test', edited_by: null, edited_at: null },
    ];
    assertStubParses(DB);
    const { ctx, p } = await open(DB);
    await p.waitForTimeout(1500);

    const after = await dbTicket(p);
    check('a ticket hydrated with lines but no Start Job is healed without anyone logging anything',
      !!after.start_job_at, JSON.stringify(after.start_job_at));
    check('healed to the EARLIEST line, not "now" and not the latest',
      after.start_job_at === '2026-09-04T22:33:18.666Z', after.start_job_at);
    check('nothing set aside for the heal', (await setAside(p)).length === 0);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
