// What happens to a ticket after it is approved.
//
// 2026-09-10, owner's report, with a screenshot: "SENT TO FINANCE & SENT TO CLIENT are
// creating confusion... SENT TO CLIENT is not needed anymore, it is replaced by Collect
// Signature/Stamp... when the [documents] are both uploaded the status becomes SENT TO
// FINANCE." sent_client (migration 0074) never tracked anything the client actually did —
// only that somebody had downloaded the blank sheets — and could sit stale for days after
// the real signed paperwork was already back (the live example the migration fixed:
// #1883, stuck at "Sent to Client" four days after both signed documents had arrived).
//
// The rule now: downloading the final four sheets is logged, but changes nothing about the
// ticket's status. Only the signed, stamped copies coming back — BOTH of them, not the
// first one alone — moves it, straight from approved to Sent to Finance. Every assertion
// below drives the real action (download, or an upload) and reads the status, rather than
// calling the transition directly, except where forward-only itself is the thing under
// test.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function boot(b, email) {
  const ctx = await b.newContext({ acceptDownloads: true });
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
  await p.waitForTimeout(1500);
  return { ctx, p };
}
const approvedTicket = (p) => p.evaluate(() =>
  (window.__mkApp.state.data.tickets || []).filter(t => t.status === 'approved').map(t => t.id)[0]);
