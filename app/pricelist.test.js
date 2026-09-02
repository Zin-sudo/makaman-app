// The price lists, and the one destructive action in this app with no way back.
//
// A ticket can be withdrawn and restored. A line removed from a price list is simply
// gone — so the × has to ask first, and the asking has to name the line, because the row
// you meant and the row above it look identical once a dialog covers the table.
//
// The other half is who can do it at all. The screen was gated `role === 'admin'`, which
// meant the Ops Manager could be handed a list of corrections and make none of them.
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
// The screen now opens on a prompt rather than on whichever customer happened to be
// first — "here is Waha's price list" was the wrong answer to give somebody who came to
// look at Zueitina's. So picking one is part of getting to the table.
const openPrices = async (p) => {
  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(600);
  await p.getByText(/^Price Lists$/i).first().click();
  await p.waitForTimeout(800);
  const sel = p.locator('select').first();
  const first = await p.evaluate(() => {
    const s = document.querySelector('select');
    const opt = Array.from(s.options).find(o => o.value);
    return opt ? opt.value : '';
  });
  if (first) { await sel.selectOption(first); await p.waitForTimeout(700); }
};
// Read live state, not localStorage: the store is only written after an interaction, so
// a fresh screen reads as an empty price list when it is nothing of the kind.
const rows = (p) => p.evaluate(() => {
  const S = window.__mkApp.state;
  const c = (S.data.clients || []).find(x => x.name === S.adminClient);
  return (c && c.items || []).map(i => i.code + '|' + i.desc + '|' + i.cost);
});
const priceAudit = (p) => p.evaluate(() => (window.__mkApp.state.data.priceAudit || []).map(a => a.kind + ' :: ' + a.text));

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── The Ops Manager can now get in at all ────────────────────────────────
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    await p.getByRole('button', { name: /^Account$/i }).last().click();
    await p.waitForTimeout(600);
    check('the office sees a Price Lists tile',
      /Price Lists/i.test(await p.evaluate(() => document.body.innerText)));
    await openPrices(p);
    check('and the screen opens for them',
      await p.evaluate(() => !!document.querySelector('select') && /price list/i.test(document.body.innerText)));
    check('with editable fields, not a read-only view',
      !/You can read this price list but not change it/i.test(await p.evaluate(() => document.body.innerText)));
    await ctx.close();
  }

  // ── A technician cannot ──────────────────────────────────────────────────
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly');
    await p.getByRole('button', { name: /^Account$/i }).last().click();
    await p.waitForTimeout(600);
    check('a technician is offered no Price Lists tile',
      !/Price Lists/i.test(await p.evaluate(() => document.body.innerText)));
    // And not by the back door either: setting the tab by hand must not open it.
    await p.evaluate(() => window.__mkApp.setState({ adminTab: 'price', roleTab: 'tickets' }));
    await p.waitForTimeout(700);
    check('and cannot reach it by setting the tab directly',
      await p.evaluate(() => !/Customer price list/i.test(document.body.innerText)));
    await ctx.close();
  }

  // ── The × asks, and names the line ───────────────────────────────────────
  {
    const { ctx, p } = await boot(b, 'lateri@makaman.ly');
    await openPrices(p);
    const before = await rows(p);
    check('the price list has lines to work with', before.length > 1, before.length + ' line(s)');

    const target = before[1];
    await p.locator('table button', { hasText: '×' }).nth(1).click();
    await p.waitForTimeout(600);
    const dialog = await p.evaluate(() => document.body.innerText);
    check('the × asks before it deletes', /Remove this line from the price list/i.test(dialog));
    const code = target.split('|')[0];
    check('and the question names the line, not just "are you sure"',
      dialog.indexOf(code) >= 0, code);
    check('it says there is no restore', /no restore/i.test(dialog));

    // Backing out must actually back out.
    await p.getByRole('button', { name: /Keep it/i }).click();
    await p.waitForTimeout(500);
    const afterCancel = await rows(p);
    check('answering "Keep it" removes nothing',
      JSON.stringify(afterCancel) === JSON.stringify(before), afterCancel.length + ' vs ' + before.length);

    // Now go through with it.
    await p.locator('table button', { hasText: '×' }).nth(1).click();
    await p.waitForTimeout(500);
    await p.getByRole('button', { name: /Yes, remove it/i }).click();
    await p.waitForTimeout(700);
    const afterDelete = await rows(p);
    check('confirming removes exactly one line', afterDelete.length === before.length - 1,
      before.length + ' → ' + afterDelete.length);
    check('and it is the line that was named', afterDelete.indexOf(target) === -1);
    check('the lines either side are untouched',
      afterDelete[0] === before[0] && afterDelete[1] === before[2],
      JSON.stringify([afterDelete[0] === before[0], afterDelete[1] === before[2]]));

    // ── The audit trail ────────────────────────────────────────────────────
    const trail = await priceAudit(p);
    check('the deletion is recorded', trail.some(t => /^lifecycle :: Line removed/.test(t)),
      JSON.stringify(trail.slice(-1)));
    check('and the record keeps the price, so the line could be typed back',
      trail.some(t => /Line removed/.test(t) && t.indexOf(target.split('|')[2]) >= 0));
    check('it is tagged lifecycle, so the office sees it without the edit filter',
      trail.filter(t => /Line removed/.test(t)).every(t => t.startsWith('lifecycle')));
    await ctx.close();
  }

  // ── Editing a price is recorded with what it was ─────────────────────────
  {
    const { ctx, p } = await boot(b, 'lateri@makaman.ly');
    await openPrices(p);
    const costs = p.locator('table tbody tr').first().locator('input');
    const wasCost = await costs.nth(3).inputValue();
    await costs.nth(3).fill('4321');
    await costs.nth(3).blur();
    await p.waitForTimeout(600);
    const trail = await priceAudit(p);
    check('changing a unit cost is recorded',
      trail.some(t => /Unit cost .* changed from/.test(t)), JSON.stringify(trail.slice(-1)));
    check('the entry keeps the old value as well as the new',
      trail.some(t => t.indexOf('"' + wasCost + '"') >= 0 && t.indexOf('"4321"') >= 0),
      'was ' + wasCost);
    check('a price correction is an edit, not a lifecycle event',
      trail.filter(t => /Unit cost/.test(t)).every(t => t.startsWith('edit')));

    // Re-entering the same value is not a change and must not write a line.
    const n = (await priceAudit(p)).length;
    await costs.nth(3).fill('4321');
    await costs.nth(3).blur();
    await p.waitForTimeout(500);
    check('re-typing the same figure writes nothing',
      (await priceAudit(p)).length === n, n + ' → ' + (await priceAudit(p)).length);
    await ctx.close();
  }

  // ── It reaches the place people actually look ────────────────────────────
  {
    const { ctx, p } = await boot(b, 'lateri@makaman.ly');
    await openPrices(p);
    await p.locator('table button', { hasText: '×' }).nth(0).click();
    await p.waitForTimeout(500);
    await p.getByRole('button', { name: /Yes, remove it/i }).click();
    await p.waitForTimeout(700);
    await p.getByRole('button', { name: /^Activity$/i }).last().click();
    await p.waitForTimeout(800);
    const feed = await p.evaluate(() => document.body.innerText);
    check('the removal shows up in the Activity feed', /Line removed/i.test(feed));
    check('and says which customer it was', /Price list ·/i.test(feed));
    await ctx.close();
  }

  // ── Suggested items come from what this customer is actually charged ─────
  //
  // The reported regression: the suggestions stopped appearing. Cause was that they were
  // built by intersecting the PRICE LIST with usage — `curClient.items.filter(...)` — so
  // they needed a client row matching the ticket's customer name exactly, and they needed
  // every historical item number to still be on the current list.
  //
  // Both of those break on the two things that are about to happen: the office types
  // customer names by hand, and the corrected batches are being re-imported with changed
  // codes. So the source is now history — the lines ops actually charged this customer —
  // and the price list is consulted only to freshen the price and to notice a code that
  // has been retired. A retired code is MARKED, not dropped: eleven past charges are
  // better evidence than one absence from a list that was re-imported this morning.
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');

    const r = await p.evaluate(() => {
      const app = window.__mkApp;
      const d = app.state.data;
      const cl = d.clients[0];
      // An OPEN ticket, deliberately. Suggestions are offered where a line can still be
      // added; on an approved ticket the whole charge table is sealed and offering one
      // would be a control that does nothing.
      const t = d.tickets.find(x => x.status === 'logging') || d.tickets[0];
      const codeA = cl.items[0].code;       // still on the price list
      const codeB = cl.items[1].code;       // about to be retired from it
      const other = d.tickets.filter(x => x.id !== t.id).slice(0, 3);

      app.mutate((data) => {
        const cur = data.tickets.find(x => x.id === t.id);
        cur.customer = cl.name;
        cur.items = [];
        // Three past jobs for this customer, all charging both codes.
        other.forEach((o, n) => {
          const x = data.tickets.find(y => y.id === o.id);
          x.customer = cl.name;
          x.items = [
            { code: codeA, desc: 'Charged before, code still live', qty: 1, uom: 'Km', cost: 10, ov: {} },
            { code: codeB, desc: 'Charged before, code since retired', qty: 1, uom: 'Ea', cost: 20, ov: {} },
          ];
        });
        // The re-import: codeB no longer exists on the price list at all.
        const c = data.clients.find(y => y.id === cl.id);
        c.items = c.items.filter(i => i.code !== codeB);
      });
      app.openReview(t.id);
      return { codeA: codeA, codeB: codeB, client: cl.name, ticket: t.id };
    });
    await p.waitForTimeout(700);

    const sug = await p.evaluate(() => (window.__mkApp.render
      ? null : null) || Array.from(document.querySelectorAll('button'))
      .map(x => (x.textContent || '').trim())
      .filter(x => /—/.test(x)));
    const both = await p.evaluate((c) => {
      const txt = document.body.innerText;
      return { hasA: txt.indexOf(c.codeA) !== -1, hasB: txt.indexOf(c.codeB) !== -1,
        marked: /not on the current price list/i.test(txt) };
    }, r);

    check('a code still on the price list is suggested', both.hasA, r.codeA);
    check('a code the re-import removed is suggested too', both.hasB, r.codeB);
    check('and it is marked rather than passed off as current', both.marked,
      sug.filter(x => /price list/i.test(x)).join(' | ') || '(no marker found)');

    // The other half of the old bug: no matching client row at all.
    const orphan = await p.evaluate((c) => {
      const app = window.__mkApp;
      app.mutate((d) => {
        const cur = d.tickets.find(x => x.id === c.ticket);
        // A customer name the office typed that matches no client row exactly.
        cur.customer = c.client + ' (Onshore)';
        d.tickets.filter(x => x.id !== c.ticket).slice(0, 3)
          .forEach(o => { d.tickets.find(y => y.id === o.id).customer = c.client + ' (Onshore)'; });
      });
      app.openReview(c.ticket);
      return true;
    }, r);
    await p.waitForTimeout(700);
    const orphanText = await p.evaluate((c) => document.body.innerText.indexOf(c.codeA) !== -1, r);
    check('and suggestions survive a customer name that matches no client row',
      orphan && orphanText, r.codeA + ' under an unmatched customer');
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
