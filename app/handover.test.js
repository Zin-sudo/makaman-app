// What happens to a ticket after it is approved.
//
// The rule: downloading the final four sheets IS sending them to the client, and the
// signed, stamped copies coming back IS what finance is waiting for. Neither is a button
// somebody has to remember to press afterwards — a status that depends on a person
// remembering to set it is a status that lies.
//
// So every assertion below drives the real action and then reads the status, rather than
// calling the transition directly. Two of them exist because the first version of this
// feature would have broken itself: the attachment gate demanded status === 'approved',
// so the download that produced 'sent_client' would have locked out the upload that was
// supposed to follow it.
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
  return t ? { status: t.status, sentClientAt: t.sentClientAt || null, sentFinanceAt: t.sentFinanceAt || null, synced: t.synced } : null;
}, id);
const audit = (p, id) => p.evaluate((tid) => {
  const t = (window.__mkApp.state.data.tickets || []).find(x => x.id === tid);
  return ((t && t.audit) || []).map(a => a.text);
}, id);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── Downloading the sheets sends them to the client ──────────────────────
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
    check('downloading the final sheets moves it to Sent to Client',
      after.status === 'sent_client', JSON.stringify(after));
    check('and stamps when that happened', !!after.sentClientAt, after.sentClientAt);
    check('and puts it back in the queue so the office learns about it', after.synced === false);
    check('the reason is in the ticket trail, with who did it',
      (await audit(p, id)).some(t => /downloaded the final sheets/i.test(t) && /Omar/.test(t)),
      JSON.stringify((await audit(p, id)).slice(-1)));

    // The chip has to say so, or the state change is invisible to the office.
    await p.evaluate((tid) => window.__mkApp.setState({ activeId: tid, mgrScreen: 'inbox', roleTab: 'tickets' }), id);
    await p.waitForTimeout(700);
    check('and the ticket reads SENT TO CLIENT on screen',
      /SENT TO CLIENT/i.test(await p.evaluate(() => document.body.innerText)));

    // Downloading again must not walk it anywhere.
    const dl2 = p.waitForEvent('download', { timeout: 30000 }).catch(() => null);
    await p.evaluate((tid) => {
      const t = window.__mkApp.state.data.tickets.find(x => x.id === tid);
      return window.__mkApp.exportTicketZip(t);
    }, id);
    await dl2;
    await p.waitForTimeout(800);
    check('downloading a second time changes nothing',
      (await statusOf(p, id)).status === 'sent_client');
    await ctx.close();
  }

  // ── A ticket at Sent to Client can still take its signed paperwork ───────
  //
  // This is the trap the feature would otherwise have set for itself.
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    const id = await approvedTicket(p);
    const gate = (tid) => p.evaluate((x) => {
      const t = window.__mkApp.state.data.tickets.find(y => y.id === x);
      return window.__mkApp.canAttachTo(t);
    }, tid);
    check('signed paperwork is accepted at approved', await gate(id));
    await p.evaluate((tid) => {
      window.__mkApp.mutate(d => { d.tickets.find(x => x.id === tid).status = 'sent_client'; });
    }, id);
    await p.waitForTimeout(400);
    check('and still accepted once the sheets have gone to the client', await gate(id));
    await p.evaluate((tid) => {
      window.__mkApp.mutate(d => { d.tickets.find(x => x.id === tid).status = 'sent_finance'; });
    }, id);
    await p.waitForTimeout(400);
    check('and still accepted after finance, so a second document can follow', await gate(id));
    // But not before approval — the original rule has to survive the widening.
    await p.evaluate((tid) => {
      window.__mkApp.mutate(d => { d.tickets.find(x => x.id === tid).status = 'done'; });
    }, id);
    await p.waitForTimeout(400);
    check('and refused before approval, exactly as before', !(await gate(id)));
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
    await p.evaluate((tid) => window.__mkApp.advanceTo(tid, 'sent_client', 'test'), id);
    await p.waitForTimeout(400);
    check('and cannot be walked back to the client afterwards',
      (await statusOf(p, id)).status === 'sent_finance');
    // A ticket that was never approved must not be dragged onto the chain at all.
    const open = await p.evaluate(() =>
      (window.__mkApp.state.data.tickets || []).filter(t => t.status === 'logging').map(t => t.id)[0]);
    await p.evaluate((tid) => window.__mkApp.advanceTo(tid, 'sent_client', 'test'), open);
    await p.waitForTimeout(400);
    check('a job still being logged cannot jump to Sent to Client',
      (await statusOf(p, open)).status === 'logging');
    await ctx.close();
  }

  // ── The later states are still "settled" everywhere it matters ──────────
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
        window.__mkApp.mutate(d => { d.tickets.find(x => x.id === tid).status = 'sent_client'; });
      }, id);
      await p.waitForTimeout(400);
      check('and stays sealed once it has gone to the client', await sealed(id));
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
