// Reordering charged items, and the wording of the closing questions.
//
// Both were registered as outstanding (S7, S8) and both turned out to be nearly done —
// which is exactly why they get a test. An unguarded "it already works" is a claim; the
// next person to touch `reorderItems` or the seed has no way of knowing what they broke.
//
// The drag itself is driven with a real HTML5 drag, not by calling the handler. Calling
// the handler would pass whether or not the row is reachable by a mouse, and "the rows
// are not draggable at all" was one of the two theories going in.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function opsOnTicket(ctx) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1400, height: 1000 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1300);
  await p.evaluate(() => {
    const app = window.__mkApp;
    // An approved ticket is sealed and its rows are correctly NOT draggable, so take one
    // that is genuinely open and give it four lines to move around.
    const t = (app.state.data.tickets || []).find(x => x.status !== 'approved');
    app.mutate((d) => {
      const x = d.tickets.find(y => y.id === t.id);
      x.items = ['A-1', 'A-2', 'A-3', 'A-4'].map((c, n) => ({
        code: c, desc: 'line ' + n, qty: 1, uom: 'Day', cost: 100, ov: {} }));
    });
    app.setState({ activeId: t.id, mgrScreen: 'review' });
  });
  await p.waitForTimeout(1000);
  return p;
}
const codes = (p) => p.evaluate(() => (window.__mkApp.ticket().items || []).map(x => x.code));

