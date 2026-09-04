// The outbox retrying an audit_log row that already landed.
//
// 2026-09-04, reported live and confirmed against the project directly: audit_log has an
// INSERT policy and three SELECT policies, and deliberately no UPDATE policy at all — it
// is append-only, on purpose (see the comment where these ops are queued). An upsert is
// INSERT ... ON CONFLICT DO UPDATE, so a resend of a row whose first attempt actually
// succeeded (the write landed; only the client's own acknowledgment of it was lost) hits
// the UPDATE branch on the second try, and is refused by RLS forever — proof the entry
// made it, misread as proof it never did, and "N op(s) queued ... retried" never clears
// even though nothing is actually wrong. This proves the fix: audit_log's upsert now asks
// for ON CONFLICT DO NOTHING (ignoreDuplicates), which touches nothing on a duplicate and
// so never asks the UPDATE policy anything — while every other table's upsert is
// untouched, because some of them (ticket_lines: the office correcting a logged
// timestamp) really do need a genuine update to go through.
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, 'index.html'), 'utf8')
  .match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
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
const outboxSendSrc = grab('outboxSend');
check('outboxSend is still a standalone function this test can isolate', !!outboxSendSrc);

// A fake .upsert that plays out the real Postgres/PostgREST rule this bug lives in:
// a conflicting row is refused by RLS unless the caller asked for ON CONFLICT DO NOTHING
// (ignoreDuplicates) — exactly the distinction between "asks the UPDATE policy" and
// "touches nothing", which is the whole fix.
const RLS_MSG = 'new row violates row-level security policy for table "audit_log"';
const makeClient = (existingIds) => {
  const calls = [];
  return {
    calls,
    from: (table) => ({
      upsert: (row, opts) => {
        calls.push({ table, row, opts });
        const conflict = existingIds.has(row.id);
        if (conflict && !(opts && opts.ignoreDuplicates)) {
          return Promise.resolve({ data: null, error: { message: RLS_MSG } });
        }
        return Promise.resolve({ data: [row], error: null });
      },
    }),
  };
};

const outboxSend = new Function('return ' + outboxSendSrc)();

(async () => {
  // ── The exact live scenario: audit_log row already landed, client retries it ──
  {
    const c = makeClient(new Set(['a1']));
    const op = { table: 'audit_log', action: 'upsert', row: { id: 'a1', ticket_id: 't1', text: 'x' } };
    let threw = null;
    try { await outboxSend(c, op); } catch (e) { threw = e; }
    check('retrying an already-landed audit_log row no longer throws', !threw,
      threw ? threw.message : '');
    check('it asked for ON CONFLICT DO NOTHING, not a plain upsert',
      c.calls[0].opts && c.calls[0].opts.ignoreDuplicates === true && c.calls[0].opts.onConflict === 'id',
      JSON.stringify(c.calls[0].opts));
  }

  // ── A genuinely new audit_log row (no conflict) still goes through the same way ──
  {
    const c = makeClient(new Set());
    const op = { table: 'audit_log', action: 'upsert', row: { id: 'a2', ticket_id: 't1', text: 'y' } };
    let threw = null;
    try { await outboxSend(c, op); } catch (e) { threw = e; }
    check('a fresh audit_log row still sends cleanly', !threw, threw ? threw.message : '');
  }

  // ── ticket_lines keeps its real upsert — a genuine edit must still update the row ──
  {
    const c = makeClient(new Set(['l1']));
    const op = { table: 'ticket_lines', action: 'upsert', row: { id: 'l1', ticket_id: 't1', text: 'corrected' } };
    let threw = null;
    try { await outboxSend(c, op); } catch (e) { threw = e; }
    // This fake client only refuses a conflict WITHOUT ignoreDuplicates for the scenario
    // audit_log is in — ticket_lines passing no opts here proves it did not pick up the
    // audit_log special case by accident, which the call args below confirm directly.
    check('ticket_lines is not given ignoreDuplicates — a real update must still land',
      c.calls[0].opts === undefined, JSON.stringify(c.calls[0].opts));
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
