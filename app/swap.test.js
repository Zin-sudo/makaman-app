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
    // "Awaiting review" alone stopped being a safe proxy for "the office Inbox is
    // showing" once the technician's own list grew a status filter with an "Awaiting
    // Review" pill (2026-09-09) — that pill is CORRECTLY present once swapped into the
    // technician shell. "Ticket Inbox" stopped being a safe proxy too, 2026-09-11:
    // the technician's own screen (previously "My Job Tickets") was renamed to the same
    // "Ticket Inbox" title so the owner can refer to either screen by one name. The
    // office Inbox's own subtitle line — "Uploaded from the field" — is unique to it and
    // appears nowhere in the technician shell.
    check('the office inbox is gone', !/Uploaded from the field/i.test(after.text));

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

  // ── The point of the whole thing: raise a real job, under your own name ──
  // Asserted by driving the form a technician actually fills, not by calling into state.
  // "They should be able to start a ticket with their own name and do the same as
  // technicians" is the requirement, and nothing above this actually tested it.
  {
    const ctx = await b.newContext();
    const p = await open(ctx, 430);
    await login(p, 'omar@makaman.ly');
    // At this phone width the short label is what's actually on screen — see the
    // swap-buttons-stay-inside-their-border block below.
    await p.getByRole('button', { name: /work as tech/i }).click();
    await p.waitForTimeout(900);

    const before = await p.evaluate(() => (window.__mkApp.state.data.tickets || []).length);
    await p.getByRole('button', { name: /new job ticket/i }).click();
    await p.waitForTimeout(1000);

    const sel = p.locator('select').first();
    const opts = await sel.evaluate(e => Array.from(e.options).map(o => o.value));
    await sel.selectOption(opts.find(o => o) || opts[0]);
    const inp = p.locator('input');
    await inp.nth(0).fill('Burgan N');
    await inp.nth(1).fill('BG-901');
    await inp.nth(2).fill('WS-9');
    await p.waitForTimeout(300);
    await p.getByRole('button', { name: /start logging/i }).click();
    await p.waitForTimeout(1200);

    const t = await p.evaluate(() => {
      const app = window.__mkApp, S = app.state, D = S.data;
      const x = (D.tickets || []).find(y => y.id === S.activeId);
      return {
        count: (D.tickets || []).length,
        tech: x && x.tech, holder: x && x.holder, status: x && x.status,
        well: x && x.well,
        crew: x ? (x.crew || []).map(c => c.name) : [],
        firstAuditBy: x ? ((x.audit || [])[0] || {}).by : null,
        screen: S.techScreen,
      };
    });

    check('the office can raise a job from the field', t.count === before + 1,
      before + ' → ' + t.count);
    check('the ticket carries their OWN name, not a technician\'s', t.tech === 'Omar Al-Saleh',
      'tech: ' + t.tech);
    check('and they hold it', t.holder === 'Omar Al-Saleh', 'holder: ' + t.holder);
    check('and they are the crew until it is handed on',
      t.crew.length === 1 && t.crew[0] === 'Omar Al-Saleh', t.crew.join(', '));
    check('the job is running and they are on the log screen',
      t.status === 'logging' && t.screen === 'log', t.status + ' / ' + t.screen);
    check('what they typed is on the ticket', t.well === 'BG-901', 'well: ' + t.well);
    // Every ticket's first entry used to have nobody against it — written inline at
    // creation rather than through logOn(), which is the only place that stamps a name.
    // Invisible until the Review log started showing them.
    check('the opening entry is attributed', t.firstAuditBy === 'Omar Al-Saleh',
      'by: ' + t.firstAuditBy);
    await ctx.close();
  }

  // ── A swapped person is assignable ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'omar@makaman.ly');
    const src = await p.evaluate(() => document.querySelector('script[type="text/x-dc"]').textContent);
    check('assignment and handover still read the one technician list',
      (src.match(/this\.activeTechnicians\(\)/g) || []).length >= 2,
      (src.match(/this\.activeTechnicians\(\)/g) || []).length + ' call sites');
    check('the swapped person is added to that list',
      /if \(!this\.state\.actingAs\) return list;/.test(src));
    check('nobody is added twice',
      /list\.some\(u => \(u\.email \|\| ''\)\.toLowerCase\(\) === me\.toLowerCase\(\)\)/.test(src));
    // Field Devices deliberately reads a DIFFERENT, wider list (2026-09-09) — anyone
    // else's swap, on another device, should show there but must never become an
    // assignable crew member here just because their machine says they're "acting as a
    // technician" right now. fieldDeviceAccounts() calls activeTechnicians() once
    // internally, so the split does not mean the two lists can silently disagree about
    // who a REAL technician is — only about who else gets added on top.
    check('Field Devices reads its own, wider list built on top of the same one',
      /fieldDeviceAccounts\(\)/.test(src) && /const real = this\.activeTechnicians\(\);/.test(src));
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

  // ── The swap buttons stay inside their own border, at any width ──
  //
  // 2026-09-10, reported live with a screenshot: "WORK AS TECHNICIAN" spilled out
  // past its own button on an iPhone-width screen. min-width:0 on every appbar child
  // (deliberate, so the row itself never forces a horizontal scroll) let the flex
  // layout shrink the button's own box, and since the label inside had nowrap and no
  // way to shrink WITH it, the text spilled past the border rather than staying
  // inside it. A real phone's exact font metrics are not reproducible here (a
  // self-hosted condensed font can render a few px narrower or wider than in this
  // sandbox), so this forces the same shape of squeeze directly — a button pinned
  // well under its label's natural width — rather than hoping one particular
  // viewport happens to reproduce it. Below 480px the label itself also shortens
  // (see the @media rule) — a second, independent line of defence, checked
  // separately at a real phone width further down.
  {
    const ctx = await b.newContext();
    const p = await open(ctx); // desktop width — the FULL label is what renders
    await login(p, 'omar@makaman.ly');
    await p.addStyleTag({ content: '.mk-appbar button { max-width: 70px !important; }' });
    const fits = (loc) => loc.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);

    const swapIn = p.getByRole('button', { name: /work as technician/i });
    check('the swap-in button exists, pinned well under its label\'s natural width',
      await swapIn.count() > 0);
    check('and its text truncates to fit rather than spilling past the border',
      await fits(swapIn));

    await swapIn.click();
    await p.waitForTimeout(900);
    const swapOut = p.getByRole('button', { name: /back to ops manager/i });
    check('the swap-out button exists, same squeeze', await swapOut.count() > 0);
    check('and it too truncates rather than spilling past the border',
      await fits(swapOut));
    await ctx.close();
  }

  // ── And at a real phone width, the label itself is short enough not to need it ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx, 390);
    await login(p, 'omar@makaman.ly');
    const fits = (loc) => loc.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);

    const swapIn = p.getByRole('button', { name: /work as tech/i });
    check('the short label is what a real phone gets', await swapIn.count() > 0);
    check('and it fits comfortably on its own, no truncation needed',
      await fits(swapIn));

    await swapIn.click();
    await p.waitForTimeout(900);
    const swapOut = p.getByRole('button', { name: /^back$/i });
    check('same for the way back', await swapOut.count() > 0 && await fits(swapOut));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
