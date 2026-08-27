// Passwords: setting one, changing one, and recovering a forgotten one.
//
// Two things drove this. The seeded Admin password went through a chat transcript, so it
// has to be treated as public and rotated — and rotating it from the Supabase dashboard
// did not work: the reset mail landed on the login screen with nothing to type a new
// password into. And Supabase's own leaked-password protection turned out to be a paid
// feature on this project's plan, so the check moved into the app.
//
// The assertions below are about those two claims and one more that matters more than
// either: the password never leaves the device. Only the first five characters of its
// SHA-1 go over the wire, and the comparison happens here — so a test that only checked
// "breached passwords are refused" would pass just as well for an implementation that
// posted the password to a stranger.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

// "password" — the most breached string there is. Its SHA-1 splits 5BAA6 / the rest,
// which is exactly what the k-anonymity protocol sends and keeps back.
const PWNED_PREFIX = '5BAA6';
const PWNED_SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

// The fake breach service. Records every call so the test can inspect what was sent,
// and answers in the service's real format: SUFFIX:COUNT, one per line.
async function stubPwned(p, mode) {
  await p.addInitScript(([prefix, suffix, how]) => {
    window.MAKAMAN_CONFIG = { authMode: 'local' };
    window.__pwnedCalls = [];
    const real = window.fetch.bind(window);
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('pwnedpasswords.com') === -1) return real(input, init);
      window.__pwnedCalls.push({ url: url, init: JSON.stringify(init || null) });
      if (how === 'down') return Promise.reject(new Error('offline'));
      const hit = url.indexOf(prefix) !== -1;
      // Padding rows, as the real service sends: a match must be found by comparing
      // suffixes, not by "the body was not empty".
      const body = (hit ? suffix + ':24230577\n' : '')
        + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:0\nBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB:0\n';
      return Promise.resolve({ ok: true, text: () => Promise.resolve(body) });
    };
  }, [PWNED_PREFIX, PWNED_SUFFIX, mode || 'up']);
}

async function fresh(ctx, mode) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1180, height: 900 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await stubPwned(p, mode);
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  return p;
}

