// A cancelled ticket, after it ages out of the office's ordinary Inbox view.
//
// 2026-09-09, owner's request: "if a technician cancels a job. close it for good unless
// an admin or ops withdraw the ticket... Stays for a couple of days to allow withdrawal
// then gets archived." enforce_ticket_update_rules already restricts withdrawal
// (deleted_at) to staff — this is the client-side half: once cancelledArchived(t) is
// true, the ticket drops out of the default Inbox view, with "Show archived" as the one
// deliberate way back to it. window.__ARCHIVE_DAYS_TEST shrinks the window so the test
// does not need to wait real days.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 1300, height: 950 } });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => {
    window.MAKAMAN_CONFIG = { authMode: 'local' };
    window.__ARCHIVE_DAYS_TEST = 2 / 24; // two hours, so a mutated timestamp can cross it
  });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1200);

  // t1 (Kuwait Oil Group) cancelled 3 hours ago — past the 2-hour test window.
  await p.evaluate(() => window.__mkApp.mutate(d => {
    const t = d.tickets.find(x => x.id === 't1');
    t.status = 'cancelled';
    t.cancelledAt = new Date(Date.now() - 3 * 3600000).toISOString();
    t.cancelledBy = 'Yousef Al-Harbi';
  }));
  await p.waitForTimeout(500);

  let body = await p.innerText('body');
  check('a cancelled ticket past the archive window is gone from the ordinary Inbox view',
    !/Kuwait Oil Group/.test(body));
  check('and the "Archived (cancelled)" tile appears, naming the count',
    /Archived \(cancelled\)/i.test(body) && /\bShow these\b/i.test(body));

  await p.getByText('Archived (cancelled)').first().click();
  await p.waitForTimeout(400);
  body = await p.innerText('body');
  check('"Show these" brings it back', /Kuwait Oil Group/.test(body));
  check('and the action now reads "Hide these"', /Hide these/i.test(body));

  await p.getByText('Archived (cancelled)').first().click();
  await p.waitForTimeout(400);
  body = await p.innerText('body');
  check('toggling again hides it once more', !/Kuwait Oil Group/.test(body));

  // A cancelled ticket still WITHIN the window stays visible without any toggle.
  await p.evaluate(() => window.__mkApp.mutate(d => {
    const t = d.tickets.find(x => x.id === 't2');
    t.status = 'cancelled';
    t.cancelledAt = new Date().toISOString();
    t.cancelledBy = 'Mahmoud Zaki';
  }));
  await p.waitForTimeout(400);
  body = await p.innerText('body');
  check('a just-cancelled ticket, still inside the window, stays in the ordinary view',
    /Al-Dhafra Energy/.test(body));

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
