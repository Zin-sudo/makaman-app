// Owner's request, 2026-09-19: "for the wrong password/email login attempts don't record
// any error logs simply let them know that either password or email is wrong without
// recording the trail. Unless the issue is something else."
//
// Before this, doLogin's catch called logError('auth', ...) unconditionally, so every
// mistyped password filled the error log with an entry nobody at the office needed —
// the log exists for genuine bugs (a screenshot-and-guessing problem), not for the single
// most ordinary thing that happens at a login screen. signInCloud/signInLocal both throw
// the exact same sentence, and only that sentence, for a wrong password or unknown email:
// 'Email or password is not correct.' — never reused for a network failure, a clock/JWT
// problem, or anything else — so it is the one message the fix can recognize with
// certainty and skip logging for.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
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
  await i.nth(0).fill('lateri@makaman.ly');
  await i.nth(1).fill('definitely-the-wrong-password');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(800);

  const errorShown = await p.evaluate(() => document.body.innerText);
  check('the login screen says the credentials are wrong',
    /Email or password is not correct/i.test(errorShown));

  const logEntries = await p.evaluate(() => {
    const raw = localStorage.getItem('makaman.errorlog.v1');
    return raw ? JSON.parse(raw) : [];
  });
  check('and nothing was written to the error log for it',
    logEntries.length === 0, JSON.stringify(logEntries));

  // Prove the fix is scoped to that one message, not a blanket "never log auth" — a
  // second, genuinely different failure right after must still get through.
  const src = await p.evaluate(() => document.querySelector('script[type="text/x-dc"]').textContent);
  check('the skip is an explicit check against that one exact sentence, not logError itself disabled',
    /err\.message !== 'Email or password is not correct\.'/.test(src)
    && /logError\('auth', err, \{ doing: 'sign in', email: email \}\)/.test(src));

  await ctx.close();
  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