// A real pointer drag from the grip, the way a person does it.
//
// This used to be page.dragTo(), which drives Chromium's HTML5 drag-and-drop. It passed
// for two months while the feature did not work for anybody: four of the seven cells are
// inputs and swallow a drag, dataTransfer.setData() was never called so Firefox and
// Safari refused to start one, and HTML5 drag does not exist on touch at all — on the
// phone this PWA is built for it could never have worked. Driving the pointer is what a
// person actually does, and it is the only thing that would have caught any of that.
async function dragRow(p, from, to) {
  const grip = p.locator('tr[data-mk-row="' + from + '"] [title="Drag to reorder"]');
  const target = p.locator('tr[data-mk-row="' + to + '"]');
  const a = await grip.boundingBox();
  const bx = await target.boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  // More than one move: a single jump can be delivered before the listeners attach.
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 6, { steps: 3 });
  await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(400);
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── A line can actually be dragged to a new position ──
  {
    const ctx = await b.newContext();
    const p = await opsOnTicket(ctx);
    const rows = p.locator('tr[data-mk-row]');
    check('the item rows are reachable', await rows.count() === 4,
      (await rows.count()) + ' rows');
    check('and each carries a grip to grab',
      await p.locator('[title="Drag to reorder"]').count() === 4,
      (await p.locator('[title="Drag to reorder"]').count()) + ' grips');

    const before = await codes(p);
    await dragRow(p, 0, 2);
    await p.waitForTimeout(600);
    const after = await codes(p);
    check('dragging a line moves it', JSON.stringify(before) !== JSON.stringify(after),
      before.join(',') + ' -> ' + after.join(','));
    check('and nothing is lost or duplicated on the way',
      after.length === before.length && before.every(c => after.indexOf(c) >= 0),
      after.join(','));

    // reorderItems() runs when a line is ADDED, and it sorts by band. A stable sort has
    // to leave a hand-made order alone within its band, or every reorder is undone by
    // the next thing the office types.
    const kept = await p.evaluate(() => {
      const app = window.__mkApp;
      const was = (app.ticket().items || []).map(x => x.code);
      app.mutate((d) => {
        const x = d.tickets.find(y => y.id === app.ticket().id);
        x.items.push({ code: 'A-NEW', desc: 'added', qty: 1, uom: 'Day', cost: 1, ov: {} });
      });
      const now = (app.ticket().items || []).map(x => x.code);
      return { was: was, now: now };
    });
    check('the hand-made order survives adding another line',
      JSON.stringify(kept.was) === JSON.stringify(kept.now.filter(c => c !== 'A-NEW')),
      kept.was.join(',') + ' -> ' + kept.now.join(','));
    await ctx.close();
  }

  // ── The order is written down, not merely held on screen ──
  //
  // This is what S7 was actually about. The drag worked; the question was whether the
  // position leaves the device. `ticket_items.sort_order` has existed since the schema
  // catch-up, so the app has to fill it from the array index and read it back sorted —
  // otherwise a reordered ticket comes back from the server in whatever order Postgres
  // felt like returning.
  {
    const ctx = await b.newContext();
    const p = await opsOnTicket(ctx);
    const rows = p.locator('tr[draggable="true"]');
    await dragRow(p, 3, 0);
    await p.waitForTimeout(600);
    const order = await codes(p);
    const wire = await p.evaluate(() => {
      const src = document.querySelector('script[type="text/x-dc"]').textContent;
      const rows = src.slice(src.indexOf('ticket_items: (t.items || []).map'), src.indexOf('ticket_items: (t.items || []).map') + 420);
      const read = src.indexOf("items: (I[t.id] || []).slice().sort((a, b) => a.sort_order - b.sort_order)");
      return { writesIndex: /sort_order:\s*n\b/.test(rows), readsSorted: read > 0 };
    });
    check('the position is written to sort_order from the row index', wire.writesIndex);
    check('and read back in that order rather than however it arrives', wire.readsSorted);

    // Persisted locally too — a reload must not shuffle the office's arrangement.
    // The id has to be taken BEFORE the reload: activeId is state, and state does not
    // survive one, so reading it afterwards finds nothing and the check passes or fails
    // for a reason that has nothing to do with ordering.
    const id = await p.evaluate(() => window.__mkApp.state.activeId);
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    const afterReload = await p.evaluate((tid) => {
      const raw = JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || '{}');
      const t = (raw.tickets || []).find(x => x.id === tid) || {};
      return (t.items || []).map(x => x.code);
    }, id);
    check('and the order is still there after a reload',
      JSON.stringify(afterReload) === JSON.stringify(order),
      order.join(',') + ' -> ' + afterReload.join(','));
    await ctx.close();
  }

  // ── The closing question asks what the office asked ──
  {
    const ctx = await b.newContext();
    const p = await opsOnTicket(ctx);
    const q = await p.evaluate(() => {
      const src = document.querySelector('script[type="text/x-dc"]').textContent;
      const m = src.match(/key: 'reclaimed', label: '([^']+)'/);
      return m ? m[1] : null;
    });
    // migration 0009 seeds "or back-to-base?". The app said "and back to base?", which is
    // a different question — "and" demands both, "or" accepts either.
    check('the app asks the database\'s question, word for word',
      q === 'Tools allocated reclaimed or back-to-base?', JSON.stringify(q));
    check('and no longer the one that demanded both', !/and back to base/.test(q || ''));
    await ctx.close();
  }

  // ── It works with a finger, which is the whole point ─────────────────────
  //
  // HTML5 drag-and-drop has no touch equivalent, so the previous implementation could
  // never have worked on a phone whatever else was fixed. Pointer events are one API for
  // mouse, pen and touch — so drive it as a touch pointer and check.
  {
    const ctx = await b.newContext({ hasTouch: true, isMobile: true, viewport: { width: 430, height: 940 } });
    const p = await opsOnTicket(ctx);
    const before = await codes(p);
    const moved = await p.evaluate(async () => {
      const grip = document.querySelector('tr[data-mk-row="0"] [title="Drag to reorder"]');
      const rows = Array.from(document.querySelectorAll('tr[data-mk-row]'));
      if (!grip || rows.length < 3) return 'no grip';
      const a = grip.getBoundingClientRect(), t = rows[2].getBoundingClientRect();
      const ev = (type, x, y) => new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerType: 'touch', clientX: x, clientY: y });
      grip.dispatchEvent(ev('pointerdown', a.x + 8, a.y + 8));
      await new Promise(r => setTimeout(r, 40));
      document.dispatchEvent(ev('pointermove', a.x + 8, t.y + t.height / 2));
      await new Promise(r => setTimeout(r, 40));
      document.dispatchEvent(ev('pointerup', a.x + 8, t.y + t.height / 2));
      await new Promise(r => setTimeout(r, 300));
      return 'done';
    });
    const after = await codes(p);
    check('a finger can move a line, not just a mouse', moved === 'done' && after[0] !== before[0],
      before.join(',') + ' -> ' + after.join(','));
    check('and it is the same move a mouse would have made',
      after.join(',') === [before[1], before[2], before[0], before[3]].join(','),
      after.join(','));
    // The grip stops the page scrolling under the finger instead of moving the row.
    check('the grip opts out of the browser\'s own touch gestures',
      await p.evaluate(() => getComputedStyle(
        document.querySelector('[title="Drag to reorder"]')).touchAction) === 'none');
    await ctx.close();
  }

  // ── A sealed ticket has nothing to grab ──────────────────────────────────
  {
    const ctx = await b.newContext();
    const p = await opsOnTicket(ctx);
    await p.evaluate(() => {
      const app = window.__mkApp;
      app.mutate(d => { d.tickets.find(y => y.id === app.state.activeId).status = 'approved'; });
    });
    await p.waitForTimeout(700);
    check('an approved ticket offers no grips at all',
      await p.locator('[title="Drag to reorder"]').count() === 0,
      (await p.locator('[title="Drag to reorder"]').count()) + ' grips');
    await ctx.close();
  }

  // ── Moving a line is a content change, so it is recorded ─────────────────
  {
    const ctx = await b.newContext();
    const p = await opsOnTicket(ctx);
    await dragRow(p, 0, 2);
    const trail = await p.evaluate(() => (window.__mkApp.ticket().audit || []).map(a => a.kind + ' :: ' + a.text));
    check('the reorder is in the ticket trail',
      trail.some(x => /Line reordered/.test(x)), JSON.stringify(trail.slice(-1)));
    check('and says which line went where',
      trail.some(x => /A-1 moved from position 1 to 3/.test(x)),
      JSON.stringify(trail.filter(x => /reordered/.test(x))));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
