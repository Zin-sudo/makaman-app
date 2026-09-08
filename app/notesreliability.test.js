// Notes reliability: a technician's note reaching the server must not come back as a
// false "server refused", must not duplicate if a response is lost after a real success,
// must keep retrying on its own without a manual Retry, and an outstanding one must show
// up as its own line in Activity rather than only in the account-wide banner.
//
// Reported live, 2026-09-05, exactly the way this file proves it: a technician's note got
// an immediate "refused" banner, did not reach a second signed-in session, and only landed
// after a manual Retry. Traced to a real, reproducible dead end and confirmed against the
// LIVE database (session notes carry the exact SQL and the exact Postgres error) — not
// guessed: `ticket_notes`'s only UPDATE policy is staff-only, and INSERT ... ON CONFLICT
// DO UPDATE requires that policy to pass on retry even when the row's content is
// unchanged. A technician's own note, resent after its first successful insert's response
// was lost, hit that wall on every subsequent attempt, forever — proven by inserting a
// note as a real technician (succeeds), then retrying the identical upsert (fails, every
// time, with "new row violates row-level security policy (USING expression)"). This file
// covers the client-side half of that fix and the three architectural gaps found tracing
// it: the wording that called a still-retrying refusal "refused" outright to the PERSON
// (the developer-facing error log is a different reader and keeps recording it — see
// approval.test.js), nothing rescheduling a retry on its own, and no
// way to see a specific pending action apart from the account-wide banner.
const { chromium } = require('playwright-core');
const { TICKET, TECH, OPS, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

const DB = makeDB();
assertStubParses(DB);

async function boot(b, email) {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: STUB(DB) }));
  await p.addInitScript(() => {
    window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
    window.__DRAIN_TEST_MS = 150;
    window.__DRAIN_RETRY_CAP_TEST_MS = 500;
  });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('x');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1600);
  return { ctx, p };
}

