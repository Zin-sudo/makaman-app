// 2026-09-10, pre-purge audit, Parts 5+6: "use this simulation on all users to figure out
// undiscovered issues."
//
// Part 5 — 19 of the Admin Permissions screen's 46 toggles turned out to gate nothing at
// all: registered, default-role-seeded, rendered as a Yes/No row per person, and read by no
// hasPermission(...) call anywhere in the client. Toggling one silently did nothing. The
// owner's decision was to hide them from the per-person screen rather than wire 27 scattered
// role checks over to hasPermission() for zero behavior change. Section A proves the hide:
// none of the 19 render as a row, a handful of genuinely-enforced keys still do.
//
// Part 6 — the actual sweep. Section B drives every one of the 27 keys that remain, for the
// role(s) that hold it by default: revokes it via an override, confirms hasPermission(key)
// reads false and nothing threw; restores it, confirms hasPermission(key) reads true again.
// Section C narrows to a handful of keys whose gated control this session's own audit
// mapped exactly (note.add, ticket.cancel_own, ticket.withdraw, ticket.restore) and checks
// the control itself — not just the flag — actually appears and disappears with it, the
// precise shape of bug Parts 1-4 kept finding one at a time.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

// 2026-09-10: the 19 keys PERSON_LEVEL_UNENFORCED hides — kept as a literal list here
// rather than read off the page, so this test fails loudly if the app's own list and this
// one ever drift apart instead of quietly agreeing with whatever the app currently does.
const HIDDEN_KEYS = ['ticket.create', 'ticket.close', 'ticket.sync', 'ticket.print_own',
  'ticket.charge_items', 'ticket.reorder_items', 'ticket.approve', 'ticket.approve_on_behalf',
  'ticket.force_number', 'ticket.reopen', 'ticket.view_all', 'activity.view_all', 'location.view_team',
  'report.generate', 'numbering.manage_series', 'user.approve_signup', 'user.create', 'client.manage',
  'jobtype.manage'];
// Every remaining catalogue key, grouped by one representative default-holding role, so the
// sweep needs only three logins rather than one per key.
const ENFORCED_BY_ROLE = {
  tech: ['ticket.log', 'note.add', 'attachment.add', 'ticket.cancel_own'],
  mgr: ['note.resolve', 'attachment.remove', 'ticket.close_any', 'ticket.withdraw', 'ticket.restore',
    'location.edit', 'report.all_technicians', 'export.master', 'ticket.edit_closed',
    'ticket.assign_number', 'numbering.hold', 'numbering.transfer', 'numbering.override_floor',
    'pricelist.view', 'pricelist.edit', 'pricelist.delete', 'activity.view_edits',
    'user.act_as_technician'],
  admin: ['numbering.override', 'user.change_role', 'user.disable', 'user.manage_permissions',
    'paperwork_email.manage'],
};
const EMAIL = { tech: 'yousef@makaman.ly', mgr: 'omar@makaman.ly', admin: 'lateri@makaman.ly' };

