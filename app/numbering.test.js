// One person allocates ticket numbers at a time, and a closed job is settled. These are
// the rules that stop two devices printing the same number on two clients' sheets.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(ctx, email, fresh) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1300, height: 980 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.__TOAST_TEST_MS = 20000; });
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  await p.evaluate((w) => { if (w) localStorage.clear(); else localStorage.removeItem('makaman.jobtickets.session.v1'); }, !!fresh);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(900);
  return p;
}
const store = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || 'null'));
// The store is only written on the first mutation, so a fresh session has nothing to
// edit yet. The seeded tickets the office needs are already marked synced, so this is
// only a top-up when a store happens to exist.
const seedAll = (p) => p.evaluate(() => {
  const raw = localStorage.getItem('makaman.jobtickets.v2');
  if (!raw) return;
  const d = JSON.parse(raw);
  d.tickets.forEach(t => { t.synced = true; t.syncedAt = new Date().toISOString(); });
  localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
});
const openReview = async (p, text) => {
  const row = p.locator('tr', { hasText: text }).first();
  await row.getByRole('button', { name: /^(Review|View)$/i }).first().click();
  await p.waitForTimeout(800);
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 980 } });

  // ── the claim holder may allocate ────────────────────────────────────────
  let p = await signIn(ctx, 'omar@makaman.ly', true);
  await seedAll(p); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await openReview(p, 'Al-Dhafra');
  let body = await p.innerText('body');
  check('the holder is named on the numbering panel', /Omar Al-Saleh holds the numbering claim/i.test(body));
  check('and the controls are live for them', !/holds the numbering claim\. Ask them/i.test(body));

  // Read the offer off the button rather than the store: the store is not written until
  // the first mutation, and the button is what the Ops Manager actually acts on.
  const offer = () => p.getByRole('button', { name: /Special Tools →/i }).innerText();
  const offeredBefore = await offer();
  await p.getByRole('button', { name: /Special Tools →/i }).click();
  await p.waitForTimeout(700);
  let d = await store(p);
  const taken = d.tickets.find(x => x.customer.indexOf('Al-Dhafra') === 0).ticketNo;
  check('a number can be taken from a series', !!taken && taken !== '', taken);
  const offeredAfter = await offer();
  check('and the series moves on to the next one', offeredAfter !== offeredBefore,
    `${offeredBefore.trim()} -> ${offeredAfter.trim()}`);

  // clearing the number hands it back
  await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll('input')).find(x => x.placeholder && x.placeholder.indexOf('1884') === 0);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await p.waitForTimeout(700);
  const offeredReleased = await offer();
  check('releasing a number offers it again rather than stranding the gap',
    offeredReleased.trim() === offeredBefore.trim(),
    `${offeredAfter.trim()} -> ${offeredReleased.trim()} (was ${offeredBefore.trim()})`);
  await p.close();

  // ── a manager without the claim cannot allocate ──────────────────────────
  p = await signIn(ctx, 'lateri@makaman.ly');
  await openReview(p, 'Al-Dhafra');
  body = await p.innerText('body');
  check('another manager is told who holds the claim', /Omar Al-Saleh holds the numbering claim\. Ask them to hand it over/i.test(body));
  const disabled = await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll('input')).find(x => x.placeholder && x.placeholder.indexOf('1884') === 0);
    return el ? el.disabled : null;
  });
  check('and the number field is inert for them', disabled === true, String(disabled));
  await p.close();

  // ── an in-progress job takes no number ───────────────────────────────────
  p = await signIn(ctx, 'omar@makaman.ly');
  // A running job reaches the office in the background — that is what keeps the live
  // panel and the emergency coordinates working — so the office can open it.
  await seedAll(p);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await openReview(p, 'Northern Gulf');
  body = await p.innerText('body');
  check('a running job refuses a number', /still running\. A number is assigned once it is closed/i.test(body));

  // ── closing for the technician needs the data ────────────────────────────
  check('the office can close a running job', /Close the job for the technician/i.test(body));
  // This seeded job has everything, so closing is offered. Take the job type away and
  // the office must be told what is missing rather than allowed to close a half sheet.
  check('and is allowed to, when the job has everything', !/Missing before this job can be closed/i.test(body));
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    const t = d.tickets.find(x => x.customer.indexOf('Northern Gulf') === 0);
    t.jobType = ''; t.rig = '';
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await openReview(p, 'Northern Gulf');
  body = await p.innerText('body');
  check('but not while data is missing, and it names what', /Missing before this job can be closed.*rig.*job type/i.test(body),
    (body.split('\n').find(l => /Missing before/.test(l)) || 'no note').trim());
  const closeBtn = p.getByRole('button', { name: /Close the job for the technician/i });
  check('the close button is actually inert, not just captioned',
    await closeBtn.isDisabled());
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    const t = d.tickets.find(x => x.customer.indexOf('Northern Gulf') === 0);
    t.jobType = 'COMBINATION FOR PRESSURE TEST BETWEEN PERFS'; t.rig = 'NG-2';
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
  });
  await p.close();

  // ── the offline collision ────────────────────────────────────────────────
  p = await signIn(ctx, 'yousef@makaman.ly');
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    const t = d.tickets.find(x => x.customer.indexOf('Northern Gulf') === 0);
    // the office closed it; this device closed its own copy while out of signal
    t.status = 'done'; t.officeClosed = true; t.closedBy = 'Omar Al-Saleh';
    t.closedAt = new Date().toISOString(); t.synced = false;
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: /^Sync$/i }).last().click();
  await p.waitForTimeout(500);
  await p.getByRole('button', { name: /Sync now/i }).click();
  await p.waitForTimeout(900);
  body = await p.innerText('body');
  check('the technician is told the office closed it first',
    /already closed in the office by Omar Al-Saleh/i.test(body));
  check('and that his copy was not uploaded', /not uploaded/i.test(body));
  d = await store(p);
  const clash = d.tickets.find(x => x.customer.indexOf('Northern Gulf') === 0);
  check('the ticket leaves the upload list', clash.synced === true);
  check('and the discard is on the record',
    (clash.audit || []).some(a => /Field copy discarded on sync/i.test(a.text)));

  // and he can no longer reopen it
  await p.getByRole('button', { name: /^Tickets$/i }).last().click();
  await p.waitForTimeout(500);
  await p.getByText('Northern Gulf Petroleum').first().click();
  await p.waitForTimeout(700);
  body = await p.innerText('body');
  check('the technician cannot correct an office-closed job',
    /Closed in the office by Omar Al-Saleh/i.test(body));
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
