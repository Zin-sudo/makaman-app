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

  // ── There is no role to ask for, and that is deliberate ──────────────────
  //
  // A "joining as" selector was built and then removed (user, 2026-08-28): everyone signs
  // up as a Field Technician and the office promotes afterwards. The suite guards the
  // removal rather than dropping the case, because the selector's whole point was that it
  // could not grant anything — and a control that looks like it decides something it does
  // not is worse than no control.
  {
    const { ctx, p } = await fresh(b);
    await p.getByText(/Sign up/i).first().click();
    await p.waitForTimeout(600);
    check('the signup card offers no role to choose',
      await p.evaluate(() => document.querySelectorAll('select').length) === 0);
    check('it says plainly what the account will be',
      /Sign up as Field Technician/i.test(await p.evaluate(() => document.body.innerText)));
    check('and that the office changes it afterwards if needed',
      /office will change it after approving you/i.test(await p.evaluate(() => document.body.innerText)));
    check('it asks for a name, an email and a password twice',
      JSON.stringify(await p.evaluate(() =>
        Array.from(document.querySelectorAll('input')).map(x => x.type)))
        === JSON.stringify(['text', 'email', 'password', 'password']));
    await ctx.close();
  }

  // ── Signing up creates a pending technician, and nothing more ────────────
  {
    const { ctx, p } = await fresh(b);
    await p.getByText(/Sign up/i).first().click();
    await p.waitForTimeout(600);
    const i = p.locator('input');
    await i.nth(0).fill('Nabil Ferjani');
    await i.nth(1).fill('nabil@makaman.ly');
    await i.nth(2).fill('sabratha-rig-77');
    await i.nth(3).fill('sabratha-rig-77');
    await p.getByRole('button', { name: /Request account/i }).click();
    await p.waitForTimeout(1200);

    const made = await p.evaluate(() => {
      const u = (window.__mkApp.state.data.users || []).find(x => x.email === 'nabil@makaman.ly');
      return u ? { status: u.status, roleKey: u.roleKey, role: u.role, requested: u.requestedRole } : null;
    });
    check('the account is created', !!made, JSON.stringify(made));
    check('it is pending, not active', made.status === 'pending', made.status);
    check('it holds NO role until somebody grants one',
      made.roleKey === null || made.roleKey === undefined, JSON.stringify(made.roleKey));
    check('and it records the only thing anyone can sign up as',
      made.requested === 'tech', String(made.requested));
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
    check('the row shows the account as Pending', /Pending/i.test(seen));
    check('and claims no role on their behalf',
      !/Asked to join as/i.test(seen),
      (seen.match(/Asked to join as[^\n]*/) || ['(nothing, as intended)'])[0]);

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
    check('and stays a technician until the office says otherwise',
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

  // ── The sign-up link is public, so the form says who it is for ───────────
  //
  // Migration 0046 is the control: handle_new_user refuses anything outside @makaman.ly
  // and caps self-registration at five a rolling day, and neither of those can be
  // reached from a browser. What is asserted here is the OTHER half — that a person who
  // types the wrong address is told so, in words, before a password leaves the device.
  //
  // Deliberately not asserted here: that the refusal happens. That is a database rule
  // and this suite runs against the local store, where there is no trigger to fire. The
  // proof of the rule is the impersonation probe recorded in the migration file; the
  // proof of the courtesy is below. A test that mocked the trigger would prove neither.
  {
    const { ctx, p } = await fresh(b);
    await p.getByText(/Sign up/i).first().click();
    await p.waitForTimeout(600);

    const shown = await p.evaluate(() => document.body.innerText);
    check('the form states the requirement before anything is typed',
      /company @makaman\.ly address/i.test(shown));
    check('and says what to do without one',
      /ask the office to create your account/i.test(shown));
    check('the email field shows the shape expected',
      await p.evaluate(() =>
        (document.querySelector('input[type=email]') || {}).placeholder || '') === 'you@makaman.ly');

    // An outside address, refused by the form itself.
    const i = p.locator('input');
    await i.nth(0).fill('A Stranger');
    await i.nth(1).fill('someone@gmail.com');
    await i.nth(2).fill('zelten-well-31');
    await i.nth(3).fill('zelten-well-31');
    await p.getByRole('button', { name: /Request account/i }).click();
    await p.waitForTimeout(900);
    const after = await p.evaluate(() => ({
      text: document.body.innerText,
      // Still on the form, with what was typed intact — an error that clears the fields
      // makes the person retype four things to change one.
      name: (document.querySelectorAll('input')[0] || {}).value,
      email: (document.querySelectorAll('input')[1] || {}).value,
      made: (JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || '{}').users || [])
        .some(u => /gmail\.com/i.test(u.email || '')),
    }));
    check('an outside address is refused in plain language',
      /Only @makaman\.ly addresses can sign up/i.test(after.text), after.text.slice(0, 90));
    check('no account is created for it', after.made === false);
    check('and the form keeps what was typed',
      after.name === 'A Stranger' && after.email === 'someone@gmail.com',
      after.name + ' / ' + after.email);

    // The same form, a company address: through to the pending screen.
    await i.nth(1).fill('newstarter@makaman.ly');
    await p.getByRole('button', { name: /Request account/i }).click();
    await p.waitForTimeout(1400);
    check('a company address goes through',
      /approve your account/i.test(await p.evaluate(() => document.body.innerText)));
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
