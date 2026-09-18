// Deleting an account, 2026-09-18, owner's request: "Add a password request when
// disabling or deleting a user." Deleting is irreversible (unlike Disable, which has a
// Restore), so this proves the step-up check end to end: no password refuses inline, a
// wrong password refuses inline and leaves the account exactly as it was, and only the
// right password lets the delete through.
//
// Uses a throwaway user added directly to the local demo store (same technique
// teampresence.test.js uses) rather than one of the seeded fixtures other suites read —
// nothing here should leave a real fixture account missing for another test.
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
  await i.nth(0).fill('lateri@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1300);

  const THROWAWAY = 'delete-guard-throwaway@makaman.ly';
  await p.evaluate(([email]) => window.__mkApp.mutate(d => {
    d.users.push({ name: 'Delete Guard Throwaway', email, roleKey: 'tech', role: 'Technician', base: 'Ahmadi Base', lastSync: '', status: 'active' });
  }), [THROWAWAY]);
  await p.waitForTimeout(300);

  await p.getByText('Account', { exact: true }).first().click();
  await p.waitForTimeout(400);
  await p.getByText('Users & Customers', { exact: false }).first().click();
  await p.waitForTimeout(500);

  // Scoped to the exact <tr>, not a plain div.textContent scan — every ancestor div's own
  // textContent also contains the row's name (it bubbles up the whole table), so a scan
  // like that can walk past the real row and click a DIFFERENT row's Delete button
  // instead. That happened here during development: it deleted Yousef Al-Harbi, not the
  // throwaway account, while every check still reported green because they only asked
  // "does the throwaway account still exist," never "did the RIGHT row get clicked."
  const row = p.locator('tr', { hasText: 'Delete Guard Throwaway' });
  const clickDelete = async () => {
    const btn = row.getByRole('button', { name: /^Delete$/i });
    if (!(await btn.count())) return false;
    await btn.click();
    return true;
  };
  const clickModalDelete = () => p.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(x => /^delete the account$/i.test(x.textContent.trim()));
    if (btn) { btn.click(); return true; }
    return false;
  });

  const exists = () => p.evaluate(([email]) =>
    !!(window.__mkApp.state.data.users || []).find(x => x.email === email), [THROWAWAY]);

  check('the throwaway account is there to start', await exists());
  check('a Delete control is on its row', await clickDelete());
  await p.waitForTimeout(400);

  // No password typed — refused inline, dialog stays open, account untouched.
  check('confirming with no password is refused inline', await clickModalDelete());
  await p.waitForTimeout(300);
  const noPwText = await p.evaluate(() => document.body.innerText);
  check('and says so in words', /Enter your password to confirm/i.test(noPwText));
  check('the account still exists after a blank-password attempt', await exists());

  // A wrong password — refused inline, account still untouched.
  await p.locator('input[type="password"]').last().fill('definitely-not-it');
  check('confirming with a wrong password is refused', await clickModalDelete());
  await p.waitForTimeout(400);
  const wrongPwText = await p.evaluate(() => document.body.innerText);
  check('and says the password is incorrect', /incorrect/i.test(wrongPwText));
  check('the account still exists after a wrong-password attempt', await exists());

  // The right password — the delete actually goes through.
  await p.locator('input[type="password"]').last().fill('makaman2026');
  check('confirming with the right password submits', await clickModalDelete());
  await p.waitForTimeout(500);
  check('and the account is gone', !(await exists()));

  await ctx.close();
  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
