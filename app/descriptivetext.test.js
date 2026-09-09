// Descriptive text audit. 2026-09-09, owner's report: the Arrival location toggle still
// said "Your position stays in the top bar either way, so a screenshot of any screen can
// be used to find you" — the top-bar coordinate readout was removed for technicians
// earlier this project (task "Remove top-bar GPS coordinate readout for technicians"),
// and nobody had gone back to update the one sentence that depended on it. Then, a second
// one turned up in the same sweep: the admin's Job Types panel still said "Technicians can
// also type a job type freehand; the manager corrects it during review," describing a
// technician-facing job-type field that was removed entirely when the objective became
// office-only. Owner's instruction: "Update descriptive texts through the whole app
// accordingly don't leave things outdated... Make an extra test that checks all the
// descriptive texts linked to each feature or option or any tile or button."
//
// Two techniques, since "is this sentence still true" cannot be verified in general:
//
//   1. A BANNED PHRASE sweep — every wrong claim actually found this session, so it can
//      never quietly come back — run across a representative tour of every role's screens.
//   2. PINNED EXACT TEXT for the specific descriptions this session touched or that
//      duplicate themselves across two role's screens (which is exactly how the top-bar
//      sentence went stale in the first place — a copy nobody was looking at). A change to
//      any of these strings has to be a deliberate edit to this file too, not a silent
//      side effect of some other change.
//
// This does not replace reading the app when a feature changes what it does — it only
// guarantees that the CORRECTIONS made this session, and the known-fragile duplicated
// copies, cannot silently drift back out of date the way the first one did.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function signIn(browser, email, w, h) {
  const p = await browser.newPage({ viewport: { width: w || 1300, height: h || 950 } });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.removeItem('makaman.jobtickets.session.v1'));
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
  await p.waitForTimeout(600);
  return p.innerText('body');
};

// Every wrong claim this session actually found and fixed. If any of these come back —
// on ANY screen, for ANY role — something regressed to a fact that stopped being true.
const BANNED = [
  [/your position stays in the top bar/i, 'the removed top-bar coordinate readout'],
  [/screenshot of any screen can be used to find you/i, 'the removed top-bar coordinate readout'],
  [/share my position with the office/i, 'the pre-merge duplicate location toggle wording'],
  [/share my arrival location with the ops manager/i, 'the pre-merge duplicate location toggle wording (Settings-tile copy)'],
  [/technicians can also type a job type freehand/i, 'the removed technician job-type input'],
  [/the manager corrects it during review/i, 'the removed technician job-type input'],
];

const sweep = (label, body) => {
  BANNED.forEach(([re, why]) => {
    check(`${label}: no trace of ${why}`, !re.test(body), (body.match(re) || [''])[0]);
  });
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── Technician ───────────────────────────────────────────────────────────────────────
  let p = await signIn(browser, 'yousef@makaman.ly', 430, 950);
  let body = await tab(p, 'Account');
  sweep('tech Account', body);
  check('pinned: Arrival location says exactly what it does now',
    /Share where you are when you open a job\. This never appears anywhere on your own screen — only the office sees it, on the ticket and on Field Devices\./.test(body),
    (body.match(/Share where you are[^\n]*/) || [''])[0]);
  check('pinned: the per-log-line switch says exactly what it does',
    /While Arrival location is on, also refresh your position each time you write a new log line, for as long as the job stays open\./.test(body),
    (body.match(/While Arrival location[^\n]*/) || [''])[0]);
  // The technician-facing job-type input is gone entirely — not merely disabled — so its
  // label must not appear on the log screen at all.
  await p.getByRole('button', { name: /^Tickets$/i }).last().click();
  await p.waitForTimeout(500);
  const techTicketsBody = await p.innerText('body');
  sweep('tech Tickets', techTicketsBody);
  check('pinned: no job-type input on the technician\'s own ticket screen any more',
    !/Job type \(objective\)/i.test(techTicketsBody));

  body = await tab(p, 'Sync');
  sweep('tech Sync', body);
  const techFieldDevicesDesc = (body.match(/Devices on field\n([^\n]*)/i) || [])[1] || '';
  check('pinned: the tech copy of the Field Devices description reads as expected',
    /Most recently active first\. Positions refresh only while a job is open\./.test(techFieldDevicesDesc),
    techFieldDevicesDesc);

  body = await tab(p, 'Account');
  await p.getByRole('button', { name: /^Settings/i }).first().click();
  await p.waitForTimeout(500);
  body = await p.innerText('body');
  sweep('tech Settings', body);
  await p.close();

  // ── Ops Manager ──────────────────────────────────────────────────────────────────────
  p = await signIn(browser, 'omar@makaman.ly');
  body = await tab(p, 'Sync');
  sweep('ops Sync', body);
  const officeFieldDevicesDesc = (body.match(/Field devices\n([^\n]*)/i) || [])[1] || '';
  check('pinned: the office copy of the Field Devices description reads as expected',
    /Most recently active first\. Positions refresh only while a job is open\./.test(officeFieldDevicesDesc),
    officeFieldDevicesDesc);
  // The exact regression this session's own merge could have reintroduced elsewhere: two
  // copies of the same feature's description drifting apart from each other.
  check('the technician and office copies of this description are byte-for-byte the same',
    techFieldDevicesDesc.trim() === officeFieldDevicesDesc.trim(),
    JSON.stringify({ tech: techFieldDevicesDesc, office: officeFieldDevicesDesc }));

  body = await tab(p, 'Account');
  await p.getByRole('button', { name: /^Settings/i }).first().click();
  await p.waitForTimeout(500);
  body = await p.innerText('body');
  sweep('ops Settings', body);
  check('pinned: the Storage & export note reads as expected — no OneDrive/Drive step',
    /Exported sheets download to this device — that never needs an account\. Anything attached to a ticket is kept in the company archive and opened from the ticket itself, through a link that expires\. There is no OneDrive or Google Drive step, and nothing is copied outside the company\./.test(body),
    (body.match(/Exported sheets download[^\n]*/) || [''])[0]);
  await p.getByRole('button', { name: /‹ Close/i }).click();
  await p.waitForTimeout(400);

  // Office review screen: "office only" on the job type field, and the removed-technician
  // wording must not have leaked in here either.
  await p.getByRole('button', { name: /^Tickets$/i }).last().click();
  await p.waitForTimeout(500);
  const row = p.locator('tr', { hasText: /Review|View/i }).first();
  await row.getByRole('button', { name: /^(Review|View)$/i }).first().click();
  await p.waitForTimeout(700);
  body = await p.innerText('body');
  sweep('ops ticket review', body);
  check('pinned: the job-type field is labelled office-only, matching who can actually set it',
    /Job type \(objective\) — office only/i.test(body));
  await p.close();

  // ── Admin ────────────────────────────────────────────────────────────────────────────
  p = await signIn(browser, 'lateri@makaman.ly');
  body = await tab(p, 'Account');
  sweep('admin Account', body);
  await p.getByRole('button', { name: /Numbering & Job Types/i }).click();
  await p.waitForTimeout(500);
  body = await p.innerText('body');
  sweep('admin Numbering & Job Types', body);
  check('pinned: the Job Types panel describes how office staff actually set it now',
    /Office staff type the job type freehand during review, not from a dropdown here — a name that matches one in this list links the ticket to it when it syncs\. Technicians no longer set a job type themselves\./.test(body),
    (body.match(/Office staff type the job type[^\n]*/) || [''])[0]);
  await p.close();

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
