// Save changes, and the question on the way out.
//
// Asked for by the office: a Save button on the ticket review screen, and a prompt if you
// leave with unsaved work. The thing to be careful about is what "unsaved" can honestly
// mean here. Every field on this screen writes straight through to the store on each
// keystroke — that is deliberate, and it stays, because the app has to survive a phone
// dying mid-sentence and a form holding an hour of pricing in memory is exactly the
// failure it exists to prevent.
//
// So Save is not what makes the work durable. It is what says the work is IN and has gone
// up to the office, and Discard is what puts the ticket back the way it was found. Both
// of those need the ticket as it was at the moment it was opened, which is what the
// snapshot is for — and the tests below are mostly about that snapshot being right.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function open(ctx, email) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 1000 });
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
  await p.waitForTimeout(1400);
  return p;
}
// The first ticket in the Ops Manager's inbox that can still be edited.
const openEditable = (p) => p.evaluate(() => {
  const app = window.__mkApp;
  const t = (app.state.data.tickets || []).find(x => !app.settled(x) && !x.deletedAt);
  if (!t) return null;
  app.openReview(t.id);
  return t.id;
});
const state = (p) => p.evaluate(() => {
  const app = window.__mkApp;
  const t = (app.state.data.tickets || []).find(x => x.id === app.state.activeId);
  return {
    dirty: app.reviewDirty(),
    screen: app.state.mgrScreen,
    dialog: app.state.dialog,
    mileage: t ? t.mileage : null,
    ticketNo: t ? t.ticketNo : null,
    items: t ? (t.items || []).length : -1,
    edits: t ? (t.audit || []).filter(a => a.kind === 'edit').length : -1,
    // The note is the savebar's own direct child, not any span the runtime happens to
    // wrap the button's label in — an earlier version of this read the button back to
    // itself and passed while saying nothing.
    note: (() => {
      const bar = document.querySelector('.mk-savebar');
      if (!bar) return '';
      const el = Array.from(bar.children).find(x => x.tagName === 'SPAN');
      return el ? el.textContent : '';
    })(),
    btnOff: (() => { const b = document.querySelector('.mk-save-btn'); return b ? b.disabled : null; })(),
  };
});

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── An untouched ticket has nothing to save, and says so ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx, 'omar@makaman.ly');
    const id = await openEditable(p);
    check('there is an editable ticket to review', !!id, String(id));
    await p.waitForTimeout(400);
    const s0 = await state(p);
    check('the Save button is there', s0.btnOff !== null);
    check('and is inert with nothing changed', s0.btnOff === true);
    check('and says so rather than saying nothing', /is saved/i.test(s0.note), s0.note);

    // Leaving is not questioned when there is nothing to lose.
    await p.getByRole('button', { name: /‹ Inbox/ }).click();
    await p.waitForTimeout(500);
    const s1 = await state(p);
    check('leaving an untouched ticket asks nothing', s1.dialog === null && s1.screen === 'inbox',
      s1.screen + ' / ' + s1.dialog);
    await ctx.close();
  }

  // ── A change wakes the button ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx, 'omar@makaman.ly');
    await openEditable(p);
    await p.waitForTimeout(300);
    await p.evaluate(() => window.__mkApp.patchTicket({ mileage: '137' }));
    await p.waitForTimeout(400);
    const s = await state(p);
    check('changing the mileage counts as a change', s.dirty === true);
    check('the button comes alive', s.btnOff === false);
    check('and the line beside it says what is true', /unsaved/i.test(s.note), s.note);

    await p.locator('.mk-save-btn').click();
    await p.waitForTimeout(600);
    const after = await state(p);
    check('saving settles it', after.dirty === false && after.btnOff === true);
    check('the change itself is kept', after.mileage === '137', String(after.mileage));
    check('and it says saved', /is saved/i.test(after.note), after.note);
    const toast = await p.evaluate(() => document.body.innerText);
    check('and confirms it out loud', /Changes Saved/i.test(toast));
    await ctx.close();
  }

  // ── Leaving with a change asks, and all three answers work ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx, 'omar@makaman.ly');
    await openEditable(p);
    await p.waitForTimeout(300);
    const was = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || []).find(x => x.id === app.state.activeId);
      return { mileage: t.mileage, items: (t.items || []).length };
    });
    await p.evaluate(() => window.__mkApp.patchTicket({ mileage: '999' }));
    await p.waitForTimeout(300);

    // 1. Keep editing.
    await p.getByRole('button', { name: /‹ Inbox/ }).click();
    await p.waitForTimeout(500);
    let s = await state(p);
    check('leaving with a change asks first', s.dialog === 'unsavedReview', String(s.dialog));
    const dlg = await p.evaluate(() => document.body.innerText);
    check('the question offers all three answers',
      /Save & leave/i.test(dlg) && /Discard changes/i.test(dlg) && /Keep editing/i.test(dlg));
    await p.getByRole('button', { name: /^Keep editing$/i }).click();
    await p.waitForTimeout(400);
    s = await state(p);
    check('Keep editing stays put and keeps the change',
      s.screen === 'review' && s.mileage === '999', s.screen + ' / ' + s.mileage);

    // 2. Discard — and it must actually put it back.
    await p.getByRole('button', { name: /‹ Inbox/ }).click();
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /^Discard changes$/i }).click();
    await p.waitForTimeout(600);
    const back = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || []).find(x => x.id === app.state.activeId);
      return { screen: app.state.mgrScreen, mileage: t.mileage, items: (t.items || []).length };
    });
    check('Discard leaves the screen', back.screen === 'inbox', back.screen);
    check('AND puts the ticket back as it was found', back.mileage === was.mileage,
      JSON.stringify(back.mileage) + ' vs ' + JSON.stringify(was.mileage));
    check('without touching the lines', back.items === was.items);
    await ctx.close();
  }

  // ── 3. Save & leave ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx, 'omar@makaman.ly');
    await openEditable(p);
    await p.waitForTimeout(300);
    await p.evaluate(() => window.__mkApp.patchTicket({ mileage: '412' }));
    await p.waitForTimeout(300);
    await p.getByRole('button', { name: /‹ Inbox/ }).click();
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: /Save & leave/i }).click();
    await p.waitForTimeout(700);
    const r = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || []).find(x => x.id === app.state.activeId);
      return { screen: app.state.mgrScreen, mileage: t.mileage, dirty: app.reviewDirty() };
    });
    check('Save & leave leaves', r.screen === 'inbox', r.screen);
    check('and keeps the change', r.mileage === '412', String(r.mileage));
    check('and it survives as saved, not pending', r.dirty === false);
    await ctx.close();
  }

  // ── The trail stays truthful after a discard ──
  //
  // An audit entry reading "Mileage changed 40 → 999" is a lie the moment the 999 is put
  // back. The edit entries written during the visit go with the edits; nothing else in
  // the trail is touched.
  {
    const ctx = await b.newContext();
    const p = await open(ctx, 'omar@makaman.ly');
    await openEditable(p);
    await p.waitForTimeout(300);
    const before = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || []).find(x => x.id === app.state.activeId);
      return { edits: (t.audit || []).filter(a => a.kind === 'edit').length,
               life: (t.audit || []).filter(a => a.kind === 'lifecycle').length };
    });
    await p.evaluate(() => {
      const app = window.__mkApp;
      app.patchTicket({ mileage: '777' });
      app.log('Mileage changed by the office: 40 → 777.', 'edit');
    });
    await p.waitForTimeout(400);
    await p.evaluate(() => window.__mkApp.discardReview());
    await p.waitForTimeout(500);
    const after = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || []).find(x => x.id === app.state.activeId);
      return { edits: (t.audit || []).filter(a => a.kind === 'edit').length,
               life: (t.audit || []).filter(a => a.kind === 'lifecycle').length,
               ghost: (t.audit || []).some(a => /777/.test(a.text || '')) };
    });
    check('the entry describing a discarded edit goes with it', !after.ghost);
    check('and the edit count is back where it started', after.edits === before.edits,
      before.edits + ' -> ' + after.edits);
    check('while the job history is untouched', after.life === before.life,
      before.life + ' -> ' + after.life);
    await ctx.close();
  }

  // ── An approved ticket offers no Save, because it offers no edit ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx, 'omar@makaman.ly');
    const found = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || []).find(x => app.settled(x) && !x.deletedAt);
      if (!t) return false;
      app.openReview(t.id);
      return true;
    });
    await p.waitForTimeout(500);
    if (found) {
      const bar = await p.evaluate(() => !!document.querySelector('.mk-savebar'));
      check('a settled ticket has no Save control at all', !bar);
    } else {
      check('a settled ticket has no Save control at all', false, 'no settled ticket in the fixtures');
    }
    await ctx.close();
  }

  // ── Switching tabs is an exit too ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx, 'omar@makaman.ly');
    await openEditable(p);
    await p.waitForTimeout(300);
    await p.evaluate(() => window.__mkApp.patchTicket({ mileage: '55' }));
    await p.waitForTimeout(300);
    await p.getByText('Account', { exact: true }).first().click();
    await p.waitForTimeout(500);
    const s = await state(p);
    check('walking off to another tab asks the same question', s.dialog === 'unsavedReview',
      String(s.dialog));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
