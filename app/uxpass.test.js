// The interaction rules in docs/UX-PRINCIPLES.md, where they were actually broken.
//
// The rules arrived after the app was built (user, 2026-09-02), so this suite is not an
// audit of all twenty — most of them the app already keeps. It guards the four places
// that named a real defect, and it guards them as behaviour rather than as styling, so a
// later change that reverts the behaviour fails here rather than looking fine.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function boot(b, email, width) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.setViewportSize({ width: width || 1180, height: 950 });
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

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── The Approve button says why it cannot be pressed ─────────────────────
  //
  // Goal-Gradient (#20), Zeigarnik (#11), Postel (#14). It read "Approve ticket" whether
  // or not the four checks passed; only the opacity changed, to 0.45. A dimmed control
  // with an unchanged label is a dead button with no stated cause — the checklist above
  // it held the answer, and the thing being pressed said nothing.
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    const id = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = app.state.data.tickets.find(x => x.status === 'done')
        || app.state.data.tickets.find(x => x.status !== 'approved');
      app.mutate((d) => {
        const x = d.tickets.find(y => y.id === t.id);
        x.status = 'done';
        // Two of the four unmet: no mileage, no job type.
        x.ticketNo = '7001';
        x.items = [{ code: 'MKN-1801', desc: 'A line', qty: 1, uom: 'Km', cost: 10, ov: {} }];
        x.mileage = '';
        x.jobType = '';
      });
      app.openReview(t.id);
      return t.id;
    });
    await p.waitForTimeout(800);

    const two = await p.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(x => /Approve ticket|Needs /i.test(x.textContent || ''));
      return {
        label: btn ? (btn.textContent || '').trim() : null,
        disabled: btn ? btn.disabled : null,
        heading: (document.body.innerText.match(/Ready to approve — \d of \d/) || [])[0] || null,
      };
    });
    check('the checklist counts what is done', two.heading === 'Ready to approve — 2 of 4',
      JSON.stringify(two.heading));
    check('and the button names what is missing rather than repeating itself',
      /^Needs /.test(two.label || '') && /mileage/i.test(two.label || '')
        && /job type/i.test(two.label || ''), JSON.stringify(two.label));
    check('it is still refused while they are missing', two.disabled === true);

    // Fill one; the button drops to the one that is left.
    await p.evaluate((tid) => {
      const app = window.__mkApp;
      app.mutate((d) => { d.tickets.find(y => y.id === tid).mileage = 120; });
    }, id);
    await p.waitForTimeout(600);
    const one = await p.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(x => /Approve ticket|Needs /i.test(x.textContent || ''));
      return { label: btn ? (btn.textContent || '').trim() : null,
        heading: (document.body.innerText.match(/Ready to approve — \d of \d/) || [])[0] || null };
    });
    check('filling one moves the count', one.heading === 'Ready to approve — 3 of 4',
      JSON.stringify(one.heading));
    check('and drops it out of the button', /^Needs a job type$/.test(one.label || ''),
      JSON.stringify(one.label));

    // Fill the last; the button becomes the action.
    await p.evaluate((tid) => {
      window.__mkApp.mutate((d) => { d.tickets.find(y => y.id === tid).jobType = 'PKR FOR CSG TEST'; });
    }, id);
    await p.waitForTimeout(600);
    const done = await p.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(x => /Approve ticket|Needs /i.test(x.textContent || ''));
      return { label: btn ? (btn.textContent || '').trim() : null, disabled: btn ? btn.disabled : null,
        heading: (document.body.innerText.match(/Ready to approve — \d of \d/) || [])[0] || null };
    });
    check('with all four met the button is the action', done.label === 'Approve ticket',
      JSON.stringify(done.label));
    check('and it can be pressed', done.disabled === false);
    check('the count says so too', done.heading === 'Ready to approve — 4 of 4',
      JSON.stringify(done.heading));

    // ── The end of the flow says what happens next (Peak-End, #10) ─────────
    await p.getByRole('button', { name: /^Approve ticket$/ }).click();
    await p.waitForTimeout(800);
    const after = await p.evaluate(() => document.body.innerText);
    check('approving confirms what was accomplished', /approved and locked/i.test(after));
    check('and names the next step rather than ending on a full stop',
      /Awaiting paperwork/i.test(after) && /signed and stamped/i.test(after),
      (after.match(/Next:[^]{0,80}/) || ['(no next step)'])[0].replace(/\n/g, ' '));
    await ctx.close();
  }

  // ── Every row-delete is a real target, and says what it deletes ──────────
  //
  // Fitts (#2) and Similarity (#16). Four of them — a job-log line, a charged line, an
  // allocated tool, a price-list line — were a bare 15px × with no border and NO
  // MIN-HEIGHT, so the real target was the height of one glyph beside the input it
  // deletes. On a phone, under a glove, at a wellhead.
  const measure = (p) => p.evaluate(() => Array.from(document.querySelectorAll('.mk-rowdel'))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height),
        label: el.getAttribute('aria-label') || '' };
    })
    .filter(x => x.w > 0));

  // The job-log line delete, on the phone, in the technician's own view — the one that is
  // actually pressed with a glove on.
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly', 390);
    await p.evaluate(() => {
      const app = window.__mkApp;
      const t = app.state.data.tickets.find(x => x.status === 'logging') || app.state.data.tickets[0];
      app.setState({ activeId: t.id, techScreen: 'log', roleTab: 'tickets' });
    });
    await p.waitForTimeout(900);
    const dels = await measure(p);
    check('the job-log deletes are on the phone screen', dels.length > 0, dels.length + ' found');
    check('phone: every one is at least 40 × 40',
      dels.length > 0 && dels.every(d => d.w >= 40 && d.h >= 40),
      JSON.stringify(dels.map(d => d.w + 'x' + d.h).slice(0, 4)));
    check('phone: and each says what it removes, not just "×"',
      dels.length > 0 && dels.every(d => /^(Delete|Remove) th/i.test(d.label)),
      JSON.stringify(Array.from(new Set(dels.map(d => d.label)))));
    await ctx.close();
  }

  // The charged-line and allocated-tool deletes, on the office review screen.
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    await p.evaluate(() => {
      const app = window.__mkApp;
      const t = app.state.data.tickets.find(x => (x.items || []).length && x.status !== 'approved')
        || app.state.data.tickets.find(x => (x.items || []).length)
        || app.state.data.tickets[0];
      app.mutate((d) => {
        const x = d.tickets.find(y => y.id === t.id);
        x.status = 'done';
        if (!(x.items || []).length) {
          x.items = [{ code: 'MKN-1801', desc: 'A line', qty: 1, uom: 'Km', cost: 10, ov: {} }];
        }
      });
      app.openReview(t.id);
    });
    await p.waitForTimeout(900);
    const dels = await measure(p);
    check('the office review deletes are on screen', dels.length > 0, dels.length + ' found');
    check('desk: every one is at least 40 × 40',
      dels.length > 0 && dels.every(d => d.w >= 40 && d.h >= 40),
      JSON.stringify(dels.map(d => d.w + 'x' + d.h).slice(0, 4)));
    check('desk: and each says what it removes, not just "×"',
      dels.length > 0 && dels.every(d => /^(Delete|Remove) th/i.test(d.label)),
      JSON.stringify(Array.from(new Set(dels.map(d => d.label)))));
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
