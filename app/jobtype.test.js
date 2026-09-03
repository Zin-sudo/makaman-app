// The job type is free text everywhere it is written — the review field, and the
// suggestion chips the job log composes ("PKR FOR CSG TEST & ACID JOB", a phrasing
// nobody pre-registered anywhere) — but it only lived server-side as job_type_id, a
// foreign key into the office's job_types catalog. A phrasing the catalog did not
// already hold looked up as null on the way out and came back '' on the way in: the
// job type vanished the moment the ticket made a real round trip, which an approved
// or closed ticket is the one guaranteed to make. job_type_text (0054/0055) is the fix
// — what was actually typed, stored and read back verbatim, catalog membership or not.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const { OPS, TICKET, JOB, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const DB = makeDB();
assertStubParses(DB);
const UNREGISTERED = 'PKR FOR CSG TEST & ACID JOB';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 940 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: STUB(DB) }));
  await p.addInitScript(() => {
    window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
    window.__DRAIN_TEST_MS = 120;
  });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('whatever');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1600);

  // A phrasing the office's job_types catalog has never seen — the ordinary case, since
  // the suggestion feature composes several detected objectives into one string per job.
  await p.evaluate(([id, jobType]) => {
    window.__mkApp.mutate((d) => {
      const t = d.tickets.find((x) => x.id === id);
      t.jobType = jobType;
    });
  }, [TICKET, UNREGISTERED]);
  await p.waitForTimeout(600);

  const sent = await p.evaluate(([id]) => window.__db.tickets.find((r) => r.id === id), [TICKET]);
  check('the typed words reach the server verbatim, in job_type_text',
    sent.job_type_text === UNREGISTERED, JSON.stringify(sent.job_type_text));
  check('job_type_id is allowed to stay null — the catalog link is best-effort, not a requirement',
    sent.job_type_id === null, JSON.stringify(sent.job_type_id));

  // The read-back path: a fresh hydrate must show the same words, not the blank that
  // jobById[null] used to produce. Re-hydrating on the same page rather than reloading —
  // the fake server's browser-side state (window.__db, what the write just landed in) has
  // no counterpart on the Node side, so a reload would re-fetch the stub script and get a
  // pristine seed back, proving nothing about the read path this is actually testing.
  await p.evaluate(() => window.__mkApp.refresh());
  await p.waitForTimeout(600);
  const back = await p.evaluate(([id]) => {
    const t = (window.__mkApp.state.data.tickets || []).find((x) => x.id === id);
    return t ? t.jobType : null;
  }, [TICKET]);
  check('and hydrate reads the same words back — the job type does not disappear',
    back === UNREGISTERED, JSON.stringify(back));

  // A phrasing the catalog DOES already hold still resolves job_type_id as before —
  // job_type_text is an addition, not a replacement for the existing lookup.
  const knownName = (DB.job_types.find((j) => j.id === JOB) || {}).name;
  await p.evaluate(([id, jobType]) => {
    window.__mkApp.mutate((d) => {
      const t = d.tickets.find((x) => x.id === id);
      t.jobType = jobType;
    });
  }, [TICKET, knownName]);
  await p.waitForTimeout(600);
  const sentKnown = await p.evaluate(([id]) => window.__db.tickets.find((r) => r.id === id), [TICKET]);
  check('a catalog-registered job type still resolves job_type_id as before',
    sentKnown.job_type_id === JOB, JSON.stringify(sentKnown.job_type_id));
  check('and job_type_text carries the same words alongside it',
    sentKnown.job_type_text === knownName, JSON.stringify(sentKnown.job_type_text));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await ctx.close();
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
