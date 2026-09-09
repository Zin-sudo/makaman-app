// Round-trip mileage math must key off the travel line's own description, not one
// hardcoded item code — and, it turns out, not the item's UOM either.
//
// The distance line has always been priced by the same rule everywhere: one-way KM
// entered on the ticket header, times roundTripFactor. But the code that actually fires
// that rule only ever recognised a single literal code, 'MKN-1801' — which happens to be
// HOO and SOC's real travel item, but not AGOCO's (ST-6601), Waha's (MKN-001) or
// Zueitina's (MKN-0001). Those three clients' travel lines silently landed as qty 1
// instead of mileage × roundTrip, and never sorted to the top of the sheet either.
//
// A UOM check ("does the uom say km?") looked like the fix, until the live cleaned price
// lists (2026-09-10 replacement) were checked directly: the real travel line's own UOM
// cell is BLANK for four of the five real clients — only Waha's carries "per KM" — while
// a handful of unrelated catalog rows ("Truck", "Tools pick up") DO carry a literal
// "km"/"$/km" UOM and would have been wrongly swept up as the transportation line. The
// one signal that is actually consistent everywhere is the item's DESCRIPTION, which
// reads "Pick-up with tools traveling to wells, per KM." verbatim in every real client's
// list. This test proves both halves of that: the real travel line's phrasing gets
// round-trip qty even with a blank UOM and a made-up code, and a decoy item that merely
// HAS a "km" UOM (but isn't the travel line) does not.
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
  return p;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── The real travel line's own wording gets round-trip qty, blank UOM and all ──
  {
    const ctx = await b.newContext();
    const p = await opsOnTicket(ctx);

    const setup = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || []).find(x => x.status !== 'approved');
      if (!t) return null;
      app.mutate((d) => {
        const x = d.tickets.find(y => y.id === t.id);
        x.items = []; // start from a clean sheet so rank/position checks are unambiguous
        x.mileage = '150';
        const cl = d.clients.find(c => c.name === t.customer);
        cl.items = (cl.items || []).concat([
          // The real travel line's phrasing (matches all five real clients' price lists
          // verbatim), but a made-up code and — critically — a BLANK uom, exactly like
          // AGOCO/HOO/SOC/Zueitina's actual live data.
          { code: 'ZZ-TRAVEL-9', desc: 'Pick-up with tools traveling to wells, per KM.', uom: '', cost: 4 },
          // A decoy: it carries a "km" uom (like the real "Truck"/"Tools pick up" rows
          // that share a price list with the real travel item) but is NOT the travel
          // line. A uom-only check would wrongly catch this one too.
          { code: 'ZZ-DECOY-KM', desc: 'Truck', uom: '$/km', cost: 3 },
          { code: 'ZZ-PLAIN-1', desc: 'Test ordinary line', uom: 'Day', cost: 100 },
        ]);
      });
      app.setState({ activeId: t.id, mgrScreen: 'review' });
      return { id: t.id, roundTrip: app.props.roundTripFactor ?? 2 };
    });
    check('there is an open ticket to test on', !!setup, JSON.stringify(setup));
    await p.waitForTimeout(600);

    // Add the plain line first, then the decoy, then the real travel line last — if
    // rank were purely insertion-order, or if the decoy's uom fooled the detector, this
    // would not tell them apart. The real travel line has to jump ahead of both.
    const search = p.locator('input[placeholder^="Search item no."]');
    for (const code of ['ZZ-PLAIN-1', 'ZZ-DECOY-KM', 'ZZ-TRAVEL-9']) {
      await search.fill(code);
      await p.waitForTimeout(200);
      await search.press('Enter');
      await p.waitForTimeout(300);
    }

    const after = await p.evaluate(() => (window.__mkApp.ticket().items || []).map(x => ({ code: x.code, qty: x.qty })));
    check('all three lines landed on the ticket', after.length === 3, JSON.stringify(after));
    const travel = after.find(x => x.code === 'ZZ-TRAVEL-9');
    const decoy = after.find(x => x.code === 'ZZ-DECOY-KM');
    check('the real travel line got mileage × roundTripFactor despite a blank UOM',
      !!travel && travel.qty === 150 * (setup ? setup.roundTrip : 2),
      JSON.stringify(travel) + ' (expected ' + (150 * (setup ? setup.roundTrip : 2)) + ')');
    check('the "km"-uom decoy was NOT treated as the travel line',
      !!decoy && decoy.qty === 1, JSON.stringify(decoy));
    check('the ordinary line was left at qty 1',
      after.find(x => x.code === 'ZZ-PLAIN-1' && x.qty === 1) !== undefined, JSON.stringify(after));
    check('the real travel line sorted to the top despite being added last',
      after[0].code === 'ZZ-TRAVEL-9', JSON.stringify(after));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
