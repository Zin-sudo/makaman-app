// 2026-09-11, owner's request: "I want them to be able to access the in-progress
// tickets to view but not be able to modify anything except adding notes. for their
// view when they enter the ticket, give them the view of technicians not the view of
// ops. as if they're a technicians accessing a ticket they don't hold. only notes are
// possible." Also: "don't allow them to edit any ticket, except adding notes on the
// tickets still before the stage 'sent to finance'." And: "make sure spam is forbidden
// with a time interval for all roles when it comes to notes."
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(ctx, email) {
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1200);
  return p;
}

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── The Observer's own list now includes in-progress tickets, not approved-only ──
  {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 950 } });
    const p = await signIn(ctx, 'founder@makaman.ly');
    const rows = p.locator('table.mk-stack tbody tr');
    check('the in-progress seed ticket (t3, Northern Gulf) is now in the Observer\'s own list',
      await rows.filter({ hasText: 'Northern Gulf' }).count() === 1);
    check('and its status chip says so, not "APPROVED" for a job still open',
      /IN PROGRESS/i.test(await rows.filter({ hasText: 'Northern Gulf' }).innerText()));
    await ctx.close();
  }

  // ── Opening an in-progress ticket shows the technician's own screen, not ops review ──
  {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 950 } });
    const p = await signIn(ctx, 'founder@makaman.ly');
    await p.locator('table.mk-stack tbody tr', { hasText: 'Northern Gulf' }).click();
    await p.waitForTimeout(700);
    const state = await p.evaluate(() => {
      const s = window.__mkApp.state;
      return { founderPeek: s.founderPeek, techScreen: s.techScreen, role: s.role };
    });
    check('the real role stays founder — this is not a role swap',
      state.role === 'founder', JSON.stringify(state));
    check('founderPeek + techScreen:log is what actually switches the screen',
      state.founderPeek === true && state.techScreen === 'log', JSON.stringify(state));
    const body = await p.innerText('body');
    check('reads exactly like a technician who does not hold this job',
      /only they can add to the log/i.test(body));
    check('and never shows the office\'s own review controls (approve, price a line, etc.)',
      !/Approve\b/i.test(body) && !/Item No\.?/i.test(body));

    // Nothing editable except the note field.
    const editableCount = await p.evaluate(() => {
      const els = Array.from(document.querySelectorAll('input, textarea, select'))
        .filter(el => !el.disabled);
      return els.map(el => el.placeholder || el.type || el.tagName).join(',');
    });
    check('the only enabled input on the whole screen is the note composer',
      editableCount === 'Raise a note on this job…', editableCount);

    // Back returns to Observer View, not a technician's own list.
    await p.getByRole('button', { name: /All tickets/i }).click();
    await p.waitForTimeout(500);
    const back = await p.evaluate(() => {
      const s = window.__mkApp.state;
      return { founderPeek: s.founderPeek, techScreen: s.techScreen };
    });
    check('"back" closes founderPeek and returns to Observer View, not a tech list',
      back.founderPeek === false && back.techScreen === null, JSON.stringify(back));
    check('and Observer View is what is actually on screen',
      /Observer View/i.test(await p.innerText('body')));
    await ctx.close();
  }

  // ── Raising a note actually works from this screen ──
  {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 950 } });
    const p = await signIn(ctx, 'founder@makaman.ly');
    await p.locator('table.mk-stack tbody tr', { hasText: 'Northern Gulf' }).click();
    await p.waitForTimeout(700);
    await p.getByPlaceholder('Raise a note on this job…').fill('Flagging this for a second look.');
    await p.getByRole('button', { name: /^RAISE$/i }).click();
    await p.waitForTimeout(600);
    check('the note lands on the ticket', /Flagging this for a second look/.test(await p.innerText('body')));
    await ctx.close();
  }

  // ── Notes stop once a ticket reaches sent_finance, but not before ──
  {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 950 } });
    const p = await signIn(ctx, 'founder@makaman.ly');
    // t1 (Kuwait Oil Group) is approved but not yet sent to finance — still fair game.
    await p.locator('table.mk-stack tbody tr', { hasText: 'Kuwait' }).click();
    await p.waitForTimeout(700);
    check('an approved-but-not-yet-sent-to-finance ticket still offers RAISE',
      await p.getByRole('button', { name: /^RAISE$/i }).count() === 1);
    await p.getByRole('button', { name: /All tickets/i }).click();
    await p.waitForTimeout(400);

    await p.evaluate(() => {
      window.__mkApp.mutate(d => {
        const t = d.tickets.find(x => x.id === 't1');
        t.status = 'sent_finance';
      });
    });
    await p.waitForTimeout(500);
    await p.locator('table.mk-stack tbody tr', { hasText: 'Kuwait' }).click();
    await p.waitForTimeout(700);
    check('once it reaches sent_finance, the Observer can no longer raise a note on it',
      await p.getByPlaceholder('Raise a note on this job…').count() === 0);
    await ctx.close();
  }

  // ── Spam guard on notes applies to every role, not just the Observer ──
  {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 950 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    await p.addInitScript(() => {
      window.MAKAMAN_CONFIG = { authMode: 'local' };
      window.__DUP_NOTE_TEST_MS = 2000;
    });
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    const i = p.locator('input');
    await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('makaman2026');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(1200);
    await p.evaluate(() => window.__mkApp.setState({ activeId: 't1', mgrScreen: 'review', roleTab: 'tickets' }));
    await p.waitForTimeout(600);
    const noteBox = p.getByPlaceholder(/Raise a note/i).first();
    await noteBox.fill('Same note, twice in a row.');
    await p.getByRole('button', { name: /^RAISE$/i }).first().click();
    await p.waitForTimeout(400);
    const before = await p.evaluate(() => (window.__mkApp.state.data.tickets.find(t => t.id === 't1').notes || []).length);
    await noteBox.fill('Same note, twice in a row.');
    await p.getByRole('button', { name: /^RAISE$/i }).first().click();
    await p.waitForTimeout(400);
    const after = await p.evaluate(() => (window.__mkApp.state.data.tickets.find(t => t.id === 't1').notes || []).length);
    check('the office\'s own identical, back-to-back note is refused as a duplicate',
      after === before, `${before} -> ${after}`);
    await p.waitForTimeout(2200); // past the test window
    await noteBox.fill('Same note, twice in a row.');
    await p.getByRole('button', { name: /^RAISE$/i }).first().click();
    await p.waitForTimeout(400);
    const later = await p.evaluate(() => (window.__mkApp.state.data.tickets.find(t => t.id === 't1').notes || []).length);
    check('but once the window has passed, the same text can genuinely be raised again',
      later === after + 1, `${after} -> ${later}`);
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
