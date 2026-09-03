// The job objective, read back out of the job log.
//
// A job type here is `{TOOL} FOR {OBJECTIVE}` — `PKR FOR CSG TEST`. The tool is usually
// known when the ticket is raised; what the job turned out to be FOR is written line by
// line at the wellhead, in the shorthand people actually use ("P/T to 3000 psi"). So the
// log is read and an objective proposed from it — and when the ticket was never given a
// tool either, the same log is read for that too ("Ran RBP…" is a tool telling on itself).
//
// Two things are being guarded, and the second matters more than the first:
//
//   1. That the phrases are recognised, in the order they were written, joined with `&`,
//      and that a tool already on the ticket is kept rather than overwritten by a second
//      tool the log happens to mention in passing.
//   2. That NOTHING is written until somebody taps. Every phrase in the table is a guess
//      about an abbreviation, and a guess that writes itself into a ticket is a guess
//      nobody gets to check. The whole feature is only safe because it is a proposal.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function boot(b, email) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1180, height: 950 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1500);
  return { ctx, p };
}

// The pure function, exercised directly. The cases are the ones a technician actually
// types, not the ones the regex was written for — which is the only way to find out that
// "P/T" with spaces round the slash was being missed.
// Each case is the FULL set of readings the log allows, in order.
//
// "Pressure test" is two different jobs in this company — PKR FOR CSG TEST and PKR FOR
// PRESSURE TEST both exist — so it offers both and the office picks. Everything else
// resolves to one. Pinning the ambiguous case to CSG TEST, which is how this started,
// made PKR FOR PRESSURE TEST unreachable from the log and made a guess on the office's
// behalf that they would never see.
const CASES = [
  ['a bare pressure test offers both readings', 'PKR',
    ['Rigged up, pressure tested lines to 3000 psi.'],
    ['PKR FOR CSG TEST', 'PKR FOR PRESSURE TEST']],
  ['the abbreviation, spaced', 'PKR', ['Ran tool, P / T OK at 2500.'],
    ['PKR FOR CSG TEST', 'PKR FOR PRESSURE TEST']],
  ['the abbreviation, tight', 'PKR', ['P/T to 3000 psi — held.'],
    ['PKR FOR CSG TEST', 'PKR FOR PRESSURE TEST']],
  ['casing test is not ambiguous, so it offers one', 'PKR',
    ['Casing tested to 3000 psi.'], ['PKR FOR CSG TEST']],
  ['CST test, its own job type', 'RBP', ['CST test completed.'], ['RBP FOR CST TEST']],
  ['between perfs wins over the general pressure test', 'COMBINATION',
    ['Pressure test between perfs, held.'],
    ['COMBINATION FOR PRESSURE TEST BETWEEN PERFS']],
  ['two objectives, in the order written', 'RBP',
    ['Acid job performed by client.', 'Then pressure test to 3000 psi.'],
    ['RBP FOR ACID JOB & CSG TEST', 'RBP FOR ACID JOB & PRESSURE TEST']],
  ['two in one line, in the order written', 'RBP',
    ['Cement job first, injectivity test after.'],
    ['RBP FOR CEMENT JOB & INJECTIVITY TEST']],
  ['added to an objective already on the ticket', 'PKR FOR CSG TEST',
    ['Acid job on the same trip.'],
    ['PKR FOR CSG TEST & ACID JOB']],
  ['already said, so only the other reading is left to offer', 'PKR FOR CSG TEST',
    ['Pressure tested to 3000 psi.'], ['PKR FOR CSG TEST & PRESSURE TEST']],
  ['nothing at all in an ordinary log', 'PKR',
    ['Rigged up on wellhead.', 'Released from location.'], []],
  ['a duplicate mention counts once', 'PKR',
    ['P/T at 2000.', 'Second pressure test at 3000.'],
    ['PKR FOR CSG TEST', 'PKR FOR PRESSURE TEST']],
  ['objectives alone when no tool has been named', '',
    ['Cement job performed by client.'], ['CEMENT JOB']],

  // The tool itself, read the same way from the log when the ticket never named one —
  // TOOL_PHRASES, added alongside OBJECTIVE_PHRASES. Recognized phrasing only, normalized
  // to this company's own abbreviations, and never offered without an objective to pair
  // it with — a tool alone is not a job type.
  ['a bare tool mention is not enough on its own', '',
    ['Ran RBP 7" to 8,420 ft, set plug.'], []],
  ['packer in the log becomes PKR', '',
    ['Ran tool, packer set at 8,420 ft.', 'Casing tested to 3000 psi.'],
    ['PKR FOR CSG TEST']],
  ['the abbreviation read straight from the seeded log wording', '',
    ['Ran RBP 7" to 8,420 ft, set plug, pulled out of hole.',
      'Cement job performed by client, standing by.'],
    ['RBP FOR CEMENT JOB']],
  ['cement retainer in the log becomes CR', '',
    ['Ran cement retainer to 8,000 ft, set.', 'Cement job performed by client.'],
    ['CR FOR CEMENT JOB']],
  ['combo in the log becomes COMBINATION', '',
    ['Rigged up combo tool.', 'Casing tested to 3000 psi.'],
    ['COMBINATION FOR CSG TEST']],
  ['a tool already on the ticket is kept, not overruled by a second tool in the log',
    'PKR FOR CSG TEST',
    ['Ran RBP for backup.', 'Acid job on the same trip.'],
    ['PKR FOR CSG TEST & ACID JOB']],
];

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── What the log says ────────────────────────────────────────────────────
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    const got = await p.evaluate((cases) => cases.map(([, jobType, lines]) =>
      window.__mkApp.suggestJobTypeForTest(jobType, lines.map(x => ({ text: x })))), CASES);
    CASES.forEach(([name, , , want], i) => {
      check(name, JSON.stringify(got[i]) === JSON.stringify(want),
        JSON.stringify(got[i]) + ' wanted ' + JSON.stringify(want));
    });
    await ctx.close();
  }

  // ── It is offered, and only offered ──────────────────────────────────────
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    const t = await p.evaluate(() => {
      const app = window.__mkApp;
      const open = app.state.data.tickets.find(x => x.status === 'logging')
        || app.state.data.tickets[0];
      app.mutate((d) => {
        const x = d.tickets.find(y => y.id === open.id);
        x.jobType = 'PKR';
        x.events = [
          { ts: new Date().toISOString(), text: 'Rigged up. P/T to 3000 psi, held.' },
          { ts: new Date().toISOString(), text: 'Acid job performed by client.' },
        ];
      });
      app.openReview(open.id);
      return open.id;
    });
    await p.waitForTimeout(700);

    const before = await p.evaluate((id) => ({
      chip: (Array.from(document.querySelectorAll('.mk-suggest-chip'))
        .map(x => (x.textContent || '').trim())[0]) || null,
      jobType: (window.__mkApp.state.data.tickets.find(x => x.id === id) || {}).jobType,
    }), t);
    check('the suggestion is shown', /PKR FOR CSG TEST & ACID JOB/.test(before.chip || ''),
      JSON.stringify(before.chip));
    check('and the ticket still says what it said', before.jobType === 'PKR',
      JSON.stringify(before.jobType));

    // The tap.
    await p.locator('.mk-suggest-chip').first().click();
    await p.waitForTimeout(600);
    const after = await p.evaluate((id) => {
      const x = window.__mkApp.state.data.tickets.find(y => y.id === id) || {};
      return {
        jobType: x.jobType,
        trail: (x.audit || []).map(a => a.kind + ' :: ' + a.text).filter(s => /Job type/i.test(s)),
        chips: Array.from(document.querySelectorAll('.mk-suggest-chip'))
          .map(x => (x.textContent || '').trim()),
      };
    }, t);
    check('accepting writes the reading that was tapped',
      after.jobType === 'PKR FOR CSG TEST & ACID JOB', JSON.stringify(after.jobType));
    check('the change is on the record with both values',
      after.trail.some(s => /PKR → PKR FOR CSG TEST & ACID JOB/.test(s)),
      JSON.stringify(after.trail));
    check('it is an edit, not a job stage',
      after.trail.every(s => s.indexOf('edit ::') === 0), JSON.stringify(after.trail));
    // The accepted reading is gone; the OTHER one is still on offer, because the log still
    // says P/T and that still also means PRESSURE TEST. Anything else would be the feature
    // quietly deciding the ambiguity after all, one tap later.
    check('the accepted reading is no longer offered',
      !after.chips.some(c => /^↑ PKR FOR CSG TEST & ACID JOB$/.test(c)),
      JSON.stringify(after.chips));
    check('and the other reading still is',
      after.chips.some(c => /PRESSURE TEST/.test(c)), JSON.stringify(after.chips));

    // Take that one too, and there is nothing left to propose.
    await p.locator('.mk-suggest-chip').first().click();
    await p.waitForTimeout(600);
    const spent = await p.evaluate((id) => ({
      jobType: (window.__mkApp.state.data.tickets.find(x => x.id === id) || {}).jobType,
      chips: document.querySelectorAll('.mk-suggest-chip').length,
    }), t);
    check('accepting both leaves the job type carrying each objective once',
      spent.jobType === 'PKR FOR CSG TEST & ACID JOB & PRESSURE TEST',
      JSON.stringify(spent.jobType));
    check('and the chips go once there is nothing left to add', spent.chips === 0,
      spent.chips + ' still shown');
    await ctx.close();
  }

  // ── A sealed ticket is not offered a change it cannot make ───────────────
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    await p.evaluate(() => {
      const app = window.__mkApp;
      const sealed = app.state.data.tickets.find(x => x.status === 'approved');
      app.mutate((d) => {
        const x = d.tickets.find(y => y.id === sealed.id);
        x.jobType = 'PKR';
        x.events = [{ ts: new Date().toISOString(), text: 'P/T to 3000 psi.' }];
      });
      app.openReview(sealed.id);
    });
    await p.waitForTimeout(700);
    check('no suggestion on an approved ticket',
      await p.evaluate(() => document.querySelectorAll('.mk-suggest-chip').length) === 0);
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
