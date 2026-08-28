// Kit handed out on a running job, accounted for when the job closes. The three answers
// are the ones someone rings the office to ask a week later.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(ctx, email, fresh, w, h) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w || 1300, height: h || 980 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.__TOAST_TEST_MS = 20000; });
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  await p.evaluate((wipe) => { if (wipe) localStorage.clear(); else localStorage.removeItem('makaman.jobtickets.session.v1'); }, !!fresh);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1000);
  return p;
}
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || 'null'));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 980 } });

  // ── the office allocates kit on a running job ────────────────────────────
  let p = await signIn(ctx, 'omar@makaman.ly', true);
  await p.evaluate(() => {
    // the running job has to have reached the office for it to be opened
    const raw = localStorage.getItem('makaman.jobtickets.v2');
    if (raw) { const d = JSON.parse(raw); d.tickets.forEach(t => { t.synced = true; }); localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d)); }
  });
  // seed via a technician session, which persists
  const seeder = await signIn(ctx, 'yousef@makaman.ly');
  await seeder.getByRole('button', { name: /^Account$/i }).last().click();
  await seeder.waitForTimeout(400);
  await seeder.evaluate(() => { const t = document.querySelector('.mk-switch'); if (t) { t.click(); t.click(); } });
  await seeder.waitForTimeout(500);
  await seeder.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    d.tickets.forEach(t => { t.synced = true; });
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
    localStorage.removeItem('makaman.jobtickets.session.v1');
  });
  await seeder.close();
  await p.close();

  p = await signIn(ctx, 'omar@makaman.ly');
  const row = p.locator('tr', { hasText: 'Northern Gulf' }).first();
  await row.getByRole('button', { name: /^(Review|View)$/i }).first().click();
  await p.waitForTimeout(900);
  let body = await p.innerText('body');
  check('a running job offers an allocation list', /Tools & crossovers allocated/i.test(body));
  check('and names who it goes to', /Allocated to Yousef Al-Harbi/i.test(body));

  await p.getByRole('button', { name: /\+ Add item/i }).click();
  await p.waitForTimeout(400);
  await p.getByPlaceholder(/PKR \/ crossover/i).first().fill('7" PKR');
  await p.waitForTimeout(250);
  await p.getByPlaceholder(/^Qty$/).first().fill('1');
  await p.waitForTimeout(250);
  await p.getByPlaceholder(/^Note$/).first().fill('with crossover box');
  await p.waitForTimeout(500);
  let d = await store(p);
  let tk = d.tickets.find(x => x.customer.indexOf('Northern Gulf') === 0);
  check('the item is written to the ticket', (tk.assets || []).length === 1 && tk.assets[0].item === '7" PKR',
    JSON.stringify(tk.assets));
  check('with quantity and note', tk.assets[0].qty === '1' && /crossover box/.test(tk.assets[0].note));

  // an approved ticket must not offer allocation
  const approvedRow = p.locator('tr', { hasText: 'Kuwait' }).first();
  await p.getByRole('button', { name: /‹ Inbox/i }).click();
  await p.waitForTimeout(500);
  await approvedRow.getByRole('button', { name: /^(Review|View)$/i }).first().click();
  await p.waitForTimeout(800);
  check('a finished job does not offer allocation', !/Tools & crossovers allocated/i.test(await p.innerText('body')));
  await p.close();

  // ── the technician is stopped on the way out ─────────────────────────────
  p = await signIn(ctx, 'yousef@makaman.ly', false, 430, 940);
  await p.getByText('Northern Gulf Petroleum').first().click();
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: /^Job done$/i }).click();
  await p.waitForTimeout(600);
  body = await p.innerText('body');
  check('closing asks about the tools first', /Account for the tools before closing/i.test(body));
  check('all three questions are asked',
    /Tools allocated reclaimed/i.test(body) && /Tools allocated location/i.test(body) && /Tools allocated left behind or damaged/i.test(body));

  // Nothing is red until Confirm is pressed — the prompt does not open scolding.
  check('no demand before anything is attempted',
    !/wasn't answered/i.test(await p.innerText('body')));

  // press Confirm with nothing answered: it must name every missing question
  await p.getByRole('button', { name: /Confirm and close the job/i }).click();
  await p.waitForTimeout(600);
  body = await p.innerText('body');
  check('pressing Confirm blank names each unanswered question',
    /Question 1 wasn't answered/i.test(body) && /Question 2 wasn't answered/i.test(body) && /Question 3 wasn't answered/i.test(body));
  check('and opens the justification with its reason',
    /If questions not answered, you must justify/i.test(body));
  check('and the job is still open', await p.getByRole('button', { name: /Confirm and close the job/i }).count() === 1);

  await p.getByRole('button', { name: /^Yes$/ }).click();
  await p.waitForTimeout(300);
  check('answering one clears only that question',
    !/Question 1 wasn't answered/i.test(await p.innerText('body'))
    && /Question 2 wasn't answered/i.test(await p.innerText('body')));

  // question two takes several answers
  await p.getByRole('button', { name: /^In vehicle$/i }).click();
  await p.waitForTimeout(250);
  await p.getByRole('button', { name: /^At rig$/i }).click();
  await p.waitForTimeout(350);
  const bothOn = await p.evaluate(() => {
    const on = Array.from(document.querySelectorAll('button')).filter(b =>
      ['In vehicle', 'At rig'].indexOf(b.innerText.trim()) !== -1);
    return on.map(b => getComputedStyle(b).backgroundColor);
  });
  check('question two keeps more than one answer at once',
    bothOn.length === 2 && bothOn.every(c => c !== 'rgba(0, 0, 0, 0)'), JSON.stringify(bothOn));

  // a chosen option must look clearly different from an unchosen one
  const contrast = await p.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const on = btns.find(b => b.innerText.trim() === 'In vehicle');
    const off = btns.find(b => b.innerText.trim() === 'At String-30');
    const g = (el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color, w: getComputedStyle(el).fontWeight });
    return { on: g(on), off: g(off) };
  });
  check('a chosen option is visibly different from an unchosen one',
    contrast.on.bg !== contrast.off.bg && contrast.on.fg !== contrast.off.fg,
    JSON.stringify(contrast));

  // question one takes only one
  await p.getByRole('button', { name: /^Not yet$/i }).click();
  await p.waitForTimeout(350);
  const singles = await p.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return ['Yes', 'Not yet'].map(txt => {
      const b = btns.find(x => x.innerText.trim() === txt);
      return getComputedStyle(b).backgroundColor;
    });
  });
  check('question one replaces its answer rather than adding one',
    singles[0] !== singles[1], JSON.stringify(singles));

  await p.getByRole('button', { name: /^None$/i }).click();
  await p.waitForTimeout(400);
  check('with all three answered nothing is demanded',
    !/wasn't answered/i.test(await p.innerText('body')));
  check('and the manual row disappears entirely',
    await p.getByRole('button', { name: /Type manually instead/i }).count() === 0);
  check('taking its text box with it',
    await p.locator('textarea[placeholder="Type the answer…"]').count() === 0);

  await p.getByRole('button', { name: /Confirm and close the job/i }).click();
  await p.waitForTimeout(700);
  check('and then the usual close confirmation appears', /Yes, job done/i.test(await p.innerText('body')));
  await p.getByRole('button', { name: /Yes, job done/i }).click();
  await p.waitForTimeout(800);

  d = await store(p);
  tk = d.tickets.find(x => x.customer.indexOf('Northern Gulf') === 0);
  check('the answers are stored on the ticket', !!tk.assetCheck, JSON.stringify(tk.assetCheck || {}));
  check('the single-answer questions hold one value each',
    (tk.assetCheck.answers || {}).reclaimed.text === 'Not yet'
    && (tk.assetCheck.answers || {}).leftBehind.text === 'None',
    JSON.stringify(tk.assetCheck.answers));
  check('and the multi-answer question holds both',
    /In vehicle/.test((tk.assetCheck.answers || {}).location.text)
    && /At rig/.test((tk.assetCheck.answers || {}).location.text),
    (tk.assetCheck.answers || {}).location.text);
  check('and it is on the audit trail',
    (tk.audit || []).some(a => /Allocated assets accounted for on closing/i.test(a.text)));
  check('filed under its own kind, not as a job stage',
    (tk.audit || []).some(a => /Allocated assets/i.test(a.text) && a.kind === 'assets'));
  check('the job did actually close', tk.status === 'done', tk.status);
  await p.close();

  // ── the office reads them, pinned ────────────────────────────────────────
  p = await signIn(ctx, 'omar@makaman.ly');
  // Closing marks a ticket as needing upload again, so it leaves the inbox until it is
  // synced. Upload it the way the technician would.
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    d.tickets.forEach(t => { t.synced = true; t.syncedAt = new Date().toISOString(); });
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await p.locator('tr', { hasText: 'Northern Gulf' }).first().getByRole('button', { name: /^(Review|View)$/i }).first().click();
  await p.waitForTimeout(900);
  body = await p.innerText('body');
  check('the office sees the answers on the ticket', /Allocated assets — accounted for on closing/i.test(body));
  check('with the actual answers', /Not yet/i.test(body) && /In vehicle/i.test(body) && /At rig/i.test(body));
  check('and who answered them', /Answered by Yousef Al-Harbi/i.test(body));
  await p.close();

  // ── a job with no kit closes exactly as before ───────────────────────────
  p = await signIn(ctx, 'mahmoud@makaman.ly', false, 430, 940);
  const mine = await p.innerText('body');
  if (/Al-Dhafra/.test(mine)) {
    await p.getByText('Al-Dhafra Energy').first().click();
    await p.waitForTimeout(800);
    const btn = p.getByRole('button', { name: /^(Job done|Reopen for corrections)$/i });
    if (await btn.count()) {
      await btn.click();
      await p.waitForTimeout(600);
      check('a job with no allocated kit is not asked the questions',
        !/Account for the tools before closing/i.test(await p.innerText('body')));
    }
  }
  await p.close();

  // ── a written justification alone is enough ─────────────────────────────
  p = await signIn(ctx, 'omar@makaman.ly');
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    const t = d.tickets.find(x => x.customer.indexOf('Northern Gulf') === 0);
    t.status = 'logging'; t.assetCheck = null; t.end = '';
    t.assets = [{ item: 'Wash pipe', qty: '1', note: '' }];
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
  });
  await p.close();
  p = await signIn(ctx, 'yousef@makaman.ly', false, 430, 1300);
  await p.getByText('Northern Gulf Petroleum').first().click();
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: /^Job done$/i }).click();
  await p.waitForTimeout(700);
  await p.getByRole('button', { name: /Type manually instead/i }).click();
  await p.waitForTimeout(300);
  await p.locator('textarea[placeholder="Type the answer…"]').first().fill('Rig closed the site early, kit still on the pad');
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /Confirm and close the job/i }).click();
  await p.waitForTimeout(700);
  check('typing a justification alone closes the job, with nothing ticked',
    /Yes, job done/i.test(await p.innerText('body')));
  await p.getByRole('button', { name: /Yes, job done/i }).click();
  await p.waitForTimeout(800);
  const d2 = await store(p);
  const tk2 = d2.tickets.find(x => x.customer.indexOf('Northern Gulf') === 0);
  check('and the justification is what got recorded',
    /kit still on the pad/i.test((tk2.assetCheck || {}).justification || ''),
    JSON.stringify((tk2.assetCheck || {}).justification || ''));
  check('with the unanswered questions left blank rather than invented',
    ((tk2.assetCheck || {}).answers || {}).reclaimed.text === '',
    JSON.stringify(((tk2.assetCheck || {}).answers || {}).reclaimed));
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