async function signIn(p, email, pw) {
  const i = p.locator('input');
  await i.nth(0).fill(email);
  await i.nth(1).fill(pw || 'makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1200);
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── A recovery link is not a login screen ────────────────────────────────
  //
  // This is the defect the user hit: the reset mail comes back to this page carrying
  // type=recovery in the fragment, and the app never looked at it, so it rendered the
  // login form — a password reset that cannot reset a password.
  {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    await stubPwned(p, 'up');
    await p.goto(URL + '#access_token=fake&type=recovery&expires_in=3600', { waitUntil: 'networkidle' });
    await p.waitForTimeout(800);
    const seen = await p.evaluate(() => document.body.innerText);
    check('a recovery link opens a set-a-password screen', /Choose a new password/i.test(seen));
    check('and not the login form', !/Forgot your password/i.test(seen), seen.slice(0, 90).replace(/\n/g, ' | '));
    // Two password fields and no email field: the person is already identified by the
    // link, and asking for an email again would be asking them to prove it twice.
    const kinds = await p.evaluate(() => Array.from(document.querySelectorAll('input')).map(x => x.type));
    check('it asks for a password twice and an email not at all',
      kinds.filter(k => k === 'password').length === 2 && kinds.indexOf('email') === -1, kinds.join(','));
    await ctx.close();
  }

  // ── Forgot password, without telling a stranger who works here ───────────
  {
    const ctx = await b.newContext();
    const p = await fresh(ctx);
    await p.getByText(/Forgot your password/i).click();
    await p.waitForTimeout(400);
    check('the login screen offers a way back in',
      /Reset your password/i.test(await p.evaluate(() => document.body.innerText)));

    // A local build has no mail server. It must say so rather than claim to have sent
    // something, which is the failure the OneDrive "Connect" mock was removed for.
    await p.locator('input[type="email"]').fill('nobody@example.com');
    await p.getByRole('button', { name: /send me a reset link/i }).click();
    await p.waitForTimeout(600);
    const after = await p.evaluate(() => document.body.innerText);
    check('a build with no server says so instead of pretending to send mail',
      /no server/i.test(after) && !/Check your mail/i.test(after),
      after.slice(0, 120).replace(/\n/g, ' | '));
    await ctx.close();
  }

  // ── The rules, in Settings ───────────────────────────────────────────────
  {
    const ctx = await b.newContext();
    const p = await fresh(ctx);
    await signIn(p, 'omar@makaman.ly');
    await p.evaluate(() => window.__mkApp.setState({ showSettings: true }));
    await p.waitForTimeout(400);

    const fields = () => p.locator('input[type="password"]');
    const submit = () => p.getByRole('button', { name: /change password/i });

    // Too short.
    await fields().nth(0).fill('short1');
    await fields().nth(1).fill('short1');
    await submit().click();
    await p.waitForTimeout(500);
    check('a password below the minimum is refused, with the minimum named',
      /at least 8 characters/i.test(await p.evaluate(() => document.body.innerText)));

    // Mismatched confirmation.
    await fields().nth(0).fill('correct-horse-1');
    await fields().nth(1).fill('correct-horse-2');
    await submit().click();
    await p.waitForTimeout(500);
    check('a mistyped confirmation is refused',
      /do not match/i.test(await p.evaluate(() => document.body.innerText)));

    // A password that is already public.
    await fields().nth(0).fill('password');
    await fields().nth(1).fill('password');
    await submit().click();
    await p.waitForTimeout(900);
    const breached = await p.evaluate(() => document.body.innerText);
    check('a breached password is refused', /known data breach/i.test(breached));
    check('and the refusal says how many times, not just "no"',
      /24,230,577/.test(breached), (breached.match(/breach[^.]*/i) || [''])[0]);

    // ── The claim that matters: the password did not leave the device ──
    const calls = await p.evaluate(() => window.__pwnedCalls);
    check('the breach check reached the service', calls.length > 0, calls.length + ' call(s)');
    const last = calls[calls.length - 1] || { url: '', init: 'null' };
    const sentPath = last.url.split('/range/')[1] || '';
    check('only five characters of the fingerprint were sent',
      sentPath === PWNED_PREFIX, JSON.stringify(sentPath));
    // Scanned past the host: "pwnedpasswords.com" contains the word, so checking the
    // whole URL would fail for a reason that has nothing to do with what was sent.
    const sentTail = last.url.split('pwnedpasswords.com')[1] || last.url;
    check('the password itself appears nowhere in what was sent',
      sentTail.indexOf('password') === -1 && (last.init || '').indexOf('password') === -1,
      JSON.stringify(sentTail));
    check('and neither does the rest of its fingerprint',
      last.url.indexOf(PWNED_SUFFIX) === -1);
    // Every request is a plain GET of the prefix — no body, no headers carrying anything.
    check('the request carries no body at all', last.init === 'null', last.init);
    await ctx.close();
  }

  // ── A good password actually changes the password ────────────────────────
  //
  // Not "the screen said it worked" — signing in afterwards with the old one must fail
  // and with the new one must succeed. A confirmation message is not evidence.
  {
    const ctx = await b.newContext();
    const p = await fresh(ctx);
    await signIn(p, 'omar@makaman.ly');
    await p.evaluate(() => window.__mkApp.setState({ showSettings: true }));
    await p.waitForTimeout(400);
    await p.locator('input[type="password"]').nth(0).fill('kufra-well-42-x');
    await p.locator('input[type="password"]').nth(1).fill('kufra-well-42-x');
    await p.getByRole('button', { name: /change password/i }).click();
    await p.waitForTimeout(900);
    check('a password that passes every rule is accepted',
      /Password changed/i.test(await p.evaluate(() => document.body.innerText)));

    const stored = await p.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || '{}');
      const u = (d.users || []).find(x => (x.email || '').toLowerCase() === 'omar@makaman.ly');
      return u ? u.password : null;
    });
    check('and it is what the store now holds', stored === 'kufra-well-42-x', JSON.stringify(stored));

    // Prove it by using it. Log out from the panel that is already open — closing it
    // first leaves the control on a screen this test never navigated to.
    await p.getByRole('button', { name: /^log out$/i }).click();
    await p.waitForTimeout(700);
    await signIn(p, 'omar@makaman.ly', 'makaman2026');
    check('the old password no longer works',
      /not correct/i.test(await p.evaluate(() => document.body.innerText)));
    await signIn(p, 'omar@makaman.ly', 'kufra-well-42-x');
    await p.waitForTimeout(400);
    check('the new one does',
      await p.evaluate(() => !!(window.__mkApp.state.session && window.__mkApp.state.session.email)));
    await ctx.close();
  }

  // ── A breach service that is down must not lock anybody out ──────────────
  //
  // The whole point of this app is that it works at a wellhead with a bad connection.
  // "Cannot check" has to mean "allow it", or an API in another country becomes the
  // reason a technician cannot secure his own account.
  {
    const ctx = await b.newContext();
    const p = await fresh(ctx, 'down');
    await signIn(p, 'omar@makaman.ly');
    await p.evaluate(() => window.__mkApp.setState({ showSettings: true }));
    await p.waitForTimeout(400);
    await p.locator('input[type="password"]').nth(0).fill('sirte-rig-nine-88');
    await p.locator('input[type="password"]').nth(1).fill('sirte-rig-nine-88');
    await p.getByRole('button', { name: /change password/i }).click();
    await p.waitForTimeout(900);
    check('with the breach service unreachable the change still goes through',
      /Password changed/i.test(await p.evaluate(() => document.body.innerText)));
    // And the local rules still ran — being unable to check the corpus is not a reason
    // to stop counting characters.
    await p.locator('input[type="password"]').nth(0).fill('abc');
    await p.locator('input[type="password"]').nth(1).fill('abc');
    await p.getByRole('button', { name: /change password/i }).click();
    await p.waitForTimeout(600);
    check('but a too-short password is still refused',
      /at least 8 characters/i.test(await p.evaluate(() => document.body.innerText)));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