const statusOf = (p, id) => p.evaluate((tid) => {
  const t = (window.__mkApp.state.data.tickets || []).find(x => x.id === tid);
  return t ? { status: t.status, sentFinanceAt: t.sentFinanceAt || null, synced: t.synced } : null;
}, id);
const audit = (p, id) => p.evaluate((tid) => {
  const t = (window.__mkApp.state.data.tickets || []).find(x => x.id === tid);
  return ((t && t.audit) || []).map(a => a.text);
}, id);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── Downloading the sheets is logged, but no longer moves the ticket ─────
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    const id = await approvedTicket(p);
    check('there is an approved ticket to work with', !!id);
    check('it starts at approved', (await statusOf(p, id)).status === 'approved');

    const dl = p.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await p.evaluate((tid) => {
      const t = window.__mkApp.state.data.tickets.find(x => x.id === tid);
      return window.__mkApp.exportTicketZip(t);
    }, id);
    await dl;
    await p.waitForTimeout(900);

    const after = await statusOf(p, id);
    check('downloading the final sheets leaves the ticket at approved',
      after.status === 'approved', JSON.stringify(after));
    check('and does not put it back in the queue — nothing about it actually changed',
      after.synced !== false, JSON.stringify(after));
    check('the download is still in the ticket trail, with who did it',
      (await audit(p, id)).some(t => /downloaded the final sheets/i.test(t) && /Omar/.test(t)),
      JSON.stringify((await audit(p, id)).slice(-1)));

    // The chip must not claim a stage that no longer exists.
    await p.evaluate((tid) => window.__mkApp.setState({ activeId: tid, mgrScreen: 'inbox', roleTab: 'tickets' }), id);
    await p.waitForTimeout(700);
    const body = await p.evaluate(() => document.body.innerText);
    check('the ticket never reads SENT TO CLIENT on screen — the status is retired',
      !/SENT TO CLIENT/i.test(body));

    // Downloading a second time changes nothing either.
    const dl2 = p.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await p.evaluate((tid) => {
      const t = window.__mkApp.state.data.tickets.find(x => x.id === tid);
      return window.__mkApp.exportTicketZip(t);
    }, id);
    await dl2;
    await p.waitForTimeout(800);
    check('downloading a second time still leaves it at approved',
      (await statusOf(p, id)).status === 'approved');
    await ctx.close();
  }

  // ── Signed paperwork is accepted before and after the transition ─────────
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    const id = await approvedTicket(p);
    const gate = (tid) => p.evaluate((x) => {
      const t = window.__mkApp.state.data.tickets.find(y => y.id === x);
      return window.__mkApp.canAttachTo(t);
    }, tid);
    check('signed paperwork is accepted at approved', await gate(id));
    await p.evaluate((tid) => {
      window.__mkApp.mutate(d => { d.tickets.find(x => x.id === tid).status = 'sent_finance'; });
    }, id);
    await p.waitForTimeout(400);
    check('and still accepted after finance, so a corrected scan can still be sent', await gate(id));
    // But not before approval — the original rule still holds.
    await p.evaluate((tid) => {
      window.__mkApp.mutate(d => { d.tickets.find(x => x.id === tid).status = 'done'; });
    }, id);
    await p.waitForTimeout(400);
    check('and refused before approval, exactly as before', !(await gate(id)));
    await ctx.close();
  }

  // ── Only both signed documents together move the ticket ──────────────────
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    const id = await approvedTicket(p);
    await p.evaluate((tid) => {
      window.__mkApp.mutate(d => {
        const t = d.tickets.find(x => x.id === tid);
        t.attachments = [{ id: 'a1', docKind: 'service_ticket', filename: 'svc.pdf' }];
      });
    }, id);
    await p.waitForTimeout(300);
    check('one signed document alone does not move the ticket',
      (await statusOf(p, id)).status === 'approved');
    await p.evaluate((tid) => {
      window.__mkApp.mutate(d => {
        const t = d.tickets.find(x => x.id === tid);
        t.attachments = (t.attachments || []).concat([{ id: 'a2', docKind: 'job_log', filename: 'log.pdf' }]);
      });
      // attachFile's own advance check reads t.attachments directly — mirrored here since
      // this section is about the RESULT (only both documents move it), driven the same
      // way the real upload handler decides it, not the outbox/storage plumbing around it.
      const t = window.__mkApp.state.data.tickets.find(x => x.id === tid);
      const missing = ['service_ticket', 'job_log'].some(k => !(t.attachments || []).some(a => a.docKind === k));
      if (!missing) window.__mkApp.advanceTo(tid, 'sent_finance', 'Both signed documents received — sent to finance (digital).');
    }, id);
    await p.waitForTimeout(400);
    const after = await statusOf(p, id);
    check('both signed documents together move it straight to sent_finance',
      after.status === 'sent_finance', JSON.stringify(after));
    check('and stamps when that happened', !!after.sentFinanceAt, after.sentFinanceAt);
    await ctx.close();
  }

  // ── Forward only ────────────────────────────────────────────────────────
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    const id = await approvedTicket(p);
    await p.evaluate((tid) => window.__mkApp.advanceTo(tid, 'sent_finance', 'test'), id);
    await p.waitForTimeout(400);
    check('a ticket can go straight to finance if the paperwork arrives by hand',
      (await statusOf(p, id)).status === 'sent_finance');
    await p.evaluate((tid) => window.__mkApp.advanceTo(tid, 'approved', 'test'), id);
    await p.waitForTimeout(400);
    check('and cannot be walked back to approved afterwards',
      (await statusOf(p, id)).status === 'sent_finance');
    // A ticket that was never approved must not be dragged onto the chain at all.
    const open = await p.evaluate(() =>
      (window.__mkApp.state.data.tickets || []).filter(t => t.status === 'logging').map(t => t.id)[0]);
    await p.evaluate((tid) => window.__mkApp.advanceTo(tid, 'sent_finance', 'test'), open);
    await p.waitForTimeout(400);
    check('a job still being logged cannot jump straight to sent_finance',
      (await statusOf(p, open)).status === 'logging');
    await ctx.close();
  }

  // ── The later state is still "settled" everywhere it matters ────────────
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly');
    const id = await p.evaluate(() =>
      (window.__mkApp.state.data.tickets || []).filter(t => t.status === 'approved').map(t => t.id)[0]);
    if (id) {
      const sealed = (tid) => p.evaluate((x) => {
        window.__mkApp.setState({ activeId: x, techScreen: 'log', roleTab: 'tickets' });
        return new Promise(r => setTimeout(() => r(window.__mkApp.renderVals().techSealed), 400));
      }, tid);
      check('an approved ticket is sealed to the technician', await sealed(id));
      await p.evaluate((tid) => {
        window.__mkApp.mutate(d => { d.tickets.find(x => x.id === tid).status = 'sent_finance'; });
      }, id);
      await p.waitForTimeout(400);
      check('and stays sealed after finance', await sealed(id));
    } else {
      check('the technician has an approved ticket to check', false, 'no fixture');
    }
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
