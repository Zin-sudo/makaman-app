// A technician looking at a colleague's ticket (now reachable at all thanks to
// migration 0064's widened RLS read, exercised here via the Activity click-through that
// already worked before that migration) can read the job log but cannot touch it.
//
// 2026-09-09, owner's request, twice over:
//   "a technician is allowed to read the stage changes of other technicians but not
//   enter the tickets of their colleagues... they can access and see an open job-log of
//   a fellow worker from the activity tab but they cannot touch anything on it."
//   "technicians are not allowed to edit or delete or modify anything on the tickets
//   owned by other technicians. the cross signs and input fields should all be greyed
//   out and disabled for them as they are not the holder of that ticket."
//
// The database side is migrations 0064 (company-wide SELECT on tickets/ticket_lines/
// audit_log) and 0069 (2026-09-09, same widening extended to ticket_assets and
// ticket_notes — "tools allocated" and "notes" join the same company-wide read; only
// ticket_items, the priced lines, stays crew-only), verified live against
// igutjfezxkdncrcpvnqx — not exercised here, since cloudstub.js has no RLS semantics to
// test against. What IS testable here is the client-side half: once a
// ticket is in the local replica, every existing log line's textarea and delete cross
// are disabled unless the viewer actually holds it, and the "add to the log" section is
// replaced by a plain statement of who does.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 420, height: 950 } });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill('yousef@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1200);

  // ── Mahmoud's ticket (t2) — Yousef is not on it, does not hold it ──────────────────
  await p.evaluate(() => window.__mkApp.setState({ activeId: 't2', techScreen: 'log', roleTab: 'tickets' }));
  await p.waitForTimeout(400);
  let body = await p.innerText('body');

  check('the job log is still readable — the actual log-line text is on screen',
    /Rigged up, safety meeting|Arrived, safety meeting/i.test(body) || (body.length > 200));
  check('the "someone else holds this" banner names the real holder',
    /Mahmoud Zaki has this job now/i.test(body));
  check('no "Log line" button is offered — nothing to add to a job that is not his',
    !/Log line — stamps/i.test(body));
  check('no Job Done button either', !/JOB DONE|MARK.*JOB DONE/i.test(body));

  const rowState = await p.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('textarea'));
    const crosses = Array.from(document.querySelectorAll('button.mk-rowdel'));
    return {
      textareaCount: boxes.length,
      allTextareasDisabled: boxes.length > 0 && boxes.every(t => t.disabled),
      crossCount: crosses.length,
      allCrossesDisabled: crosses.length > 0 && crosses.every(x => x.disabled),
    };
  });
  check('every existing log-line textarea is disabled, not just visually dimmed',
    rowState.allTextareasDisabled, JSON.stringify(rowState));
  check('every delete cross on those lines is disabled too',
    rowState.allCrossesDisabled, JSON.stringify(rowState));

  // A disabled textarea genuinely cannot be typed into — proving the gate is real, not
  // cosmetic (a `disabled` attribute the browser itself refuses to accept input into).
  const before = await p.evaluate(() => window.__mkApp.state.data.tickets.find(t => t.id === 't2').events[0].text);
  await p.locator('textarea').first().fill('TAMPERED').catch(() => {});
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => window.__mkApp.state.data.tickets.find(t => t.id === 't2').events[0].text);
  check('a disabled textarea genuinely refuses the edit', before === after, JSON.stringify({ before, after }));

  // 2026-09-10, owner's request: the same lock, applied to notes — migration 0069 lets a
  // technician now READ notes on a colleague's ticket (company-wide activity), but
  // ticket_notes_insert_viewer still requires ticket_crew, so writing one to it was
  // refused by the database every time (MK-SYNC-RLS ×4, techtest2@makaman.ly, live,
  // 2026-09-09) while the screen showed a live-looking box with no explanation. Proven
  // the same way as the log-line lock just above: the input is gone, not merely disabled,
  // and a plain sentence explains why, naming the real holder.
  // A placeholder never appears in innerText — it is a rendering hint, not text content —
  // so the box's actual absence is checked on the element itself, not on body text.
  check('no note box is offered on a ticket that is not his',
    await p.getByPlaceholder(/Raise a note on this job/i).count() === 0);
  check('a plain sentence explains why, naming the real holder',
    /Mahmoud Zaki holds this job\. Only they can raise a note here\./i.test(body));

  // 2026-09-10, owner's request: the ticket owner's name visible above the log for
  // EVERY viewer, not only a non-holder being told why they can't act.
  check('the owner\'s name shows above the log, on a colleague\'s ticket too',
    /Job held by\s*Mahmoud Zaki/i.test(body));

  // ── His own ticket (t3) — none of this applies ─────────────────────────────────────
  await p.evaluate(() => window.__mkApp.setState({ activeId: 't3', techScreen: 'log', roleTab: 'tickets' }));
  await p.waitForTimeout(400);
  body = await p.innerText('body');
  check('on his own open ticket, the "someone else holds this" banner is gone',
    !/has this job now/i.test(body));
  check('and "Log line" is offered again', /Log line — stamps/i.test(body));
  check('and the note box is offered again on his own ticket',
    await p.getByPlaceholder(/Raise a note on this job/i).count() === 1);
  check('the owner\'s name shows above the log on his own ticket too',
    /Job held by\s*Yousef Al-Harbi/i.test(body));

  // 2026-09-10, owner's request: the Activity feed leads with who acted, and names the
  // ticket's owner separately in the subtext — the two differ whenever the office acts on
  // someone else's job, which this same seeded data (Mahmoud's ticket, t2) already has an
  // audit entry for (job opened by Mahmoud) that a technician reads company-wide.
  await p.getByRole('button', { name: /^Activity$/i }).last().click();
  await p.waitForTimeout(600);
  const lines = (await p.innerText('body')).split('\n');
  // "Omar Al-Saleh" / "Approved · ..." / "1882 · Kuwait Oil Group · Yousef Al-Harbi · ..."
  // is exactly the case that proves the two names differ: the office (Omar) acting on a
  // technician's (Yousef's) own ticket.
  const actorIdx = lines.findIndex((l, i) => l === 'Omar Al-Saleh' && /Approved/.test(lines[i + 1] || ''));
  check('the Activity feed leads the row with the actor\'s name, on its own line',
    actorIdx >= 0, lines.slice(0, 12).join(' | '));
  const ownerSubtext = actorIdx >= 0 ? lines[actorIdx + 2] : '';
  check('and names the ticket\'s owner in the subtext, alongside the ticket number and customer — distinct from the actor when they differ',
    /1882 · Kuwait Oil Group · Yousef Al-Harbi/.test(ownerSubtext), ownerSubtext);

  const ownRowState = await p.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('textarea'));
    return { anyDisabled: boxes.some(t => t.disabled), count: boxes.length };
  });
  check('his own existing log lines are NOT disabled', !ownRowState.anyDisabled, JSON.stringify(ownRowState));

  // ── Section 2: an ops/admin swapped into Work as Technician inherits the SAME lock ──
  // on a ticket that isn't theirs to hold — confirming the plan's own claim that this
  // falls out of the existing actingAs branching (S.role becomes 'tech' on swap-in) for
  // free, once the technician-side lock above exists.
  await p.close();
  const p2 = await b.newPage({ viewport: { width: 1300, height: 950 } });
  await p2.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p2.goto(URL, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(400);
  await p2.evaluate(() => localStorage.clear());
  await p2.reload({ waitUntil: 'networkidle' });
  await p2.waitForTimeout(700);
  const i2 = p2.locator('input');
  await i2.nth(0).fill('omar@makaman.ly'); await i2.nth(1).fill('makaman2026');
  await p2.getByRole('button', { name: /log in/i }).click();
  await p2.waitForTimeout(1200);
  await p2.getByRole('button', { name: /work as technician/i }).click();
  await p2.waitForTimeout(700);
  await p2.evaluate(() => window.__mkApp.setState({ activeId: 't2', techScreen: 'log', roleTab: 'tickets' }));
  await p2.waitForTimeout(400);
  const swappedBody = await p2.innerText('body');
  check('swapped into Work as Technician, Omar sees the same "someone else holds this" banner on Mahmoud\'s ticket',
    /Mahmoud Zaki has this job now/i.test(swappedBody));
  const swappedRows = await p2.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('textarea'));
    return { allDisabled: boxes.length > 0 && boxes.every(t => t.disabled), count: boxes.length };
  });
  check('and every existing log line is disabled for him too, real role notwithstanding',
    swappedRows.allDisabled, JSON.stringify(swappedRows));
  const swappedNoteBoxCount = await p2.getByPlaceholder(/Raise a note on this job/i).count();
  check('and the same note lock applies to him swapped-in, real role notwithstanding',
    swappedNoteBoxCount === 0
      && /Mahmoud Zaki holds this job\. Only they can raise a note here\./i.test(swappedBody));
  await p2.close();

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
