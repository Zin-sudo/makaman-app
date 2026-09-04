// One row's own sync status, not the account-wide banner.
//
// 2026-09-04, reported live: a technician logged a job-log line, saw the "N changes were
// refused" banner and an error-log entry, and had no way to tell whether the banner was
// about the line she had just typed or something else queued from earlier — the banner
// only ever speaks for the whole account. opStatus() answers the question for one row: a
// job-log line or a note now carries its own pending/failed marker, read off its own
// outbox key, so a person can point at the exact thing that did or did not save.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function office(ctx) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 1000 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1400);
  return p;
}

// Puts one op for the given key into the live outbox (pending) or the dead-letter pile
// (failed, with a reason) — by hand, the same way starvation.test.js and deadletter.test.js
// already stage the piles this app actually reads from, rather than waiting on a real drain.
// setState({}) forces the redraw opStatus() needs to be re-read on — staging straight into
// localStorage, same as starvation.test.js/deadletter.test.js already do, does not itself
// touch React state, so nothing would repaint without this.
const stagePending = (p, key) => p.evaluate((k) => {
  const acct = (window.__mkApp.state.session || {}).email;
  const ok = 'makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : '');
  localStorage.setItem(ok, JSON.stringify([
    { key: k, table: 'x', action: 'upsert', seq: 1, acct: acct, row: {} },
  ]));
  window.__mkApp.setState({});
}, key);
const stageFailed = (p, key, reason) => p.evaluate(([k, why]) => {
  const acct = (window.__mkApp.state.session || {}).email;
  const dk = 'makaman.outbox.refused.v1' + (acct ? '.' + acct.toLowerCase() : '');
  localStorage.setItem(dk, JSON.stringify([
    { at: new Date().toISOString(), op: { key: k, table: 'x', row: {} }, why: why, n: 1, terminal: false },
  ]));
  window.__mkApp.setState({});
}, [key, reason]);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── Job-log lines: pending and failed are per-line, not per-ticket ────────
  {
    const ctx = await b.newContext();
    const p = await office(ctx);
    const ids = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || []).find(x => (x.events || []).length >= 2);
      app.setState({ activeId: t.id, mgrScreen: 'review', roleTab: 'tickets' });
      return { ticketId: t.id, first: t.events[0].id, second: t.events[1].id };
    });
    await p.waitForTimeout(400);

    // Nothing queued or refused yet — neither line shows a marker.
    let dots = await p.evaluate(() => ({
      pending: document.querySelectorAll('.mk-sync-pending').length,
      failed: document.querySelectorAll('.mk-sync-failed').length,
    }));
    check('a settled ticket shows no sync markers at all', dots.pending === 0 && dots.failed === 0,
      JSON.stringify(dots));

    // The FIRST line is still queued; the second is untouched.
    await stagePending(p, 'ticket_lines:' + ids.first);
    await p.waitForTimeout(300);
    dots = await p.evaluate(() => ({
      pending: document.querySelectorAll('.mk-sync-pending').length,
      failed: document.querySelectorAll('.mk-sync-failed').length,
    }));
    check('exactly one line shows the pending marker, not the whole log',
      dots.pending === 1 && dots.failed === 0, JSON.stringify(dots));

    // Swap to the SECOND line being refused, the first now settled.
    await p.evaluate((k) => {
      const acct = (window.__mkApp.state.session || {}).email;
      localStorage.removeItem('makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : ''));
    });
    const reason = 'The server would not accept this change from your account.';
    await stageFailed(p, 'ticket_lines:' + ids.second, reason);
    await p.waitForTimeout(300);
    const seen = await p.evaluate((why) => {
      const failedDots = Array.from(document.querySelectorAll('.mk-sync-failed'));
      return {
        pending: document.querySelectorAll('.mk-sync-pending').length,
        failedCount: failedDots.length,
        titleMatches: failedDots.some(d => d.title === why),
      };
    }, reason);
    check('the marker moves to whichever line the refusal actually names',
      seen.pending === 0 && seen.failedCount === 1, JSON.stringify(seen));
    check('and its tooltip carries the SAME reason the banner would show, not a generic label',
      seen.titleMatches, JSON.stringify(seen));
    await ctx.close();
  }

  // ── Notes: the same per-row answer, on a completely different table ──────
  {
    const ctx = await b.newContext();
    const p = await office(ctx);
    const ids = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = app.state.data.tickets.find(x => x.id) || app.state.data.tickets[0];
      const noteId = 'n-sync-test';
      app.mutate((d) => {
        const x = d.tickets.find(y => y.id === t.id);
        x.notes = (x.notes || []).concat([{ id: noteId, by: 'Yousef Al-Harbi',
          at: new Date().toISOString(), body: 'Sync-status probe note', resolvedBy: '', resolvedAt: '' }]);
      });
      app.setState({ activeId: t.id, mgrScreen: 'review', roleTab: 'tickets' });
      return { ticketId: t.id, noteId: noteId };
    });
    await p.waitForTimeout(400);

    let dots = await p.evaluate(() => document.querySelectorAll('.mk-sync-pending, .mk-sync-failed').length);
    check('a freshly-added note with nothing queued against it shows no marker', dots === 0, String(dots));

    await stagePending(p, 'ticket_notes:' + ids.noteId);
    await p.waitForTimeout(300);
    dots = await p.evaluate(() => document.querySelectorAll('.mk-sync-pending').length);
    check('once its own op is queued, the note shows pending', dots === 1, String(dots));

    const reason = 'The server would not accept this change from your account.';
    await p.evaluate((k) => {
      const acct = (window.__mkApp.state.session || {}).email;
      localStorage.removeItem('makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : ''));
    });
    await stageFailed(p, 'ticket_notes:' + ids.noteId, reason);
    await p.waitForTimeout(300);
    const failedTitle = await p.evaluate(() => {
      const d = document.querySelector('.mk-sync-failed');
      return d ? d.title : null;
    });
    check('and once refused, it names the reason for that one note',
      failedTitle === reason, String(failedTitle));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
