// A stale ticket header must not take an unrelated child row down with it.
//
// 2026-09-04, reported live: a technician logged a job-log line, got an immediate
// "refused" banner and an error-log entry for it, and the line only reached the server
// after a noticeable delay — with the stale banner still sitting there afterward.
// Reproduced directly against outboxDrain(): the actual cause was a job-log line queued
// BEHIND a stale header edit for the same ticket (a mileage change made while the office
// had since touched the same job). The header's version conflict is genuinely terminal —
// retrying that exact op can never work, the version will never come back — but the
// "retire the whole job" rule that fires on any terminal header refusal swept the
// perfectly valid, unrelated job-log line away with it: never sent, never retried, and no
// trace of it left anywhere.
//
// That rule is correct for exactly one terminal reason — a foreign key with nothing at
// the far end of it, meaning the ticket itself is not there and nothing pointing at it
// ever will resolve either. It is wrong for MK_STALE and LOCKED, which both mean the
// ticket exists just fine — only its version or its editable state is what the header
// write got wrong, and that says nothing about a sibling row's own chances.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function open(ctx) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1200, height: 900 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  return p;
}

// Drives the real outboxDrain(), extracted standalone the same way approval.test.js
// already does, against a thenable stub client shaped the way cloudstub.js's own fake
// server is (every method returns the chain; only .then() resolves it) — a stub that
// resolves eagerly on .select() silently breaks outboxSend's own MK_STALE fallback,
// which chains .eq() after .select(), and that is not the thing under test here.
async function runDrain(p, headerOutcome) {
  return p.evaluate((outcome) => {
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
    const parts = ['outboxRead', 'outboxWrite', 'outboxPush', 'outboxSend', 'refusalText',
                   'errorKind', 'currentAccount', 'acctKey', 'errlogKey', 'outboxKey',
                   'deadletterKey', 'opTicket', 'logError', 'outboxSetAside', 'outboxDrain',
                   'withTimeout']
      .map(grab).filter(Boolean).join('\n');
    const OUTBOX_K = 'makaman.outbox.v1', DEADLETTER_K = 'makaman.outbox.refused.v1';
    const ERRLOG_K = 'makaman.errorlog.v1', ERRLOG_MAX = 400;
    const AUTH_RESTORE_TIMEOUT_MS = 4000;
    const TICKET_ID = 't-collateral-' + outcome;

    localStorage.setItem(OUTBOX_K, JSON.stringify([
      { key: 'tickets:' + TICKET_ID, table: 'tickets', action: 'upsert_ticket', seq: 1,
        row: { id: TICKET_ID, version: 1, mileage: 42 } },
      { key: 'ticket_lines:new-line-1', table: 'ticket_lines', action: 'upsert', seq: 2,
        row: { id: 'new-line-1', ticket_id: TICKET_ID, logged_at: new Date().toISOString(), text: 'Arrived on site' } },
    ]));

    const calls = [];
    const stub = {
      from: (table) => {
        const chain = {
          _mode: null,
          update: (row) => { chain._mode = 'update'; chain._row = row; return chain; },
          upsert: (row) => { chain._mode = 'upsert'; chain._row = row; return chain; },
          insert: (row) => { chain._mode = 'insert'; chain._row = row; return chain; },
          select: () => { chain._selected = true; return chain; },
          eq: () => chain,
          then: (ok, no) => {
            let result;
            if (chain._mode === 'update' && outcome === 'link') {
              // The FK case: the header write itself violates a foreign key — e.g. the
              // technician it names was removed along with the job (retryloop.test.js's
              // own FK_TICKET fixture is this exact shape). A real, direct refusal, not
              // the empty-match path a version conflict takes below.
              calls.push({ table, action: 'update-fk-violation', row: chain._row });
              result = { data: null, error: { message:
                'insert or update on table "tickets" violates foreign key constraint "tickets_technician_id_fkey"' } };
            } else if (chain._mode === 'update') {
              // The MK_STALE case: a version-guarded update that matches nothing because
              // someone else's edit already moved the version on.
              calls.push({ table, action: 'update', row: chain._row });
              result = { data: [], error: null };
            } else if (chain._mode === 'upsert' || chain._mode === 'insert') {
              calls.push({ table, action: chain._mode, row: chain._row });
              result = { data: [chain._row], error: null };
            } else {
              // The MK_STALE-detection fallback SELECT — only reached in the 'stale'
              // scenario, since 'link' never gets past the update's own error above.
              calls.push({ table, action: 'select-exists' });
              result = { data: [{ id: TICKET_ID }], error: null };
            }
            return Promise.resolve(result).then(ok, no);
          },
        };
        return chain;
      },
      auth: { getSession: () => Promise.resolve({ data: { session: {} }, error: null }) },
    };

    const fn = new Function('OUTBOX_K', 'DEADLETTER_K', 'OUTBOX_TRIES', 'ERRLOG_K',
                            'ERRLOG_MAX', 'SK', 'AUTH_RESTORE_TIMEOUT_MS', 'sb', `
      ${parts}
      return outboxDrain;
    `)(OUTBOX_K, DEADLETTER_K, 5, ERRLOG_K, ERRLOG_MAX, 'makaman.jobtickets.session.v1', AUTH_RESTORE_TIMEOUT_MS, () => stub);

    return fn().then(() => new Promise((r) => setTimeout(r, 200))).then(() => ({
      lineWasSent: calls.some((c) => c.table === 'ticket_lines' && c.action === 'upsert'),
      remaining: JSON.parse(localStorage.getItem(OUTBOX_K) || '[]').map((o) => o.key),
      dead: JSON.parse(localStorage.getItem(DEADLETTER_K) || '[]'),
    }));
  }, headerOutcome);
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── A stale header edit must not swallow the unrelated line queued behind it ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    const r = await runDrain(p, 'stale');
    check('the job-log line is actually sent, not silently discarded',
      r.lineWasSent, JSON.stringify(r));
    check('the live queue ends up empty — nothing left half-sent',
      r.remaining.length === 0, JSON.stringify(r.remaining));
    check('exactly one dead-letter entry, for the header alone',
      r.dead.length === 1 && r.dead[0].op.key === 'tickets:t-collateral-stale',
      JSON.stringify(r.dead.map((d) => d.op.key)));
    check('the stale header refusal is still honestly recorded as terminal',
      r.dead[0].terminal === true);
    check('and it carries no "also swept up" count, because nothing else was',
      !r.dead[0].also, JSON.stringify(r.dead[0]));
    await ctx.close();
  }

  // ── The genuinely correct case — the ticket itself is gone — still sweeps its rows ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    const r = await runDrain(p, 'link');
    check('when the ticket truly does not exist, the sibling line is NOT sent',
      !r.lineWasSent, JSON.stringify(r));
    check('one dead-letter entry, naming the whole job retired together',
      r.dead.length === 1 && r.dead[0].also === 1, JSON.stringify(r.dead));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
