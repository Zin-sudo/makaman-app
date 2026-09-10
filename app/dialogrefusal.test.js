// 2026-09-10, pre-purge audit, Parts 2+3: every confirm-handler that trusted a stale
// render, and every mutating button held up only by visibility.
//
// Five dialogs (handover, cancelJob, withdrawTicket, restoreTicket, reopen) checked almost
// nothing at the moment Confirm was actually pressed — they relied entirely on the button
// that opened them having been correctly hidden a render or two earlier. A ticket that
// changed underneath an already-open dialog (the office closed it, cancelled it, or someone
// else acted on it while this device sat on the confirmation screen) used to queue a write
// the database was always going to refuse — a dead-lettered op and a yellow banner over
// something that was never a genuine failure, only a permission/lifecycle question the UI
// should have caught first. A sixth dialog, reopenTech (reachable only through askJobDone's
// own gate, but the same class of staleness applies once it's open), got the same fix.
//
// Three buttons had no internal guard at all: approve() already refused correctly but
// silently; permClearAll() had no hasPermission('user.manage_permissions') check of its
// own, only the sibling button's `disabled`; the asset-row handlers (addAssetRow, remove,
// item/qty/note onChange) checked only `if (!t) return`, relying entirely on assetsEditable
// keeping the composer off-screen.
//
// Every case here puts the ticket (or the caller) into a state the opening button itself
// would never show, drives the handler directly the way a stale render or a race would, and
// asserts: a toast naming the reason appeared, and nothing was mutated or queued.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function login(p, email, pass_) {
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill(pass_ || 'makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1200);
}
const toastOf = (p) => p.evaluate(() => (window.__mkApp.state.toast || {}));
const ticket = (p, id) => p.evaluate((id) => window.__mkApp.state.data.tickets.find(x => x.id === id), id);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 420, height: 950 } });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);

  // ── Part 2: handover, technician branch ─────────────────────────────────────────────
  await login(p, 'yousef@makaman.ly');
  {
    // t3: logging, held by Yousef — canHandOver would be true, the button would show.
    await p.evaluate(() => window.__mkApp.setState({ activeId: 't3', dialog: 'handover', handoverTo: 'Mahmoud Zaki' }));
    await p.waitForTimeout(200);
    // The job moves on underneath the open dialog — cancelled while Confirm sat there.
    await p.evaluate(() => window.__mkApp.mutate(d => { d.tickets.find(x => x.id === 't3').status = 'cancelled'; }));
    await p.getByRole('button', { name: /^Hand over$/ }).click();
    await p.waitForTimeout(300);
    const t = await ticket(p, 't3');
    const toast = await toastOf(p);
    check('handover (tech): refused with a named-reason toast, not a silent no-op',
      toast.key === 'handover-stale', JSON.stringify(toast));
    check('handover (tech): the holder never actually changed', !t.holder, JSON.stringify(t.holder));
    check('handover (tech): the dialog closed', await p.evaluate(() => window.__mkApp.state.dialog) === null);
  }

  // ── Part 2: handover, office branch (mgrCanHandOver) ────────────────────────────────
  await login(p, 'omar@makaman.ly');
  {
    // t2: status 'done' — not settled, not cancelled — mgrCanHandOver would be true.
    await p.evaluate(() => window.__mkApp.setState({ activeId: 't2', dialog: 'handover', handoverTo: 'Yousef Al-Harbi' }));
    await p.waitForTimeout(200);
    await p.evaluate(() => window.__mkApp.mutate(d => { d.tickets.find(x => x.id === 't2').status = 'cancelled'; }));
    await p.getByRole('button', { name: /^Hand over$/ }).click();
    await p.waitForTimeout(300);
    const t = await ticket(p, 't2');
    const toast = await toastOf(p);
    check('handover (office): refused with a named-reason toast',
      toast.key === 'handover-stale', JSON.stringify(toast));
    check('handover (office): nothing handed over — the ticket keeps its original crew',
      t.holder !== 'Yousef Al-Harbi');
  }

  // ── Part 2: cancelJob ────────────────────────────────────────────────────────────────
  await login(p, 'yousef@makaman.ly');
  {
    // t3: logging, held by Yousef — canCancel would be true.
    await p.evaluate(() => window.__mkApp.setState({ activeId: 't3', dialog: 'cancelJob', reasonText: 'changed my mind' }));
    await p.waitForTimeout(200);
    // Left 'logging' underneath the dialog — the office closed it in the meantime.
    await p.evaluate(() => window.__mkApp.mutate(d => { d.tickets.find(x => x.id === 't3').status = 'done'; }));
    await p.getByRole('button', { name: /^Yes, cancel the job$/ }).click();
    await p.waitForTimeout(300);
    const t = await ticket(p, 't3');
    const toast = await toastOf(p);
    check('cancelJob: refused with a named-reason toast', toast.key === 'cancel-stale', JSON.stringify(toast));
    check('cancelJob: the ticket never actually became cancelled', t.status === 'done', t.status);
    check('cancelJob: the dialog closed', await p.evaluate(() => window.__mkApp.state.dialog) === null);
  }

  // ── Part 2: withdrawTicket ───────────────────────────────────────────────────────────
  await login(p, 'omar@makaman.ly');
  {
    // t2: status 'done', not deleted — canWithdraw would be true.
    await p.evaluate(() => window.__mkApp.mutate(d => { const x = d.tickets.find(y => y.id === 't2'); x.status = 'done'; x.deletedAt = ''; }));
    await p.evaluate(() => window.__mkApp.setState({ activeId: 't2', dialog: 'withdrawTicket', reasonText: 'duplicate entry' }));
    await p.waitForTimeout(200);
    // Reopened to 'logging' underneath the dialog — canWithdraw would now refuse it.
    await p.evaluate(() => window.__mkApp.mutate(d => { d.tickets.find(x => x.id === 't2').status = 'logging'; }));
    await p.getByRole('button', { name: /^Withdraw it$/ }).click();
    await p.waitForTimeout(300);
    const t = await ticket(p, 't2');
    const toast = await toastOf(p);
    check('withdrawTicket: refused with a named-reason toast', toast.key === 'withdraw-stale', JSON.stringify(toast));
    check('withdrawTicket: never actually withdrawn', !t.deletedAt, JSON.stringify(t.deletedAt));
  }

  // ── Part 2: restoreTicket ────────────────────────────────────────────────────────────
  {
    // t2: withdrawn — canRestore would be true.
    await p.evaluate(() => window.__mkApp.mutate(d => { const x = d.tickets.find(y => y.id === 't2'); x.status = 'done'; x.deletedAt = new Date().toISOString(); x.deletedBy = 'Omar Al-Saleh'; }));
    await p.evaluate(() => window.__mkApp.setState({ activeId: 't2', dialog: 'restoreTicket' }));
    await p.waitForTimeout(200);
    const auditBefore = (await ticket(p, 't2')).audit.length;
    // Restored by someone/something else underneath the dialog before Confirm was pressed.
    await p.evaluate(() => window.__mkApp.mutate(d => { const x = d.tickets.find(y => y.id === 't2'); x.deletedAt = ''; x.deletedBy = ''; }));
    await p.getByRole('button', { name: /^Restore it$/ }).click();
    await p.waitForTimeout(300);
    const t = await ticket(p, 't2');
    const toast = await toastOf(p);
    check('restoreTicket: refused with a named-reason toast', toast.key === 'restore-stale', JSON.stringify(toast));
    check('restoreTicket: no duplicate restore was logged', t.audit.length === auditBefore, t.audit.length + ' vs ' + auditBefore);
  }

  // ── Part 2: reopen (approved ticket) ────────────────────────────────────────────────
  {
    // t1: approved (settled) — the reopen button would show.
    await p.evaluate(() => window.__mkApp.mutate(d => { d.tickets.find(x => x.id === 't1').status = 'approved'; }));
    await p.evaluate(() => window.__mkApp.setState({ activeId: 't1', dialog: 'reopen', reasonText: 'wrong mileage' }));
    await p.waitForTimeout(200);
    // No longer settled underneath the dialog — already reopened another way.
    await p.evaluate(() => window.__mkApp.mutate(d => { d.tickets.find(x => x.id === 't1').status = 'done'; }));
    await p.getByRole('button', { name: /^Reopen & log$/ }).click();
    await p.waitForTimeout(300);
    const t = await ticket(p, 't1');
    const toast = await toastOf(p);
    check('reopen: refused with a named-reason toast', toast.key === 'reopen-stale', JSON.stringify(toast));
    check('reopen: status is exactly what it already was, not double-touched', t.status === 'done', t.status);
  }

  // ── Part 2: reopenTech ───────────────────────────────────────────────────────────────
  await login(p, 'yousef@makaman.ly');
  {
    // t3: not in 'logging' — reachable only by bypassing askJobDone's own gate directly.
    await p.evaluate(() => window.__mkApp.mutate(d => { d.tickets.find(x => x.id === 't3').status = 'done'; }));
    await p.evaluate(() => window.__mkApp.setState({ activeId: 't3', dialog: 'reopenTech' }));
    await p.waitForTimeout(200);
    // Cancelled underneath the dialog before Confirm — settled/officeClosed/cancelled all
    // refuse from here.
    await p.evaluate(() => window.__mkApp.mutate(d => { d.tickets.find(x => x.id === 't3').status = 'cancelled'; }));
    await p.getByRole('button', { name: /^Reopen$/ }).click();
    await p.waitForTimeout(300);
    const t = await ticket(p, 't3');
    const toast = await toastOf(p);
    check('reopenTech: refused with a named-reason toast', toast.key === 'reopentech-stale', JSON.stringify(toast));
    check('reopenTech: never sent back to logging', t.status === 'cancelled', t.status);
  }

  // ── Part 3: approve(), the existing silent refusal now names why ───────────────────
  await login(p, 'omar@makaman.ly');
  {
    // t1: already approved — the button is disabled/relabelled, called directly the way a
    // stale render or a double-press race would.
    await p.evaluate(() => window.__mkApp.mutate(d => { d.tickets.find(x => x.id === 't1').status = 'approved'; }));
    await p.evaluate(() => window.__mkApp.setState({ activeId: 't1' }));
    await p.waitForTimeout(200);
    const before = await ticket(p, 't1');
    await p.evaluate(() => window.__mkApp.renderVals().approve());
    await p.waitForTimeout(300);
    const after = await ticket(p, 't1');
    const toast = await toastOf(p);
    check('approve: the existing refusal now names why, not silence',
      toast.key === 'approve-stale' && /already approved/i.test(toast.text), JSON.stringify(toast));
    check('approve: nothing about the approval record changed',
      after.approvedAt === before.approvedAt && after.approvedBy === before.approvedBy);
  }

  // ── Part 3: permClearAll(), no manage_permissions check of its own ─────────────────
  {
    // Omar is an ops_manager — user.manage_permissions is admin-only by default.
    await p.evaluate(() => window.__mkApp.setState({ permUser: 'yousef@makaman.ly' }));
    await p.waitForTimeout(200);
    const overridesBefore = JSON.stringify(await p.evaluate(() => window.__mkApp.state.data.permissionOverrides));
    await p.evaluate(() => window.__mkApp.renderVals().permClearAll());
    await p.waitForTimeout(300);
    const overridesAfter = JSON.stringify(await p.evaluate(() => window.__mkApp.state.data.permissionOverrides));
    const toast = await toastOf(p);
    check('permClearAll: refused with a named-reason toast', toast.key === 'perm-clear-refused', JSON.stringify(toast));
    check('permClearAll: no override was actually cleared', overridesAfter === overridesBefore);
  }

  // ── Part 3: asset-row handlers, held up only by assetsEditable visibility ──────────
  await login(p, 'yousef@makaman.ly');
  {
    // t1: approved — status !== 'logging', so assetsEditable is false and the composer
    // would not even render. Seed a row directly and call the handlers the way a stale
    // render (or a script driving the binding) would.
    await p.evaluate(() => window.__mkApp.mutate(d => { d.tickets.find(x => x.id === 't1').status = 'approved'; d.tickets.find(x => x.id === 't1').assets = [{ item: 'Test Tool', qty: 1, note: '' }]; }));
    await p.evaluate(() => window.__mkApp.setState({ activeId: 't1' }));
    await p.waitForTimeout(200);

    await p.evaluate(() => window.__mkApp.renderVals().addAssetRow());
    await p.waitForTimeout(200);
    let t = await ticket(p, 't1');
    let toast = await toastOf(p);
    check('addAssetRow: refused with a named-reason toast, no row added',
      toast.key === 'asset-edit-stale' && t.assets.length === 1, JSON.stringify({ toast, assets: t.assets }));

    await p.evaluate(() => window.__mkApp.renderVals().assetRows[0].onItem({ target: { value: 'HACKED' } }));
    await p.waitForTimeout(200);
    t = await ticket(p, 't1');
    check('onItem: the row text never actually changed', t.assets[0].item === 'Test Tool', t.assets[0].item);

    await p.evaluate(() => window.__mkApp.renderVals().assetRows[0].remove());
    await p.waitForTimeout(200);
    t = await ticket(p, 't1');
    toast = await toastOf(p);
    check('remove: refused with a named-reason toast, row still there',
      toast.key === 'asset-edit-stale' && t.assets.length === 1, JSON.stringify({ toast, assets: t.assets }));
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
