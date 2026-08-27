// Unwinding a ticket: cancelling one that was called off, withdrawing one raised in
// error, and putting a withdrawn one back.
//
// Three gaps reported from real use. A technician who opened a ticket and then had the
// job cancelled had no honest way out — "Job Done" would have been a lie about work
// nobody did, so the choice was between a false record and a ticket that never closes.
// The office could not remove a ticket raised against the wrong customer. And nothing
// that was removed left an explanation behind.
//
// The last of those is what most of these assertions are about. Withdrawing is a soft
// delete: the row and its whole trail stay, the working lists stop showing it, and the
// person who raised it can read who took it away and why. A test that only checked "the
// ticket is gone from the inbox" would pass just as well for a hard delete, which is the
// thing this must not be.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(ctx, email) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1180, height: 950 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1300);
  return p;
}
// t3 is Yousef's, still logging. t2 is Mahmoud's, closed and awaiting review.
// t1 is approved.
const openTech = (p, id) => p.evaluate((x) =>
  window.__mkApp.setState({ activeId: x, techScreen: 'log', roleTab: 'tickets' }), id);
const openOffice = (p, id) => p.evaluate((x) =>
  window.__mkApp.setState({ activeId: x, mgrScreen: 'review', roleTab: 'tickets' }), id);
const text = (p) => p.evaluate(() => document.body.innerText);
const ticket = (p, id) => p.evaluate((x) => {
  const t = window.__mkApp.state.data.tickets.find(y => y.id === x) || {};
  return {
    status: t.status, cancelReason: t.cancelReason || '', cancelledBy: t.cancelledBy || '',
    deletedAt: t.deletedAt || '', deletedBy: t.deletedBy || '', deleteReason: t.deleteReason || '',
    audit: (t.audit || []).map(a => a.text),
    items: (t.items || []).length,
    events: (t.events || []).length,
  };
}, id);
// The dialog's textarea, not whichever textarea happens to come first in the document.
// The technician's log screen has one of its own, and picking that one silently typed the
// reason into the job log instead of into the dialog — the confirm then read an empty
// reason and recorded a withdrawal with no why, which is the exact failure this feature
// exists to prevent.
const reasonBox = (p) => p.locator('textarea[placeholder*="recorded in the audit trail"]');

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── A technician calls off his own job ───────────────────────────────────
  {
    const ctx = await b.newContext();
    const p = await signIn(ctx, 'yousef@makaman.ly');
    await openTech(p, 't3');
    await p.waitForTimeout(500);
    check('the technician is offered a way to call off his own open job',
      /call it off/i.test(await text(p)));

    // Pressing it must ask, not act.
    await p.getByRole('button', { name: /call it off/i }).click();
    await p.waitForTimeout(400);
    const asking = await text(p);
    check('pressing it asks first', /Cancel this job\?/i.test(asking));
    check('and the ticket has not moved yet',
      (await ticket(p, 't3')).status === 'logging', (await ticket(p, 't3')).status);
    check('the wall says what cannot be undone',
      /only the office can reopen/i.test(asking));

    // Backing out leaves it alone.
    await p.getByRole('button', { name: /keep it open/i }).click();
    await p.waitForTimeout(400);
    check('backing out leaves the job open', (await ticket(p, 't3')).status === 'logging');

    // Go through with it, with a reason.
    await p.getByRole('button', { name: /call it off/i }).click();
    await p.waitForTimeout(400);
    await reasonBox(p).fill('Client stood the rig down before we reached the well.');
    await p.getByRole('button', { name: /yes, cancel the job/i }).click();
    await p.waitForTimeout(700);

    const t3 = await ticket(p, 't3');
    check('the job is cancelled', t3.status === 'cancelled', t3.status);
    check('the reason is kept on the ticket',
      /stood the rig down/.test(t3.cancelReason), JSON.stringify(t3.cancelReason));
    check('and the person who did it is named', t3.cancelledBy === 'Yousef Al-Harbi', t3.cancelledBy);
    const line = t3.audit.filter(x => /cancelled/i.test(x)).pop() || '';
    check('the audit trail names the person and the reason',
      /Yousef Al-Harbi/.test(line) && /stood the rig down/.test(line), JSON.stringify(line));

    // It is not a deletion.
    check('cancelling is not withdrawing — the ticket is still in the record',
      !t3.deletedAt, JSON.stringify(t3.deletedAt));
    check('and it says so on the screen',
      /called off/i.test(await text(p)));

    // And he cannot undo it himself, which the wall promised.
    await p.waitForTimeout(200);
    check('the technician cannot take it back himself',
      await p.evaluate(() => !window.__mkApp.canCancel(window.__mkApp.ticket('t3'))));
    await ctx.close();
  }

  // ── The technician gets no control he is not entitled to ─────────────────
  {
    const ctx = await b.newContext();
    const p = await signIn(ctx, 'yousef@makaman.ly');
    // t1 is his, and approved. A closed job is the office's to unwind.
    await openTech(p, 't1');
    await p.waitForTimeout(500);
    const seen = await text(p);
    check('no cancel control on a job that is already closed', !/call it off/i.test(seen));
    check('and no withdraw control anywhere for a technician', !/withdraw this ticket/i.test(seen));
    check('the rules agree', await p.evaluate(() => {
      const a = window.__mkApp;
      return !a.canCancel(a.ticket('t1')) && !a.canWithdraw(a.ticket('t1'));
    }));
    await ctx.close();
  }

  // ── The office withdraws a ticket ────────────────────────────────────────
  {
    const ctx = await b.newContext();
    const p = await signIn(ctx, 'omar@makaman.ly');
    const before = await ticket(p, 't2');
    await openOffice(p, 't2');
    await p.waitForTimeout(500);
    check('the office is offered the withdrawal', /withdraw this ticket/i.test(await text(p)));

    await p.getByRole('button', { name: /withdraw this ticket/i }).click();
    await p.waitForTimeout(400);
    const wall = await text(p);
    check('it asks first', /Withdraw this ticket\?/i.test(wall));
    check('the wall promises nothing is erased', /Nothing is erased/i.test(wall));
    check('and the ticket is untouched until it is confirmed',
      !(await ticket(p, 't2')).deletedAt);

    await reasonBox(p).fill('Raised against the wrong customer.');
    await p.getByRole('button', { name: /withdraw it/i }).click();
    await p.waitForTimeout(800);

    const t2 = await ticket(p, 't2');
    check('the ticket is withdrawn', !!t2.deletedAt, JSON.stringify(t2.deletedAt));
    check('by a named person', t2.deletedBy === 'Omar Al-Saleh', t2.deletedBy);
    check('with the reason kept', /wrong customer/.test(t2.deleteReason), t2.deleteReason);
    // The point of a soft delete: nothing went with it. Measured against what this
    // ticket actually held before the withdrawal — asserting "more than zero items"
    // would be asserting something about the fixture, not about the feature.
    check('the job log survives it',
      t2.events === before.events && t2.events > 0, before.events + ' -> ' + t2.events);
    check('the charged lines survive it',
      t2.items === before.items, before.items + ' -> ' + t2.items);
    check('and the audit trail grew rather than went',
      t2.audit.length > before.audit.length, before.audit.length + ' -> ' + t2.audit.length);
    const wline = t2.audit.filter(x => /withdrawn/i.test(x)).pop() || '';
    check('the trail names who withdrew it and why',
      /Omar Al-Saleh/.test(wline) && /wrong customer/.test(wline), JSON.stringify(wline));

    // It leaves the working lists.
    await p.evaluate(() => window.__mkApp.setState({ mgrScreen: 'inbox' }));
    await p.waitForTimeout(600);
    const inbox = await text(p);
    check('it is gone from the inbox table',
      !/Al-Dhafra Energy[\s\S]{0,200}Review/i.test(inbox));
    // But not into thin air.
    check('and listed as withdrawn, where it can be found',
      /withdrawn ticket/i.test(inbox));
    check('the withdrawn entry says who and why',
      /Omar Al-Saleh/.test(inbox) && /wrong customer/i.test(inbox));

    // Restore.
    await openOffice(p, 't2');
    await p.waitForTimeout(500);
    check('a withdrawn ticket says so when opened', /has been withdrawn/i.test(await text(p)));
    await p.getByRole('button', { name: /restore this ticket/i }).click();
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /restore it/i }).click();
    await p.waitForTimeout(700);
    const back = await ticket(p, 't2');
    check('restoring brings it back', !back.deletedAt);
    check('at the status it held', back.status === 'done', back.status);
    check('and the restore is recorded too',
      back.audit.some(x => /restored/i.test(x)));
    await ctx.close();
  }

  // ── The person who raised it is told ─────────────────────────────────────
  //
  // The whole reason withdrawal is a soft delete. A removal the technician can only
  // discover by noticing his ticket has vanished is not a record of anything.
  {
    const ctx = await b.newContext();
    const p = await signIn(ctx, 'mahmoud@makaman.ly');
    await p.evaluate(() => {
      const a = window.__mkApp;
      a.mutate((d) => {
        const x = d.tickets.find(y => y.id === 't2');
        x.deletedAt = new Date().toISOString();
        x.deletedBy = 'Omar Al-Saleh';
        x.deleteReason = 'Duplicate of ticket 1882.';
        (x.audit = x.audit || []).push({
          ts: new Date().toISOString(), kind: 'lifecycle', by: 'Omar Al-Saleh',
          text: 'Ticket withdrawn by Omar Al-Saleh — Duplicate of ticket 1882.',
        });
      });
    });
    await openTech(p, 't2');
    await p.waitForTimeout(600);
    const seen = await text(p);
    check('the technician who raised it is told the office withdrew it',
      /office withdrew this ticket/i.test(seen));
    check('and reads the reason without asking anyone',
      /Duplicate of ticket 1882/.test(seen), seen.slice(0, 60).replace(/\n/g, ' | '));
    check('and who did it', /Omar Al-Saleh/.test(seen));
    await ctx.close();
  }

  // ── A charge line typed from nothing ─────────────────────────────────────
  //
  // The office raises tickets for customers with no price list at all — a first job for
  // a new client — and the only route onto the charge table used to be picking a code
  // from a list that did not exist.
  {
    const ctx = await b.newContext();
    const p = await signIn(ctx, 'omar@makaman.ly');
    await openOffice(p, 't2');
    await p.waitForTimeout(500);
    check('the office can add a line by hand', /add a line by hand/i.test(await text(p)));

    const was = (await ticket(p, 't2')).items;
    await p.getByRole('button', { name: /add a line by hand/i }).click();
    await p.waitForTimeout(600);
    const now = await ticket(p, 't2');
    check('pressing it adds a row', now.items === was + 1, was + ' -> ' + now.items);
    check('and the row is recorded as an edit like any other',
      now.audit.some(x => /added by hand/i.test(x)));

    // The new row must be typeable, not a placeholder. Its cells are inputs, and the
    // last row's code cell is empty and editable.
    const editable = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = app.state.data.tickets.find(y => y.id === 't2');
      const last = (t.items || [])[t.items.length - 1];
      return { code: last.code, desc: last.desc, qty: last.qty };
    });
    check('the row starts empty for typing, with a quantity of one',
      editable.code === '' && editable.desc === '' && editable.qty === 1,
      JSON.stringify(editable));

    // A customer with no price list gets told, rather than a search box that silently
    // returns nothing.
    await p.evaluate(() => {
      window.__mkApp.mutate((d) => {
        const x = d.tickets.find(y => y.id === 't2');
        x.customer = 'Brand New Client Ltd';
      });
    });
    await p.waitForTimeout(700);
    const empty = await text(p);
    check('a customer with no price list is told so in words',
      /no price list for this customer yet/i.test(empty));
    check('and the by-hand control is still there', /add a line by hand/i.test(empty));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
