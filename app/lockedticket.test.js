// A technician's ticket-header edit reaching the server after the office has already
// approved it.
//
// 2026-09-04, reported live: ticket 1883 (69a35562) threw exactly this refusal once, and
// stayed queued — Self-check kept reporting it, retried, unchanged, because
// enforce_ticket_update_rules() (migration 0039) raises "Ticket already approved and can
// no longer be edited." every single time this exact edit is retried; the ticket does not
// go back to unapproved, so it can never turn into success. Nothing before this fix told
// outboxSend that — the error just fell through as MK-SYNC-UNKNOWN and sat in the queue
// retrying forever, the same failure mode MK_STALE already has a name and a cure for.
// This proves both halves: the send site marks it terminal, and the classifier gives it
// its own code instead of "not classified — read the server text below."
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

const REFUSAL = 'Ticket already approved and can no longer be edited.';

(async () => {
  // ── outboxSend marks this specific refusal terminal ──
  {
    const outboxSendSrc = grab('outboxSend');
    check('outboxSend is still a standalone function this test can isolate', !!outboxSendSrc);
    const outboxSend = new Function('return ' + outboxSendSrc)();
    const c = {
      from: () => ({
        update: () => ({ eq: () => ({ eq: () => ({ select: () =>
          Promise.resolve({ data: null, error: { message: REFUSAL } }) }) }) }),
      }),
    };
    const op = { table: 'tickets', action: 'upsert_ticket', row: { id: 't1', version: 3, jobType: 'PKR FOR CSG TEST' } };
    let caught = null;
    try { await outboxSend(c, op); } catch (e) { caught = e; }
    check('the refusal is thrown, not swallowed', !!caught, caught ? caught.message : '(nothing thrown)');
    check('it is marked terminal — this exact retry can never succeed',
      !!(caught && caught.mkTerminal), JSON.stringify(caught && caught.mkTerminal));
  }

  // ── errorKind() gives it a name of its own, not the generic fallback ──
  {
    const errorKindSrc = grab('errorKind');
    check('errorKind is still a standalone function this test can isolate', !!errorKindSrc);
    const errorKind = new Function('return ' + errorKindSrc)();
    const kind = errorKind({ message: REFUSAL });
    check('classified as LOCKED, not the generic UNKNOWN fallback', kind === 'LOCKED', 'got: ' + kind);

    // The description an office reader actually sees in the exported error log — has to
    // exist and say something other than "not classified".
    const descAt = src.indexOf('const ERROR_KIND = {');
    const descBlock = src.slice(descAt, src.indexOf('};', descAt));
    check('ERROR_KIND carries a plain-language line for LOCKED',
      /LOCKED:\s*'[^']*already approved[^']*'/i.test(descBlock));
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