async function login(page, email, errs) {
  page.on('pageerror', e => errs.push(email + ': ' + e.message));
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const i = page.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForTimeout(1200);
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const pageErrors = [];

  // ── Section A: the 19 hidden keys never appear on the per-person screen ────────────
  {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 950 } });
    const p = await ctx.newPage();
    await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await login(p, 'lateri@makaman.ly', pageErrors);

    await p.getByText('Account', { exact: true }).first().click();
    await p.waitForTimeout(500);
    await p.getByText('Permissions', { exact: false }).first().click();
    await p.waitForTimeout(600);
    await p.getByText('Omar Al-Saleh', { exact: false }).first().click();
    await p.waitForTimeout(500);
    // Each id renders as the whole content of its own description line (p.description
    // falls back to p.id) — matched by exact line, not substring, so "ticket.close" does
    // not false-positive off "ticket.close_any" sitting right next to it on the screen.
    const lines = (await p.evaluate(() => document.body.innerText)).split('\n').map(l => l.trim());

    HIDDEN_KEYS.forEach((k) => {
      check(`Part 5: "${k}" is not offered as a per-person toggle`, lines.indexOf(k) === -1);
    });
    ['note.add', 'attachment.add', 'pricelist.edit'].forEach((k) => {
      check(`Part 5: a genuinely-enforced key ("${k}") still is`, lines.indexOf(k) !== -1);
    });
    await ctx.close();
  }

  // ── Section B: every remaining key, toggled off and back, for the role(s) that hold
  // it by default — no JS error, hasPermission() reads exactly what was just set ───────
  for (const role of Object.keys(ENFORCED_BY_ROLE)) {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 950 } });
    const p = await ctx.newPage();
    await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await login(p, EMAIL[role], pageErrors);

    for (const key of ENFORCED_BY_ROLE[role]) {
      const before = await p.evaluate((k) => window.__mkApp.hasPermission(k), key);
      check(`Part 6 (${role}): "${key}" reads true by default role grant`, before === true, before);

      await p.evaluate((k) => {
        const app = window.__mkApp;
        const me = (app.state.data.users || []).find(u => u.email === (app.state.session || {}).email);
        app.setPermissionOverride(me, k, false);
      }, key);
      await p.waitForTimeout(150);
      const off = await p.evaluate((k) => window.__mkApp.hasPermission(k), key);
      check(`Part 6 (${role}): "${key}" reads false once revoked`, off === false, off);

      await p.evaluate((k) => {
        const app = window.__mkApp;
        const me = (app.state.data.users || []).find(u => u.email === (app.state.session || {}).email);
        app.setPermissionOverride(me, k, true);
      }, key);
      await p.waitForTimeout(150);
      const restored = await p.evaluate((k) => window.__mkApp.hasPermission(k), key);
      check(`Part 6 (${role}): "${key}" reads true again once the override clears`, restored === true, restored);
    }
    await ctx.close();
  }

  // ── Section C: the control itself, not just the flag, for keys this audit mapped ───
  {
    const ctx = await b.newContext({ viewport: { width: 420, height: 950 } });
    const p = await ctx.newPage();
    await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await login(p, 'yousef@makaman.ly', pageErrors);

    // note.add: the note composer on Yousef's own open ticket (t3).
    await p.evaluate(() => window.__mkApp.setState({ activeId: 't3', techScreen: 'log', roleTab: 'tickets' }));
    await p.waitForTimeout(400);
    check('Section C: note.add on — the composer is offered',
      await p.getByPlaceholder(/Raise a note on this job/i).count() === 1);
    await p.evaluate(() => {
      const app = window.__mkApp;
      const me = (app.state.data.users || []).find(u => u.email === 'yousef@makaman.ly');
      app.setPermissionOverride(me, 'note.add', false);
    });
    await p.waitForTimeout(400);
    check('Section C: note.add off — the composer is gone, not just disabled',
      await p.getByPlaceholder(/Raise a note on this job/i).count() === 0);
    await p.evaluate(() => {
      const app = window.__mkApp;
      const me = (app.state.data.users || []).find(u => u.email === 'yousef@makaman.ly');
      app.setPermissionOverride(me, 'note.add', true);
    });
    await p.waitForTimeout(400);
    check('Section C: note.add restored — the composer is back',
      await p.getByPlaceholder(/Raise a note on this job/i).count() === 1);

    // ticket.cancel_own: the "Job cancelled — call it off" button on the same ticket.
    check('Section C: ticket.cancel_own on — Cancel is offered',
      /Job cancelled — call it off/i.test(await p.evaluate(() => document.body.innerText)));
    await p.evaluate(() => {
      const app = window.__mkApp;
      const me = (app.state.data.users || []).find(u => u.email === 'yousef@makaman.ly');
      app.setPermissionOverride(me, 'ticket.cancel_own', false);
    });
    await p.waitForTimeout(400);
    check('Section C: ticket.cancel_own off — Cancel is gone',
      !/Job cancelled — call it off/i.test(await p.evaluate(() => document.body.innerText)));
    await p.evaluate(() => {
      const app = window.__mkApp;
      const me = (app.state.data.users || []).find(u => u.email === 'yousef@makaman.ly');
      app.setPermissionOverride(me, 'ticket.cancel_own', true);
    });
    await p.waitForTimeout(400);
    check('Section C: ticket.cancel_own restored — Cancel is back',
      /Job cancelled — call it off/i.test(await p.evaluate(() => document.body.innerText)));
    await ctx.close();
  }

  {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 950 } });
    const p = await ctx.newPage();
    await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await login(p, 'omar@makaman.ly', pageErrors);

    // ticket.withdraw: the "Withdraw this ticket" button on t2 (done, not deleted).
    await p.evaluate(() => window.__mkApp.mutate(d => { const x = d.tickets.find(y => y.id === 't2'); x.status = 'done'; x.deletedAt = ''; }));
    await p.evaluate(() => window.__mkApp.setState({ activeId: 't2', mgrScreen: 'review' }));
    await p.waitForTimeout(400);
    check('Section C: ticket.withdraw on — Withdraw is offered',
      /Withdraw this ticket/i.test(await p.evaluate(() => document.body.innerText)));
    await p.evaluate(() => {
      const app = window.__mkApp;
      const me = (app.state.data.users || []).find(u => u.email === 'omar@makaman.ly');
      app.setPermissionOverride(me, 'ticket.withdraw', false);
    });
    await p.waitForTimeout(400);
    check('Section C: ticket.withdraw off — Withdraw is gone',
      !/Withdraw this ticket/i.test(await p.evaluate(() => document.body.innerText)));
    await p.evaluate(() => {
      const app = window.__mkApp;
      const me = (app.state.data.users || []).find(u => u.email === 'omar@makaman.ly');
      app.setPermissionOverride(me, 'ticket.withdraw', true);
    });
    await p.waitForTimeout(400);
    check('Section C: ticket.withdraw restored — Withdraw is back',
      /Withdraw this ticket/i.test(await p.evaluate(() => document.body.innerText)));

    // ticket.restore: the "Restore this ticket" button, once the same ticket is withdrawn.
    await p.evaluate(() => window.__mkApp.mutate(d => { const x = d.tickets.find(y => y.id === 't2'); x.deletedAt = new Date().toISOString(); x.deletedBy = 'Omar Al-Saleh'; }));
    await p.waitForTimeout(400);
    check('Section C: ticket.restore on — Restore is offered',
      /Restore this ticket/i.test(await p.evaluate(() => document.body.innerText)));
    await p.evaluate(() => {
      const app = window.__mkApp;
      const me = (app.state.data.users || []).find(u => u.email === 'omar@makaman.ly');
      app.setPermissionOverride(me, 'ticket.restore', false);
    });
    await p.waitForTimeout(400);
    check('Section C: ticket.restore off — Restore is gone',
      !/Restore this ticket/i.test(await p.evaluate(() => document.body.innerText)));
    await p.evaluate(() => {
      const app = window.__mkApp;
      const me = (app.state.data.users || []).find(u => u.email === 'omar@makaman.ly');
      app.setPermissionOverride(me, 'ticket.restore', true);
    });
    await p.waitForTimeout(400);
    check('Section C: ticket.restore restored — Restore is back',
      /Restore this ticket/i.test(await p.evaluate(() => document.body.innerText)));
    await ctx.close();
  }

  check('no toggle, in either direction, for any role, ever raised a JS error',
    pageErrors.length === 0, JSON.stringify(pageErrors));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
