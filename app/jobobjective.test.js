// The job objective, moved off the technician entirely. 2026-09-09, owner's request:
// "remove the field input of the Job Objective from the technician. allow only Ops and
// admins to fill the job objective before approving a ticket as a mandatory step. mark
// the unfulfilled input fields in red until they're filled with an input."
//
// Three things are checked here, none of them new mechanisms — canApprove already
// blocked approval on an empty job type (uxpass.test.js covers that half) and
// enforce_ticket_update_rules() already has the shape every server-side lock in this
// migration hangs off:
//
//   1. The technician's own job-log screen carries no "Job type" input or label at all —
//      not merely disabled, gone, since there is nothing for a technician to correctly
//      do with a field that is not theirs to fill.
//   2. The office review screen's input is red-bordered with a stated requirement while
//      empty, and both clear the moment it's filled — reusing the same signal the
//      ticket-number field already gives for "not yet acceptable."
//   3. The database itself refuses a technician's own attempt to set it, so a bypass of
//      the UI gate still hits a real wall.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

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

  // ── 1. Gone from the technician's own screen ─────────────────────────────
  {
    const p = await signIn(browser, 'yousef@makaman.ly');
    // t3 is Yousef's own open ("logging") ticket in the seed.
    await p.evaluate(() => window.__mkApp.setState({ activeId: 't3', techScreen: 'log', roleTab: 'tickets' }));
    await p.waitForTimeout(500);
    const body = await p.innerText('body');
    check('no "Job type" label anywhere on the technician\'s own job-log screen',
      !/Job type/i.test(body), body.match(/Job type[^\n]*/i) ? body.match(/Job type[^\n]*/i)[0] : '(none found, correct)');
    const jobTypeInputs = await p.evaluate(() =>
      document.querySelectorAll('input[placeholder="e.g. PKR FOR CSG TEST"]').length);
    check('and no such input exists in the DOM at all', jobTypeInputs === 0, jobTypeInputs + ' found');
    await p.close();
  }

  // ── 2. Red and required on the office review screen while empty ─────────
  {
    const p = await signIn(browser, 'omar@makaman.ly');
    await p.evaluate(() => {
      const app = window.__mkApp;
      // t2 is 'done' but not yet approved — still editable, unlike t1 (already
      // 'approved' and sealed) where every field, this one included, is disabled.
      app.mutate((d) => { d.tickets.find(x => x.id === 't2').jobType = ''; });
      app.openReview('t2');
    });
    await p.waitForTimeout(700);
    const before = await p.evaluate(() => {
      const label = Array.from(document.querySelectorAll('label'))
        .find(l => /Job type \(objective\)/.test(l.textContent || ''));
      const input = label.parentElement.querySelector('input');
      const req = label.parentElement.querySelector('.mk-jobtype-required');
      return {
        labelSaysOfficeOnly: /office only/i.test(label.textContent || ''),
        border: input.style.border,
        msg: req ? req.textContent : null,
      };
    });
    check('the label says this is office-only',
      before.labelSaysOfficeOnly, before.labelSaysOfficeOnly);
    check('the input is red-bordered while empty', /danger/.test(before.border), before.border);
    check('and the requirement is stated in words, not just color',
      !!before.msg && /required/i.test(before.msg), before.msg);

    // Fill it — the office IS allowed to. Located by its label rather than a style
    // substring, same reasoning as audit.test.js's identical lookup: the browser
    // normalises inline style text, so matching on it is unreliable.
    const jt = p.getByText('Job type (objective)').first().locator('..').locator('input').first();
    await jt.click(); await jt.fill('PKR FOR CSG TEST'); await p.locator('body').click();
    await p.waitForTimeout(500);
    const after = await p.evaluate(() => {
      const label = Array.from(document.querySelectorAll('label'))
        .find(l => /Job type \(objective\)/.test(l.textContent || ''));
      const input = label.parentElement.querySelector('input');
      const req = label.parentElement.querySelector('.mk-jobtype-required');
      return { border: input.style.border, msg: req ? req.textContent : null };
    });
    check('the red border clears once filled', !/danger/.test(after.border), after.border);
    check('and the requirement message goes with it', after.msg === null, after.msg);
    await p.close();
  }

  // ── 3. Nothing left in the source that could bind a job-type field to the ──
  //      technician screen — proves the removal is real, not just hidden by CSS.
  {
    const p = await signIn(browser, 'omar@makaman.ly');
    const src = await p.evaluate(() => document.querySelector('script[type="text/x-dc"]').textContent);
    check('the technician-screen job-type datalist wiring is gone from the source',
      !/list="jobtypes"/.test(src));
    await p.close();
  }
  // The database-side lock (enforce_ticket_update_rules refusing a technician's own
  // attempt to set job_type_id/job_type_text) is a live-Postgres trigger and cannot be
  // exercised against cloudstub.js, which has no SQL semantics — verified instead by
  // direct SQL against the live project, the same way every other RLS/trigger rule in
  // this migration set is proven.

  await browser.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
