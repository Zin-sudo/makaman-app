// Asking for a role on the way in.
//
// The dropdown on Create Account is a REQUEST, and the difference is the whole feature.
// The database trigger writes every new profile as a pending technician, and it has to
// stay that way: a client that could set its own role would be no protection at all. So
// what this proves is that choosing "Operations Manager" gets you an account that is
// still a pending technician, and gets the person approving it a line telling them what
// was asked for — which is the actual problem being solved, since otherwise they have to
// ring round and ask who somebody is.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function fresh(b) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1180, height: 950 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  return { ctx, p };
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── The field exists, and offers the right things ────────────────────────
  {
    const { ctx, p } = await fresh(b);
    await p.getByText(/Sign up/i).first().click();
    await p.waitForTimeout(600);
    const opts = await p.evaluate(() => {
      const sel = document.querySelector('select');
      return sel ? Array.from(sel.options).map(o => o.value + ':' + o.text) : null;
    });
    check('the signup card asks what you are joining as', !!opts, JSON.stringify(opts));
    check('it offers technician, ops manager and observer',
      JSON.stringify(opts) === JSON.stringify(['tech:Field Technician', 'mgr:Operations Manager', 'founder:Observer']),
      JSON.stringify(opts));
    check('and does not offer Admin — nobody applies for that',
      !opts.some(o => /admin/i.test(o)));
    check('Field Technician is what it starts on',
      await p.evaluate(() => document.querySelector('select').value) === 'tech');
    check('the card no longer promises a technician account in its heading',
      /Request an account/i.test(await p.evaluate(() => document.body.innerText)));
    check('and says plainly that the office confirms it',
      /office confirms this when it approves/i.test(await p.evaluate(() => document.body.innerText)));
    await ctx.close();
  }

  // ── Asking for Ops Manager does not make you one ─────────────────────────
  {
    const { ctx, p } = await fresh(b);
    await p.getByText(/Sign up/i).first().click();
    await p.waitForTimeout(600);
    const i = p.locator('input');
    await i.nth(0).fill('Nabil Ferjani');
    await i.nth(1).fill('nabil@makaman.ly');
    await i.nth(2).fill('sabratha-rig-77');
    await i.nth(3).fill('sabratha-rig-77');
    await p.locator('select').selectOption('mgr');
    await p.getByRole('button', { name: /Request account/i }).click();
    await p.waitForTimeout(1200);

    const made = await p.evaluate(() => {
      const u = (window.__mkApp.state.data.users || []).find(x => x.email === 'nabil@makaman.ly');
      return u ? { status: u.status, roleKey: u.roleKey, role: u.role, requested: u.requestedRole } : null;
    });
    check('the account is created', !!made, JSON.stringify(made));
    check('it is pending, not active', made.status === 'pending', made.status);
    check('it holds NO role — asking is not being granted',
      made.roleKey === null || made.roleKey === undefined, JSON.stringify(made.roleKey));
    check('but what was asked for is kept', made.requested === 'mgr', made.requested);
    await ctx.close();
  }

  // ── And the person approving actually sees it ────────────────────────────
  {
    const { ctx, p } = await fresh(b);
    await p.getByText(/Sign up/i).first().click();
    await p.waitForTimeout(600);
    const i = p.locator('input');
    await i.nth(0).fill('Nabil Ferjani');
    await i.nth(1).fill('nabil@makaman.ly');
    await i.nth(2).fill('sabratha-rig-77');
    await i.nth(3).fill('sabratha-rig-77');
    await p.locator('select').selectOption('mgr');
    await p.getByRole('button', { name: /Request account/i }).click();
    await p.waitForTimeout(1200);

    // Sign in as the office and look at the team.
    await p.evaluate(() => window.__mkApp.setState({ authScreen: 'login', signupDone: false, session: null }));
    await p.waitForTimeout(500);
    const li = p.locator('input');
    await li.nth(0).fill('omar@makaman.ly'); await li.nth(1).fill('makaman2026');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(1500);
    await p.evaluate(() => window.__mkApp.setState({ mgrScreen: 'team', roleTab: 'tickets' }));
    await p.waitForTimeout(900);
    const seen = await p.evaluate(() => document.body.innerText);
    check('the approver is told what the applicant asked for',
      /Asked to join as Operations Manager/i.test(seen),
      (seen.match(/Asked to join as[^\n]*/) || ['(nothing)'])[0]);
    check('and the row still shows the account as Pending', /Pending/i.test(seen));

    // Approving still makes a technician — the request did not decide anything.
    // The control reads "Approve -> Technician", which already says what it does.
    await p.getByRole('button', { name: /Approve/i }).first().click();
    await p.waitForTimeout(900);
    const after = await p.evaluate(() => {
      const u = (window.__mkApp.state.data.users || []).find(x => x.email === 'nabil@makaman.ly');
      return { status: u.status, roleKey: u.roleKey };
    });
    check('approving activates the account', after.status === 'active', after.status);
    check('as a Field Technician, whatever was asked for',
      after.roleKey === 'tech', after.roleKey);
    check('and the request line goes once it is no longer a question',
      !/Asked to join as/i.test(await p.evaluate(() => document.body.innerText)));
    await ctx.close();
  }

  // ── A plain technician signup says nothing extra ─────────────────────────
  {
    const { ctx, p } = await fresh(b);
    await p.getByText(/Sign up/i).first().click();
    await p.waitForTimeout(600);
    const i = p.locator('input');
    await i.nth(0).fill('Salem Trabelsi');
    await i.nth(1).fill('salem@makaman.ly');
    await i.nth(2).fill('zelten-well-31');
    await i.nth(3).fill('zelten-well-31');
    await p.getByRole('button', { name: /Request account/i }).click();
    await p.waitForTimeout(1200);
    await p.evaluate(() => window.__mkApp.setState({ authScreen: 'login', signupDone: false, session: null }));
    await p.waitForTimeout(500);
    const li = p.locator('input');
    await li.nth(0).fill('omar@makaman.ly'); await li.nth(1).fill('makaman2026');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(1500);
    await p.evaluate(() => window.__mkApp.setState({ mgrScreen: 'team', roleTab: 'tickets' }));
    await p.waitForTimeout(900);
    check('somebody joining as a technician adds no note to read',
      !/Asked to join as/i.test(await p.evaluate(() => document.body.innerText)));
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
