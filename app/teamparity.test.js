// 2026-09-11, owner's request: "For the team list from Account tab allow the ops to adopt
// the disable / reset password same as the admin."
//
// user.disable already gated all three Team-screen row controls (Disable/Restore, Set
// password, and — until this fix — Delete too) on the client, but its default_roles was
// ['admin'] only (migration 0076 widens it to ['ops_manager','admin']), and the
// admin-actions Edge Function independently hardcoded role==='admin' for set_user_status
// and set_password regardless of what the permissions table said — "hiding a button is not
// a check," proven wrong in both directions here. Delete is deliberately NOT widened: it
// is the one irreversible action of the three, and the owner asked for disable and reset
// password only — canDelete now reads a direct admin-only role check instead of
// user.disable, so it can never be silently widened again just because that capability's
// default_roles changes for some other reason.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function boot(b, email) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
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
  await p.waitForTimeout(1200);
  return { ctx, p };
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── hasPermission itself, the fact everything else here rides on ────────────
  for (const [email, role, expect] of [
    ['omar@makaman.ly', 'ops_manager', true],
    ['lateri@makaman.ly', 'admin', true],
    ['yousef@makaman.ly', 'technician', false],
  ]) {
    const { ctx, p } = await boot(b, email);
    const has = await p.evaluate(() => window.__mkApp.hasPermission('user.disable'));
    check(role + ' hasPermission(user.disable) reads ' + expect, has === expect, String(has));
    await ctx.close();
  }

  // ── The Team screen's own row controls: Ops Manager now matches Admin for
  //    Disable/Restore and Set password, but NOT Delete ──────────────────────
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    await p.getByRole('button', { name: /^Account$/i }).last().click();
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /Team/i }).first().click();
    await p.waitForTimeout(500);
    const row = p.locator('tr', { hasText: /Mahmoud Zaki/i });
    check('Ops Manager sees Disable on a technician\'s row',
      await row.getByRole('button', { name: /^(Disable|Restore)$/i }).count() === 1);
    check('and Set password too',
      await row.getByRole('button', { name: /Set password/i }).count() === 1);
    check('but not Delete — that stays Admin-only',
      await row.getByRole('button', { name: /^Delete$/i }).count() === 0);
    await ctx.close();
  }
  {
    const { ctx, p } = await boot(b, 'lateri@makaman.ly');
    await p.getByRole('button', { name: /^Account$/i }).last().click();
    await p.waitForTimeout(400);
    // Admin reaches the same shared row markup via "Users & Customers", not "Team" —
    // Team is the Ops Manager's own tile name for the identical screen.
    await p.getByRole('button', { name: /Users.*Customers/i }).first().click();
    await p.waitForTimeout(500);
    const row = p.locator('tr', { hasText: /Mahmoud Zaki/i });
    check('Admin still sees all three controls — Disable',
      await row.getByRole('button', { name: /^(Disable|Restore)$/i }).count() === 1);
    check('Set password', await row.getByRole('button', { name: /Set password/i }).count() === 1);
    check('and Delete', await row.getByRole('button', { name: /^Delete$/i }).count() === 1);
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
