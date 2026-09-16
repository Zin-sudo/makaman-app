// Withdrawn tickets get their own page, not a pile under the working inbox.
//
// 2026-09-16, owner's report: "dont pile the withdrawn tickets under each other instead
// make a dropdown or another method that allows the access to the withdrawn tickets on a
// separate page." Before this, every withdrawn ticket rendered as a full detail row
// directly under the Ticket Inbox table — indistinguishable, at a glance, from the
// unbounded awaiting-paperwork list UX-PRINCIPLES.md #1/#5 already fixed once. The Inbox
// now shows one summary row regardless of how many tickets are withdrawn, and the detail
// — who, why, the internal id, and Open — lives on its own page reached from that row.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(browser, email) {
  const p = await browser.newPage({ viewport: { width: 1300, height: 950 } });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1000);
  return p;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await signIn(browser, 'omar@makaman.ly');

  // Withdraw two tickets directly (bypassing the confirm wall — that flow is covered
  // elsewhere, lifecycle.test.js) so the inbox has more than one to potentially pile up.
  await p.evaluate(() => window.__mkApp.mutate(d => {
    for (const [id, by, why] of [['t1', 'Omar Al-Saleh', 'Duplicate of another job.'], ['t2', 'Omar Al-Saleh', 'Raised against the wrong customer.']]) {
      const t = d.tickets.find(x => x.id === id);
      if (t) { t.deletedAt = new Date().toISOString(); t.deletedBy = by; t.deleteReason = why; }
    }
  }));
  await p.waitForTimeout(500);

  const inboxText = await p.evaluate(() => document.body.innerText);
  check('the inbox names the count once ("2 withdrawn tickets")', /2 withdrawn tickets/i.test(inboxText));
  check('neither withdrawn ticket\'s own reason is spelled out on the inbox screen itself',
    !/Duplicate of another job\./.test(inboxText) && !/Raised against the wrong customer\./.test(inboxText));

  // Exactly one row for the whole feature on the inbox — not one row per withdrawn ticket.
  const rowCount = await p.evaluate(() => Array.from(document.querySelectorAll('button')).filter(b => /withdrawn ticket/i.test(b.textContent)).length);
  check('exactly one summary row on the inbox, regardless of how many are withdrawn', rowCount === 1, rowCount);

  // A short timeout rather than the default 30s: on the old, stacked-list layout there is
  // no such button at all, which should read here as failed checks, not a script-ending
  // timeout crash.
  try {
    await p.getByRole('button', { name: /withdrawn ticket/i }).first().click({ timeout: 4000 });
    await p.waitForTimeout(500);
    const pageText = await p.evaluate(() => document.body.innerText);
    check('the separate page is reached, with a way back to the inbox', /‹ Inbox/.test(pageText) && /Withdrawn Tickets/.test(pageText));
    check('both withdrawn tickets\' reasons are on this page', /Duplicate of another job\./.test(pageText) && /Raised against the wrong customer\./.test(pageText));
    check('both withdrawn tickets\' internal ids are on this page',
      await p.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
        const t1 = d.tickets.find(x => x.id === 't1'), t2 = d.tickets.find(x => x.id === 't2');
        const body = document.body.innerText;
        return !!t1 && !!t2 && body.indexOf(t1.id) !== -1 && body.indexOf(t2.id) !== -1;
      }));

    await p.getByRole('button', { name: /‹ Inbox/ }).click({ timeout: 4000 });
    await p.waitForTimeout(500);
    check('back on the inbox, still just the one summary row',
      await p.evaluate(() => Array.from(document.querySelectorAll('button')).filter(b => /withdrawn ticket/i.test(b.textContent)).length) === 1);
  } catch (e) {
    check('the separate page is reached, with a way back to the inbox', false, '(no such control — this feature does not exist yet)');
    check('both withdrawn tickets\' reasons are on this page', false);
    check('both withdrawn tickets\' internal ids are on this page', false);
    check('back on the inbox, still just the one summary row', false);
  }

  await p.close();
  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
