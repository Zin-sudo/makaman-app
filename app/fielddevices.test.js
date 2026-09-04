// Field devices (the office's Sync tab): what the office sees about an open job without
// opening the ticket.
//
// 2026-09-04, owner's request, reading the office view of a live trial: an open job
// showed only the customer and field/well/rig — nothing said what the technician had
// actually just done, and the one "latest position" line collapsed two different
// questions (where is the well, where is the device right now) into whichever fix
// happened to be newest. This proves both additions land under the right job: the last
// job-log line, and the two coordinates kept separately — Well location (the opening
// fix, never overwritten) and Current location (the periodic re-pin).
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
const tab = async (p, name) => {
  await p.getByRole('button', { name: new RegExp('^' + name + '$', 'i') }).last().click();
  await p.waitForTimeout(700);
  return p.innerText('body');
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // Yousef's t3 in the demo seed is already open ("logging") with two job-log lines and
  // no geo fix at all — the baseline this suite builds on rather than restating.
  const p = await signIn(browser, 'omar@makaman.ly');
  let body = await tab(p, 'Sync');
  check('the last job-log line shows under the open job',
    /Rigging up combination string, function tested surface equipment\./.test(body));
  check('with no fix yet, both coordinates say so rather than showing nothing',
    (body.match(/No Location Shared/g) || []).length >= 2,
    (body.match(/No Location Shared/g) || []).length + ' occurrence(s)');
  check('the two locations are labelled separately, not folded into one line',
    /well location/i.test(body) && /current location/i.test(body));

  // Distinct fixes for the opening pin and the periodic re-pin — proving the screen
  // reads geo.open and geo.last separately rather than "whichever is newest" (the old
  // behaviour, still correct for the single summary line above the job list).
  await p.evaluate(() => window.__mkApp.mutate(d => {
    const t = d.tickets.find(x => x.id === 't3');
    t.geo = {
      open: { lat: 27.111111, lon: 47.222222, ts: '2026-09-04T06:20:00.000Z' },
      last: { lat: 27.333333, lon: 47.444444, ts: '2026-09-04T14:20:00.000Z' },
      pingedAt: '2026-09-04T14:20:00.000Z',
    };
  }));
  await p.waitForTimeout(400);
  body = await tab(p, 'Sync');
  check('Well location reads the opening fix', /27\.111111, 47\.222222/.test(body));
  check('Current location reads the periodic re-pin, a different coordinate',
    /27\.333333, 47\.444444/.test(body));
  check('the two fixes never merge into a single reading',
    !/27\.111111, 47\.222222.*27\.111111, 47\.222222/.test(body));
  await p.close();

  // The last log line updates the moment a new one is written, same as anything else
  // read off D.tickets — proving this reads the live array rather than a stale copy
  // taken once when the technician's tab was built.
  const p2 = await signIn(browser, 'omar@makaman.ly');
  await p2.evaluate(() => window.__mkApp.mutate(d => {
    const t = d.tickets.find(x => x.id === 't3');
    t.events.push({ ts: new Date().toISOString(), text: 'Packer set at 6,020 ft, pressure holding.' });
  }));
  body = await tab(p2, 'Sync');
  check('a newly logged line becomes the one shown, not the one before it',
    /Packer set at 6,020 ft, pressure holding\./.test(body)
    && !/Rigging up combination string, function tested surface equipment\./.test(body));
  await p2.close();

  // The interval itself: 2026-09-04, owner's request — every two hours, not one.
  const p3 = await signIn(browser, 'omar@makaman.ly');
  const src = await p3.evaluate(() => document.querySelector('script[type="text/x-dc"]').textContent);
  check('the periodic re-pin fires every two hours',
    /const GEO_PING_INTERVAL_MS = \(typeof window[^|]+\|\| 7200000;/.test(src));
  await p3.close();

  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
