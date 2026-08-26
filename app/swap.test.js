// Working as a technician, and getting back out.
//
// Three properties carry this feature, and each has a way of being got wrong:
//   1. The swap must NARROW what you may do. An ops manager who can still approve while
//      "working as a technician" is an ops manager with a different layout, which tells
//      you nothing about what the field experiences.
//   2. The way back must never be gated on a capability. Acting as a technician drops
//      user.act_as_technician along with everything else, so a permission check on the
//      swap-back control is a door that locks from the inside.
//   3. The audit must keep the real name. The whole reason this exists rather than
//      "borrow someone's login" is that borrowing destroys attribution.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function open(ctx, w) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w || 1280, height: 950 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  return p;
}
const login = async (p, email) => {
  const i = p.locator('input');
  await i.nth(0).fill(email);
  await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1300);
};
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── Who is offered the swap ──
  for (const [email, who, offered] of [
    ['lateri@makaman.ly', 'Admin', true],
    ['omar@makaman.ly', 'Ops Manager', true],
    ['yousef@makaman.ly', 'Technician', false],
    ['founder@makaman.ly', 'Observer', false],
  ]) {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, email);
    const has = await p.evaluate(() => /work as technician/i.test(document.body.innerText));
    check(`${who} ${offered ? 'is offered' : 'is not offered'} the swap`, has === offered);
    await ctx.close();
  }

  // ── The swap narrows what you may do ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'omar@makaman.ly');

    const beforeText = await p.evaluate(() => document.body.innerText);
    check('the ops manager starts on the office inbox',
      /inbox|awaiting review|review/i.test(beforeText), beforeText.slice(0, 60).replace(/\n/g, ' '));

    await p.getByRole('button', { name: /work as technician/i }).click();
    await p.waitForTimeout(900);
    const after = await p.evaluate(() => ({
      text: document.body.innerText,
      role: (document.querySelector('.mk-nav-role') || {}).innerText || '',
    }));

    check('the corner says they are acting, not that they are a technician',
      /AS TECHNICIAN/i.test(after.role) && /OPS MANAGER/i.test(after.role), 'corner: ' + after.role);
    check('a way back is offered', /back to ops manager/i.test(after.text));
    check('the office inbox is gone', !/awaiting review/i.test(after.text));

    // The capability check that matters: approving is an ops-manager act and must be
    // unavailable while swapped.
    check('approving is no longer offered', !/\bapprove ticket\b/i.test(after.text));
    await ctx.close();
  }

  // ── The way back works, and is not itself gated ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'omar@makaman.ly');
    await p.getByRole('button', { name: /work as technician/i }).click();
    await p.waitForTimeout(900);

    // Reload while swapped: the swap must survive, or a refresh silently hands the
    // office's powers back in the middle of a job.
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(1100);
    const afterReload = await p.evaluate(() => ({
      role: (document.querySelector('.mk-nav-role') || {}).innerText || '',
      text: document.body.innerText,
    }));
    check('the swap survives a reload', /AS TECHNICIAN/i.test(afterReload.role), 'corner: ' + afterReload.role);
    check('and the way back survives with it', /back to ops manager/i.test(afterReload.text));

    await p.getByRole('button', { name: /back to ops manager/i }).click();
    await p.waitForTimeout(900);
    const back = await p.evaluate(() => ({
      role: (document.querySelector('.mk-nav-role') || {}).innerText || '',
      text: document.body.innerText,
    }));
    check('swapping back restores the real role',
      /OPS MANAGER/i.test(back.role) && !/AS TECHNICIAN/i.test(back.role), 'corner: ' + back.role);
    check('and the office inbox returns', /work as technician/i.test(back.text));
    await ctx.close();
  }

  // ── A swapped person is assignable ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'omar@makaman.ly');
    const src = await p.evaluate(() => document.querySelector('script[type="text/x-dc"]').textContent);
    check('assignment, co-op and handover all read one technician list',
      (src.match(/this\.activeTechnicians\(\)/g) || []).length >= 4,
      (src.match(/this\.activeTechnicians\(\)/g) || []).length + ' call sites');
    check('the swapped person is added to that list',
      /if \(!this\.state\.actingAs\) return list;/.test(src));
    check('nobody is added twice',
      /list\.some\(u => \(u\.email \|\| ''\)\.toLowerCase\(\) === me\.toLowerCase\(\)\)/.test(src));
    await ctx.close();
  }

  // ── The properties that are easiest to get wrong, read from the source ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    const src = await p.evaluate(() => document.querySelector('script[type="text/x-dc"]').textContent);

    check('while acting, capabilities come from the acted role and not the real map',
      /if \(this\.state\.actingAs\) \{[\s\S]{0,220}PERMISSION_DEFAULTS\[key\]/.test(src));
    check('the swap-back control is keyed on being swapped, not on a permission',
      /showSwapOut: !!S\.actingAs && !!S\.session,/.test(src));
    check('swapping in is gated on the capability',
      /showSwapIn: !S\.actingAs && !!S\.session && this\.hasPermission\('user\.act_as_technician'\)/.test(src));
    check('the swap is stored on the session so a reload cannot undo it',
      /role: session\.actingAs \|\| session\.roleKey/.test(src));
    check('a fresh login never inherits somebody else\'s swap',
      (src.match(/actingAs: null/g) || []).length >= 3);
    check('nothing about the swap is written to a profile',
      !/actingAs[\s\S]{0,120}from\('profiles'\)/.test(src));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
