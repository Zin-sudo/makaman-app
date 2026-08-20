// The office acting for a technician who cannot act for himself — a dead phone, a rig
// with no signal, a rotation out. Two powers, and the same condition on both: they are
// allowed, they are announced at the moment they are used, and the technician finds out
// from his own Activity who did it.
//
// The interesting assertions here are the ones about what is still refused. A power that
// can be used quietly is the problem; a power that cannot be used at all is a different
// problem. The three hard numbering blocks stay hard because they are what stops two
// people putting the same number on two client sheets, which is the one mistake in this
// system that cannot be corrected afterwards.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const open = async (email) => {
    const p = await ctx.newPage();
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
    await p.waitForTimeout(1500);
    return p;
  };
  // The seeded running job, opened on the office's review screen.
  const openRunning = async (p) => p.evaluate(() => {
    const app = window.__mkApp;
    const t = (app.state.data.tickets || []).find(x => x.status === 'logging');
    app.setState({ activeId: t.id, mgrScreen: 'review' });
    return t.id;
  });

  // ── the office can force a number onto a running job ─────────────────────
  let p = await open('omar@makaman.ly');
  const id = await openRunning(p);
  await p.waitForTimeout(800);
  let body = await p.innerText('body');
  check('a running job no longer refuses a number outright',
    !/A number is assigned once it is closed/i.test(body));
  check('but it says plainly that this is forced',
    /Forced — job still running/i.test(body),
    (body.split('\n').find(l => /forced/i.test(l)) || '').trim().slice(0, 80));
  check('and names who will be told',
    /will be told, and it is recorded on the ticket/i.test(body));

  const noInput = p.locator('input[placeholder="1884 / F703 / D5024"]');
  check('the ticket-number field is usable, not disabled',
    await noInput.count() === 1 && !(await noInput.isDisabled()));
  const seriesEnabled = await p.evaluate(() => Array.from(document.querySelectorAll('button'))
    .filter(b => /Special Tools|Fishing|Drilling/.test(b.textContent))
    .map(b => !b.disabled));
  check('and so are the three series buttons',
    seriesEnabled.length === 3 && seriesEnabled.every(Boolean), JSON.stringify(seriesEnabled));

  // Take one from a series, which is the normal way it is done.
  await p.evaluate(() => Array.from(document.querySelectorAll('button'))
    .find(b => /Special Tools/.test(b.textContent)).click());
  await p.waitForTimeout(700);
  const after = await p.evaluate(([tid]) => {
    const t = window.__mkApp.state.data.tickets.find(x => x.id === tid);
    return { no: t.ticketNo, status: t.status,
      forced: (t.audit || []).filter(a => /still running/i.test(a.text || '')) };
  }, [id]);
  check('the number lands on the still-running ticket', !!after.no, after.no + ' / ' + after.status);
  check('the job is not closed as a side effect', after.status === 'logging', after.status);
  check('and the forcing is written to the trail as lifecycle',
    after.forced.length === 1 && after.forced[0].kind === 'lifecycle',
    JSON.stringify(after.forced.map(a => a.kind)));
  check('naming the manager who did it',
    after.forced.length === 1 && /Omar Al-Saleh/.test(after.forced[0].text),
    after.forced[0] && after.forced[0].text);

  // Pressing again must not write the entry twice.
  await p.evaluate(() => Array.from(document.querySelectorAll('button'))
    .find(b => /Fishing/.test(b.textContent)).click());
  await p.waitForTimeout(700);
  const twice = await p.evaluate(([tid]) => window.__mkApp.state.data.tickets
    .find(x => x.id === tid).audit.filter(a => /still running/i.test(a.text || '')).length, [id]);
  check('taking a second number does not repeat the entry', twice === 1, twice + ' entries');

  // ── what is still refused ────────────────────────────────────────────────
  const offline = await p.evaluate(() => {
    window.__mkApp.setState({ online: false });
    return null;
  });
  await p.waitForTimeout(600);
  body = await p.innerText('body');
  check('offline is still a hard refusal, forced or not',
    /Connect to the internet first/i.test(body));
  const disabledOffline = await p.evaluate(() => {
    const el = document.querySelector('input[placeholder="1884 / F703 / D5024"]');
    return el ? el.disabled : null;
  });
  check('and the field is disabled while offline', disabledOffline === true, String(disabledOffline));
  await p.evaluate(() => window.__mkApp.setState({ online: true }));
  await p.waitForTimeout(400);
  await p.close();

  // ── approving on the technician's behalf ─────────────────────────────────
  p = await open('omar@makaman.ly');
  const id2 = await p.evaluate(() => {
    const app = window.__mkApp;
    const t = (app.state.data.tickets || []).find(x => x.status === 'logging');
    // The office closes it, the way officeClose does, then goes to approve it.
    app.mutate(d => {
      const x = d.tickets.find(y => y.id === t.id);
      x.status = 'done'; x.synced = true; x.end = new Date().toISOString();
      x.officeClosed = true; x.closedBy = 'Omar Al-Saleh'; x.closedAt = new Date().toISOString();
      x.ticketNo = '1899'; x.mileage = 100; x.jobType = 'PKR FOR CSG TEST';
      x.items = [{ code: 'MKN-1801', desc: 'Pick-up', qty: 2, uom: 'Km', cost: 3.9, ov: {} }];
    });
    app.setState({ activeId: t.id, mgrScreen: 'review' });
    return t.id;
  });
  await p.waitForTimeout(900);
  body = await p.innerText('body');
  check('approving an office-closed job warns it is on the technician\'s behalf',
    /Approving on the technician's behalf/i.test(body),
    (body.split('\n').find(l => /behalf/i.test(l)) || '').trim().slice(0, 90));
  check('and says who closed it instead of them',
    /Closed in the office by Omar Al-Saleh/i.test(body));

  await p.getByRole('button', { name: /^Approve ticket$/i }).first().click();
  await p.waitForTimeout(900);
  const appr = await p.evaluate(([tid]) => {
    const t = window.__mkApp.state.data.tickets.find(x => x.id === tid);
    return { status: t.status, entries: (t.audit || []).filter(a => /on behalf of/i.test(a.text || '')) };
  }, [id2]);
  check('the approval goes through', appr.status === 'approved', appr.status);
  check('and the trail records it as on-behalf',
    appr.entries.length === 1 && appr.entries[0].kind === 'lifecycle',
    appr.entries[0] && appr.entries[0].text);
  await p.close();

  // ── the technician sees it, in his own Activity ──────────────────────────
  p = await open('yousef@makaman.ly');
  await p.getByRole('button', { name: /^Activity$/i }).last().click();
  await p.waitForTimeout(800);
  body = await p.innerText('body');
  check('the technician is told his job was closed in the office',
    /closed in the office by omar al-saleh/i.test(body)
    || /approved on behalf of/i.test(body),
    (body.split('\n').find(l => /office|behalf/i.test(l)) || '(nothing)').trim().slice(0, 90));
  check('and that a number was assigned while he was still working',
    /assigned while the job was still running/i.test(body),
    (body.split('\n').find(l => /still running/i.test(l)) || '(nothing)').trim().slice(0, 90));
  // Technicians read lifecycle only — the office's field-by-field edits stay the
  // office's business, and this must not have quietly opened that up.
  check('but still sees no edit entries', !/changed by .* → /i.test(body));
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
