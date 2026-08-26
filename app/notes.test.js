// Notes: someone wants attention on a ticket.
//
// A table, where notifications deliberately were not one. A notification is a projection
// of the audit trail — an entry you have not read — so storing it would duplicate
// something already recorded. A note carries its own words and its own state, raised then
// answered, and there is nothing to derive that from.
//
// The assertions check what a note SAYS, not merely that one exists. The first version of
// this feature stored the change event instead of its value, so every note read
// "[object Object]" — and a test that only counted notes and audit entries passed
// happily, because there genuinely was one of each. Only the screenshot showed it.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
const BODY = 'Customer disputes the mileage on this job.';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function onTicket(ctx, email) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1240, height: 1000 });
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
  await p.evaluate(() => {
    const app = window.__mkApp;
    const t = app.state.data.tickets.find(x => x.status !== 'approved') || app.state.data.tickets[0];
    app.setState({ activeId: t.id, mgrScreen: 'review', techScreen: 'log', roleTab: 'tickets' });
  });
  await p.waitForTimeout(900);
  return p;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── Raising one through the screen ──
  {
    const ctx = await b.newContext();
    const p = await onTicket(ctx, 'omar@makaman.ly');
    // innerText applies text-transform, so the heading reads NOTES on screen even though
    // the markup says Notes. Matching case-sensitively here reported the panel missing
    // while it was plainly on the page.
    check('the ticket carries a notes panel', /NOTES/.test(await p.innerText('body')));

    await p.getByPlaceholder('Raise a note on this job…').fill(BODY);
    await p.getByRole('button', { name: /^RAISE$/ }).click();
    await p.waitForTimeout(700);

    const r = await p.evaluate(() => {
      const t = window.__mkApp.ticket();
      const n = (t.notes || [])[0] || {};
      return { count: (t.notes || []).length, body: n.body, by: n.by, at: n.at,
               open: !n.resolvedAt,
               audit: (t.audit || []).filter(a => /Note raised/.test(a.text)).map(a => a.text) };
    });
    check('a note is stored', r.count === 1, String(r.count));
    // The assertion the first version was missing.
    check('and it says what was typed', r.body === BODY, JSON.stringify(r.body));
    check('attributed to whoever raised it', r.by === 'Omar Al-Saleh', r.by);
    check('and stamped', /^\d{4}-/.test(r.at || ''), r.at);
    check('it starts open', r.open);
    check('the trail records the raising, with the words', 
      r.audit.length === 1 && r.audit[0].indexOf(BODY) > 0, JSON.stringify(r.audit[0]));
    check('and the words are not an object', !/\[object/.test(r.audit[0] || ''));

    // Notifications derive from the trail, so raising a note tells people without wiring.
    const onScreen = await p.innerText('body');
    check('the note is shown on the ticket', onScreen.indexOf(BODY) >= 0);
    await ctx.close();
  }

  // ── Answering it ──
  {
    const ctx = await b.newContext();
    const p = await onTicket(ctx, 'omar@makaman.ly');
    await p.getByPlaceholder('Raise a note on this job…').fill(BODY);
    await p.getByRole('button', { name: /^RAISE$/ }).click();
    await p.waitForTimeout(600);
    await p.getByRole('button', { name: /^ANSWERED$/ }).click();
    await p.waitForTimeout(700);
    const r = await p.evaluate(() => {
      const t = window.__mkApp.ticket();
      const n = (t.notes || [])[0] || {};
      return { by: n.resolvedBy, at: n.resolvedAt, body: n.body,
               audit: (t.audit || []).filter(a => /Note answered/.test(a.text)).map(a => a.text),
               summary: (document.body.innerText.match(/\d+ open of \d+|\d+ · all answered/) || [])[0],
               buttonGone: !/ANSWERED/.test(document.body.innerText) };
    });
    check('answering names who answered', r.by === 'Omar Al-Saleh', r.by);
    check('and when', /^\d{4}-/.test(r.at || ''), r.at);
    check('the note itself is not altered', r.body === BODY);
    check('the trail records the answer too', r.audit.length === 1 && r.audit[0].indexOf(BODY) > 0);
    check('the panel says everything is answered', r.summary === '1 · all answered', r.summary);
    check('and offers no second answer', r.buttonGone);
    await ctx.close();
  }

  // ── Who may do what ──
  {
    const ctx = await b.newContext();
    const p = await onTicket(ctx, 'founder@makaman.ly');
    const r = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = app.ticket();
      app.addNote(t.id, 'Observer follow-up: check the surcharge on this one.');
      const raised = (app.ticket().notes || []).length;
      const id = (app.ticket().notes || [])[0];
      // The Observer raises; answering is the office's job.
      if (id) app.resolveNote(t.id, id.id);
      return {
        canAdd: app.hasPermission('note.add'),
        canResolve: app.hasPermission('note.resolve'),
        raised: raised,
        stillOpen: !((app.ticket().notes || [])[0] || {}).resolvedAt,
      };
    });
    check('the Observer may raise a note', r.canAdd && r.raised === 1, String(r.raised));
    check('but may not answer one', r.canResolve === false);
    check('and calling resolve anyway does nothing', r.stillOpen);
    await ctx.close();
  }

  // ── It reaches the database as one row per note, not a wholesale replace ──
  {
    const ctx = await b.newContext();
    const p = await onTicket(ctx, 'omar@makaman.ly');
    const wire = await p.evaluate(() => {
      const src = document.querySelector('script[type="text/x-dc"]').textContent;
      const seg = src.slice(src.indexOf("ops.push({ key: 'ticket_notes:'"), src.indexOf("ops.push({ key: 'ticket_notes:'") + 460);
      return {
        perNote: /key: 'ticket_notes:' \+ n\.id/.test(seg),
        upsert: /action: 'upsert'/.test(seg),
        notInChildTables: !/CHILD_TABLES = \[[^\]]*ticket_notes/.test(src),
      };
    });
    // `replace` deletes every row for the ticket and re-inserts them, and the insert
    // policy requires raised_by to be the caller — so a technician syncing a ticket the
    // office had also noted on would be refused outright.
    check('notes are not swept into the replace-all path', wire.notInChildTables);
    check('each note is its own upsert, keyed by its id', wire.perNote && wire.upsert);
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