const acctKeyOf = (p, base) => p.evaluate((b) => {
  const acct = (window.__mkApp.state.session || {}).email;
  return b + (acct ? '.' + acct.toLowerCase() : '');
}, base);
const readList = async (p, base) => {
  const key = await acctKeyOf(p, base);
  return p.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), key);
};
const noteOp = (list) => list.find((o) => o && String((o.key) || '').indexOf('ticket_notes:') === 0);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── diffOps marks an unresolved own-note safe for ignoreDuplicates ────────────
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly'); // TECH
    await p.evaluate((ticket) => window.__mkApp.addNote(ticket, 'Pressure test completed.'), TICKET);
    await p.waitForTimeout(100);
    const op = noteOp(await readList(p, 'makaman.outbox.v1'));
    check('a technician\'s own new note is queued', !!op, JSON.stringify(op));
    check('...marked safe for ignoreDuplicates: nothing about it can legitimately change later',
      op && op.ignoreDup === true, JSON.stringify(op));
    await ctx.close();
  }

  // ── A note this SAME device also resolved before syncing keeps its real upsert ──
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly'); // OPS: holds note.add AND note.resolve
    await p.evaluate((ticket) => {
      const app = window.__mkApp;
      app.addNote(ticket, 'Following up with the client.');
      const t = app.state.data.tickets.find((x) => x.id === ticket);
      const n = (t.notes || []).slice(-1)[0];
      app.resolveNote(ticket, n.id);
    }, TICKET);
    await p.waitForTimeout(100);
    const op = noteOp(await readList(p, 'makaman.outbox.v1'));
    check('a note raised AND resolved by the same device before syncing is still queued', !!op);
    check('...but NOT marked ignoreDuplicates: the resolved fields may still need to reach a row that landed without them',
      op && !op.ignoreDup, JSON.stringify(op));
    await ctx.close();
  }

  // ── outboxSend actually passes ignoreDuplicates through to the real upsert call ──
  // Extracted standalone the same way collateral.test.js/approval.test.js already do,
  // against a thenable stub that records exactly what it was called with.
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly');
    const calls = await p.evaluate(() => {
      const src = document.querySelector('script[type="text/x-dc"]').textContent;
      const grab = (name) => {
        const at = src.indexOf('function ' + name + '(');
        if (at < 0) return null;
        let d = 0, i = src.indexOf('{', at);
        for (let j = i; j < src.length; j++) {
          if (src[j] === '{') d++;
          else if (src[j] === '}') { d--; if (!d) return src.slice(at, j + 1); }
        }
        return null;
      };
      const calls = [];
      const stub = { from: (table) => ({
        upsert: (row, opts) => { calls.push({ table: table, row: row, opts: opts }); return { then: (ok) => Promise.resolve({ data: [row], error: null }).then(ok) }; },
      }) };
      const fn = new Function(grab('outboxSend') + '\nreturn outboxSend;')();
      return Promise.all([
        fn(stub, { action: 'upsert', table: 'ticket_notes', ignoreDup: true, row: { id: 'n1' } }),
        fn(stub, { action: 'upsert', table: 'ticket_notes', row: { id: 'n2' } }),
      ]).then(() => calls);
    });
    check('an ignoreDup op is sent with onConflict:id, ignoreDuplicates:true',
      calls[0] && calls[0].opts && calls[0].opts.onConflict === 'id' && calls[0].opts.ignoreDuplicates === true,
      JSON.stringify(calls[0]));
    check('a plain note upsert (no ignoreDup) is unaffected — still a plain upsert',
      calls[1] && calls[1].opts === undefined, JSON.stringify(calls[1]));
    await ctx.close();
  }

  // ── Automatic retry: a still-failing-but-retryable refusal keeps trying on its own,
  // ── worded honestly, and without polluting the error log while it might still resolve ──
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly');
    await p.evaluate(() => {
      // Shaped exactly like the live refusal this file is about — RLS, not terminal.
      window.__failTables = { ticket_notes:
        'new row violates row-level security policy (USING expression) for table "ticket_notes"' };
    });
    await p.evaluate((ticket) => window.__mkApp.addNote(ticket, 'Auto-retry check.'), TICKET);
    // Nothing below calls scheduleDrain, retryRefused, or refresh — every attempt from
    // here on has to come from the drain rescheduling itself.
    await p.waitForTimeout(150 + 300 + 500 + 200);
    const mid = await readList(p, 'makaman.outbox.v1');
    const op = noteOp(mid);
    check('the same op was retried more than once with no external trigger',
      op && op.tries >= 2, JSON.stringify(op));

    // Let it run all the way to exhaustion (OUTBOX_TRIES=5) and settle into the dead-letter pile.
    await p.waitForTimeout(500 * 3 + 300);
    const dead = await readList(p, 'makaman.outbox.refused.v1');
    const entry = dead.find((d) => d && d.op && String(d.op.key || '').indexOf('ticket_notes:') === 0);
    check('it is eventually set aside, not retried forever', !!entry, JSON.stringify(dead));
    check('...and honestly recorded as non-terminal — this classifier cannot know it will never work',
      entry && entry.terminal === false, JSON.stringify(entry));
    check('its reason does NOT claim the server refused it — that would be a guess',
      entry && !/refused|rejected/i.test(entry.why), entry && entry.why);
    check('...and says, honestly, that it is still trying',
      entry && /has not confirmed|still trying/i.test(entry.why), entry && entry.why);
    // The error log stays a developer diagnostic, not the person-facing pile above: a
    // write the server has now refused OUTBOX_TRIES times, in the same words, every time,
    // is still worth a line for whoever has to fix it — that is a fact, not a guess,
    // whatever refusalText() tells the PERSON about whether it might yet resolve.
    const errLog = await readList(p, 'makaman.errorlog.v1');
    check('the developer-facing error log still records it, with a code',
      errLog.some((e) => e.code === 'MK-SYNC-RLS'), JSON.stringify(errLog));

    // The banner reflects the same honesty, not "N changes were refused".
    const bannerText = await p.evaluate(() => document.body.innerText);
    check('the account-wide banner does not say "refused" for a still-retrying change',
      !/refused by the server/i.test(bannerText), bannerText.slice(0, 400));

    // ── And it shows up as its own line in Activity, not only in the banner ──
    await p.evaluate(() => window.__mkApp.setState({ roleTab: 'activity' }));
    await p.waitForTimeout(300);
    const activityText = await p.evaluate(() => document.body.innerText);
    check('the Activity tab names the specific action, not just "something failed"',
      /Adding a note/i.test(activityText), activityText.slice(0, 600));
    check('...and its status reads as still-trying, matching the dead-letter reason',
      /still trying to reach the server/i.test(activityText), activityText.slice(0, 600));

    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
