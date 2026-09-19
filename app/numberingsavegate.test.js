// Owner's request, 2026-09-19: "The ticket should not accept a refused number unless the
// override button is checked. And when [the] override happens there needs to be a submit
// button for the edits, not only the save edits option when [leaving] after the changes."
//
// Before this, numberIssue()'s REFUSED verdict only ever blocked Approve — Save happily
// went through (and, in cloud mode, synced) with a number the screen itself was showing in
// red, because the write-through design puts every keystroke in the store regardless of
// validity (deliberate, for offline resilience — see reviewContent's own comment). That
// was never meant to extend to Save, the deliberate "this is correct now" act. Save (the
// button already on the review screen) now refuses the same way Approve does while a
// refused number sits unresolved, and the refusal is enforced in saveReview() itself, not
// only in the button's disabled state, so every path to a save agrees — the button, and
// "Save & leave" from the unsaved-changes dialog.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(ctx) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1300, height: 980 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(900);
  return p;
}
const numberField = (p) => p.locator('input[placeholder="1884 / F703 / D5024"]');
const typeNumber = async (p, v) => {
  const f = numberField(p);
  await f.click({ clickCount: 3 });
  await f.fill(v);
  await f.blur();
  await p.waitForTimeout(400);
};
const saveButton = (p) => p.getByRole('button', { name: /^Save changes$/i });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 980 } });
  const p = await signIn(ctx);

  const TICKET_ID = 'guard-savegate-00-0000-0000-000000000001';
  const SERIES_ID = 'guard-savegate-series-0000-000000000001';
  await p.evaluate(([ticketId, seriesId]) => window.__mkApp.mutate(d => {
    d.series.push({ id: seriesId, label: 'Guard Save Series', prefix: 'GSV', last: 50, floor: 50 });
    d.tickets.push({
      id: ticketId, tech: 'Yousef Al-Harbi', customer: 'GUARD-SAVEGATE-CUST', field: 'GUARD-FIELD',
      well: 'GUARD-WELL', rig: 'GUARD-RIG', crew: [{ name: 'Yousef Al-Harbi', email: 'yousef@makaman.ly' }],
      holder: '', jobType: 'Test', arrival: new Date().toISOString(), start: '', end: '',
      status: 'done', synced: true, syncedAt: new Date().toISOString(), ticketNo: '',
      mileage: '10', events: [], items: [], audit: [], currency: 'USD',
    });
  }), [TICKET_ID, SERIES_ID]);
  await p.waitForTimeout(300);

  await p.locator('.mk-ticket-card', { hasText: 'GUARD-SAVEGATE-CUST' }).first().click();
  await p.waitForTimeout(600);

  // Type a refused, below-floor number with no override — the field goes red, and now
  // Save must refuse it too, not just Approve.
  await typeNumber(p, 'GSV49');
  let body = await p.innerText('body');
  check('the number is refused', /REFUSED/i.test(body));

  const disabledWhileRefused = await saveButton(p).isDisabled();
  check('Save is disabled while a refused number sits unresolved', disabledWhileRefused);

  // Force the click anyway (bypassing the disabled attribute) to prove the refusal is
  // enforced in the method itself, not only in the button's own disabled state.
  await p.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(x => /^Save changes$/i.test((x.textContent || '').trim()));
    if (btn) { btn.disabled = false; btn.click(); }
  });
  await p.waitForTimeout(400);
  body = await p.innerText('body');
  check('forcing the click still refuses, with a toast explaining why',
    /before saving|check the override/i.test(body), (body.match(/[^\n]*before saving[^\n]*/i) || ['none'])[0]);
  const savedAnyway = await p.evaluate(([id]) => {
    const t = (window.__mkApp.state.data.tickets || []).find(x => x.id === id);
    return t && t.ticketNo === 'GSV49';
  }, [TICKET_ID]);
  // The value is still visible in the field (a keystroke is never discarded — see
  // reviewContent's own comment) but the SNAPSHOT must not have advanced to accept it as
  // saved; reviewDirty() staying true is what keeps Save (and the leave-prompt) honest.
  const stillDirty = await p.evaluate(() => window.__mkApp.reviewDirty());
  check('the ticket stays "unsaved" — the refused number was never accepted as saved',
    savedAnyway && stillDirty, 'ticketNo set: ' + savedAnyway + ', dirty: ' + stillDirty);

  // Now check the override — the same number becomes acceptable, and Save actually goes
  // through this time.
  await p.locator('input[type=checkbox]').last().check();
  await p.waitForTimeout(300);
  body = await p.innerText('body');
  check('checking the override lifts the refusal', !/REFUSED/i.test(body));
  check('and Save is enabled again', await saveButton(p).isEnabled());

  await saveButton(p).click();
  await p.waitForTimeout(400);
  body = await p.innerText('body');
  check('saving with the override checked actually succeeds', /Changes Saved/i.test(body));
  const dirtyAfter = await p.evaluate(() => window.__mkApp.reviewDirty());
  check('and the ticket is no longer marked unsaved', dirtyAfter === false);

  await ctx.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
