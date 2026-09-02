// The job objective, read back out of the job log.
//
// A job type here is `{TOOL} FOR {OBJECTIVE}` — `PKR FOR CSG TEST`. The tool is known
// when the ticket is raised; what the job turned out to be FOR is written line by line
// at the wellhead, in the shorthand people actually use ("P/T to 3000 psi"). So the log
// is read and an objective proposed from it.
//
// Two things are being guarded, and the second matters more than the first:
//
//   1. That the phrases are recognised, in the order they were written, joined with `&`,
//      and that a tool already on the ticket is kept rather than overwritten.
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
const CASES = [
  ['a bare pressure test', 'PKR', ['Rigged up, pressure tested lines to 3000 psi.'],
    'PKR FOR CSG TEST'],
  ['the abbreviation, spaced', 'PKR', ['Ran tool, P / T OK at 2500.'],
    'PKR FOR CSG TEST'],
  ['the abbreviation, tight', 'PKR', ['P/T to 3000 psi — held.'],
    'PKR FOR CSG TEST'],
  ['two objectives, in the order written', 'RBP',
    ['Acid job performed by client.', 'Then pressure test to 3000 psi.'],
    'RBP FOR ACID JOB & CSG TEST'],
  ['two in one line, in the order written', 'RBP',
    ['Cement job first, injectivity test after.'],
    'RBP FOR CEMENT JOB & INJECTIVITY TEST'],
  ['added to an objective already on the ticket', 'PKR FOR CSG TEST',
    ['Acid job on the same trip.'],
    'PKR FOR CSG TEST & ACID JOB'],
  ['nothing to add when it is already said', 'PKR FOR CSG TEST',
    ['Pressure tested to 3000 psi.'], ''],
  ['nothing at all in an ordinary log', 'PKR',
    ['Rigged up on wellhead.', 'Released from location.'], ''],
  ['a duplicate mention counts once', 'PKR',
    ['P/T at 2000.', 'Second pressure test at 3000.'], 'PKR FOR CSG TEST'],
  ['objectives alone when no tool has been named', '',
    ['Cement job performed by client.'], 'CEMENT JOB'],
];

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── What the log says ────────────────────────────────────────────────────
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    const got = await p.evaluate((cases) => cases.map(([, jobType, lines]) =>
      window.__mkApp.suggestJobTypeForTest(jobType, lines.map(x => ({ text: x })))), CASES);
    CASES.forEach(([name, , , want], i) => {
      check(name, got[i] === want, JSON.stringify(got[i]) + ' wanted ' + JSON.stringify(want));
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
        chip: document.querySelectorAll('.mk-suggest-chip').length,
      };
    }, t);
    check('accepting writes it', after.jobType === 'PKR FOR CSG TEST & ACID JOB',
      JSON.stringify(after.jobType));
    check('the change is on the record with both values',
      after.trail.some(s => /PKR → PKR FOR CSG TEST & ACID JOB/.test(s)),
      JSON.stringify(after.trail));
    check('it is an edit, not a job stage',
      after.trail.every(s => s.indexOf('edit ::') === 0), JSON.stringify(after.trail));
    check('and the chip goes once there is nothing left to add', after.chip === 0,
      after.chip + ' still shown');
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
