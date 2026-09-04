// Staff resolving a note somebody ELSE raised.
//
// 2026-09-04, confirmed live: an ops manager resolving a note the field had raised was
// refused as an RLS violation on ticket_notes, every retry, for hours — even though
// ticket_notes_update_staff (is_staff() only) plainly allows it. The cause is a genuine
// Postgres RLS gotcha: INSERT ... ON CONFLICT DO UPDATE (what an upsert compiles to)
// checks the INSERT policy's WITH CHECK first, and ticket_notes' insert policy requires
// raised_by = auth.uid() — which is the ORIGINAL author, not the person resolving it.
// diffOps() now sends an edit to somebody else's note as a real update instead, which
// only has to satisfy is_staff(); a note this device raised itself keeps the upsert,
// because the coalescer could otherwise turn a still-unsent insert into an update that
// matches no row at all.
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

// diffOps() itself pulls in the entire ticket-header diff machinery (rowTicket,
// clampLoc, and everything those call) just to reach the notes block a few hundred
// lines in — none of it relevant here. Extracted by its own start/end markers instead,
// the exact snippet from the running source rather than a hand-copied stand-in that
// could quietly drift from it.
const NOTES_START = src.indexOf('// Notes are append-and-answer, never a list to be replaced.');
const NOTES_END = src.indexOf('\n\n', src.indexOf('});', NOTES_START) );
if (NOTES_START < 0 || NOTES_END < 0) throw new Error('notes diff block markers moved — update this test');
const notesSnippet = src.slice(NOTES_START, NOTES_END);
check('the notes-diffing snippet was found in the running source', notesSnippet.length > 200);

// tsOut is `const tsOut = (v) => ...`, not `function tsOut(`, so grab()'s brace-matching
// (built for named function declarations) cannot pull it out — hardcoded here instead,
// same reason other suites in this project hardcode a handful of consts alongside grab().
const parts = ['buildUserIndex'].map(grab).filter(Boolean).join('\n');
const CLOUD_IDS = { me: null, job: {} };
const diffOps = new Function('CLOUD_IDS', `
  const tsOut = (v) => (v ? new Date(v).toISOString() : null);
  ${parts}
  return function diffOps(before, after) {
    const ops = [];
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const idByName = buildUserIndex(after.users).idByName;
    const oldT = {}; (before.tickets || []).forEach((t) => { oldT[t.id] = t; });
    ${notesSnippet}
    return ops;
  };
`)(CLOUD_IDS);

const TECH = 't-1111', MGR = 'm-2222', TICKET = 'tk-1';
const baseUsers = [
  { id: TECH, name: 'Yousef Al-Harbi', email: 'yousef@makaman.ly' },
  { id: MGR, name: 'Omar Al-Saleh', email: 'omar@makaman.ly' },
];
const ticketWith = (notes) => ({
  id: TICKET, customer: 'Kuwait Oil Group', field: 'X', well: 'Y', rig: 'Z',
  notes: notes,
});

(async () => {
  // ── Resolving somebody ELSE's note: must be a real update, not an upsert ──
  {
    CLOUD_IDS.me = MGR; // Omar (ops_manager) is signed in on this device
    const raised = { id: 'n1', by: 'Yousef Al-Harbi', at: '2026-09-04T13:00:00.000Z',
      body: 'Test', resolvedBy: '', resolvedAt: '' };
    const before = { tickets: [ticketWith([raised])], users: baseUsers };
    const resolved = Object.assign({}, raised, { resolvedBy: 'Omar Al-Saleh', resolvedAt: '2026-09-04T13:05:00.000Z' });
    const after = { tickets: [ticketWith([resolved])], users: baseUsers };
    const ops = diffOps(before, after);
    const op = ops.find(o => o.key === 'ticket_notes:n1');
    check('an op is actually queued for the resolve', !!op);
    check('it is sent as a real update, not an upsert', op && op.action === 'update',
      op && op.action);
    check('the update targets the note by its own id', op && op.id === 'n1', op && op.id);
    check('the row carries no id field of its own — .eq() already targets it', op && !('id' in op.row));
    check('raised_by still names the original author, Yousef — not overwritten to the resolver',
      op && op.row.raised_by === TECH, op && op.row.raised_by);
    check('resolved_by correctly names Omar, who did the resolving',
      op && op.row.resolved_by === MGR, op && op.row.resolved_by);
  }

  // ── Raising and resolving your OWN note before either has ever synced: stays an upsert ──
  {
    CLOUD_IDS.me = MGR;
    const before1 = { tickets: [ticketWith([])], users: baseUsers };
    const raised = { id: 'n2', by: 'Omar Al-Saleh', at: '2026-09-04T13:00:00.000Z',
      body: 'My own note', resolvedBy: '', resolvedAt: '' };
    const after1 = { tickets: [ticketWith([raised])], users: baseUsers };
    const opsRaise = diffOps(before1, after1);
    const raiseOp = opsRaise.find(o => o.key === 'ticket_notes:n2');
    check('raising your own note queues an upsert (an insert)', raiseOp && raiseOp.action === 'upsert',
      raiseOp && raiseOp.action);

    // Now resolve it in a SECOND diff, exactly as mutate() would produce back to back —
    // before2 is after1, the same as the running app's own state.data after the first call.
    const resolved = Object.assign({}, raised, { resolvedBy: 'Omar Al-Saleh', resolvedAt: '2026-09-04T13:05:00.000Z' });
    const after2 = { tickets: [ticketWith([resolved])], users: baseUsers };
    const opsResolve = diffOps(after1, after2);
    const resolveOp = opsResolve.find(o => o.key === 'ticket_notes:n2');
    check('resolving your OWN note still queues an upsert, not an update',
      resolveOp && resolveOp.action === 'upsert', resolveOp && resolveOp.action);
    check('so the coalescer replacing the still-unsent insert can never leave an update matching no row',
      resolveOp && resolveOp.row && resolveOp.row.id === 'n2');
  }

  // ── A totally new, untouched note from someone else does not get queued at all ──
  {
    CLOUD_IDS.me = MGR;
    const raised = { id: 'n3', by: 'Yousef Al-Harbi', at: '2026-09-04T13:00:00.000Z',
      body: 'Untouched', resolvedBy: '', resolvedAt: '' };
    const before = { tickets: [ticketWith([raised])], users: baseUsers };
    const after = { tickets: [ticketWith([raised])], users: baseUsers }; // identical
    const ops = diffOps(before, after);
    check('nothing is queued for a note nobody touched', !ops.some(o => o.key === 'ticket_notes:n3'));
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
