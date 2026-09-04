// Field devices (the office's Sync tab): what the office sees about an open job without
// opening the ticket.
//
// 2026-09-04, owner's request, reading the office view of a live trial: an open job
// showed only the customer and field/well/rig — nothing said what the technician had
// actually just done, and the one "latest position" line collapsed two different
// questions (where is the well, where is the device right now) into whichever fix
// happened to be newest. An earlier pass put the split coordinates under every open job
// AND left the old blended line above it — three readings where the owner asked for two.
// This is the corrected shape: the last job-log line under each open job, and exactly
// two coordinates, once per person — Well location (the opening fix, never overwritten)
// beside Latest/Current location (the periodic re-pin), not a third anywhere.
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
  // Two technicians show by default (Yousef and Mahmoud), each with exactly two
  // coordinate fields and neither with a fix yet — four, not the six a stray third
  // reading per card would produce.
  check('with no fix yet, exactly two header coordinates per technician — no third reading',
    (body.match(/No Location Shared/g) || []).length === 4,
    (body.match(/No Location Shared/g) || []).length + ' occurrence(s)');
  check('the two locations are labelled Well location and Latest/Current location',
    /well location/i.test(body) && /latest\/current location/i.test(body));

  // Distinct fixes for the opening pin and the periodic re-pin — proving the header
  // reads geo.open and geo.last separately rather than "whichever is newest" (the
  // original, pre-2026-09-04 behaviour).
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
  check('Latest/Current location reads the periodic re-pin, a different coordinate',
    /27\.333333, 47\.444444/.test(body));
  check('each coordinate appears exactly once — no duplicate reading under the job below',
    (body.match(/27\.111111, 47\.222222/g) || []).length === 1
    && (body.match(/27\.333333, 47\.444444/g) || []).length === 1,
    JSON.stringify({
      well: (body.match(/27\.111111, 47\.222222/g) || []).length,
      cur: (body.match(/27\.333333, 47\.444444/g) || []).length,
    }));
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
