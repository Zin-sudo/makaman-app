// My Job Tickets: filter by status. 2026-09-09, owner's request: "on the My Job Tickets
// tab allow technicians to filter by ticket status (In-Progress, Awaiting Review,
// Approved, Cancelled)."
//
// techStatusBucket() sorts every ticket into one of four buckets, coarser than the several
// statusChip() actually renders (sent_finance reads as "Approved" here too — a technician
// filtering his own list has no reason to distinguish paperwork already past approval).
// 'All' is the fifth option and clears the filter rather than being its own bucket, so it
// never needs to agree with what SETTLED_STATES holds.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 420, height: 900 } }); // phone width, on purpose
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill('yousef@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1200);
  await p.evaluate(() => window.__mkApp.setState({ roleTab: 'tickets', techScreen: 'list' }));
  await p.waitForTimeout(400);

  const pick = async (label) => {
    await p.getByRole('button', { name: label, exact: true }).click();
    await p.waitForTimeout(300);
  };
  const shows = async (customer) => (await p.innerText('body')).indexOf(customer) !== -1;

  // Yousef's own seeded tickets: t1 (Kuwait Oil Group, approved) and t3 (Northern Gulf
  // Petroleum, logging/in-progress). No horizontal page scroll at a real phone width —
  // the pill row scrolls inside itself only.
  check('at a phone width, the page itself does not scroll horizontally',
    await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
    await p.evaluate(() => document.documentElement.scrollWidth + ' vs ' + document.documentElement.clientWidth));

  check('"All" (the default) shows both of Yousef\'s tickets',
    (await shows('Kuwait Oil Group')) && (await shows('Northern Gulf Petroleum')));

  await pick('In Progress');
  check('"In Progress" shows the still-open job', await shows('Northern Gulf Petroleum'));
  check('and hides the already-approved one', !(await shows('Kuwait Oil Group')));

  await pick('Approved');
  check('"Approved" shows the approved job', await shows('Kuwait Oil Group'));
  check('and hides the still-open one', !(await shows('Northern Gulf Petroleum')));

  await pick('All');
  check('"All" clears the filter — both are back', (await shows('Kuwait Oil Group')) && (await shows('Northern Gulf Petroleum')));

  // t3 moved to 'done' (job finished, not yet approved) — the "Awaiting Review" bucket.
  await p.evaluate(() => window.__mkApp.mutate(d => { d.tickets.find(t => t.id === 't3').status = 'done'; }));
  await p.waitForTimeout(300);
  await pick('Awaiting Review');
  check('"Awaiting Review" catches a finished-but-unapproved job', await shows('Northern Gulf Petroleum'));
  await pick('In Progress');
  check('and it no longer shows under "In Progress" once done', !(await shows('Northern Gulf Petroleum')));

  // t3 called off — the "Cancelled" bucket, and gone from every other one.
  await p.evaluate(() => window.__mkApp.mutate(d => { d.tickets.find(t => t.id === 't3').status = 'cancelled'; }));
  await p.waitForTimeout(300);
  await pick('Cancelled');
  check('"Cancelled" catches a called-off job', await shows('Northern Gulf Petroleum'));
  await pick('Approved');
  check('a cancelled job does not also read as approved', !(await shows('Northern Gulf Petroleum')));
  await pick('Awaiting Review');
  check('nor as awaiting review', !(await shows('Northern Gulf Petroleum')));

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
