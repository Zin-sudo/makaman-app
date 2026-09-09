// Round-trip mileage math must fire for every per-km-priced item on a ticket, not just
// one hardcoded item code — and a client's price list can carry more than one such line.
//
// The distance line has always been priced by the same rule: one-way KM entered on the
// ticket header, times roundTripFactor. But the code that actually fired that rule only
// ever recognised a single literal code, 'MKN-1801' — which happens to be HOO and SOC's
// real travel item, but not AGOCO's (ST-6601), Waha's (MKN-001) or Zueitina's
// (MKN-0001). Those three clients' travel lines silently landed as qty 1 instead of
// mileage × roundTrip, and never sorted to the top of the sheet either.
//
// The real, live cleaned price lists (2026-09-10 replacement) turned out to need TWO
// signals, not one: a UOM check ("does the uom say km?") correctly catches Waha's own
// "Truck" and "Tools pick up" catalog rows — genuine per-km items that should also scale
// with mileage — but misses the main travel line entirely for AGOCO/HOO/SOC/Zueitina,
// whose UOM cell is blank in the cleaned data even though its DESCRIPTION unmistakably
// reads "Pick-up with tools traveling to wells, per KM." in every one of those lists.
// Neither signal alone covers every real client, so the fix ORs them together. This test
// proves all three shapes at once on one ticket: a UOM-only per-km item, a
// description-only (blank-UOM) travel item, and an ordinary line that is neither.
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

  // ── Both real shapes of a per-km item get round-trip qty; an ordinary line does not ──
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
          // The main travel line's real phrasing (matches all five real clients'
          // price lists verbatim) with a made-up code and — like AGOCO/HOO/SOC/
          // Zueitina's actual live data — a BLANK uom.
          { code: 'ZZ-TRAVEL-9', desc: 'Pick-up with tools traveling to wells, per KM.', uom: '', cost: 4 },
          // A second, genuinely different per-km catalog item (like Waha's real
          // "Truck"/"Tools pick up" rows) — no special phrasing, just a "km" uom.
          // This should ALSO scale with mileage.
          { code: 'ZZ-TRUCK-1', desc: 'Truck', uom: '$/km', cost: 3 },
          { code: 'ZZ-PLAIN-1', desc: 'Test ordinary line', uom: 'Day', cost: 100 },
        ]);
      });
      app.setState({ activeId: t.id, mgrScreen: 'review' });
      return { id: t.id, roundTrip: app.props.roundTripFactor ?? 2 };
    });
    check('there is an open ticket to test on', !!setup, JSON.stringify(setup));
    await p.waitForTimeout(600);

    // Add the plain line first, then the "Truck"-style item, then the main travel line
    // last — if rank were purely insertion-order this would not tell them apart. Both
    // per-km items have to jump ahead of the ordinary line.
    const search = p.locator('input[placeholder^="Search item no."]');
    for (const code of ['ZZ-PLAIN-1', 'ZZ-TRUCK-1', 'ZZ-TRAVEL-9']) {
      await search.fill(code);
      await p.waitForTimeout(200);
      await search.press('Enter');
      await p.waitForTimeout(300);
    }

    const after = await p.evaluate(() => (window.__mkApp.ticket().items || []).map(x => ({ code: x.code, qty: x.qty })));
    check('all three lines landed on the ticket', after.length === 3, JSON.stringify(after));
    const expectedQty = 150 * (setup ? setup.roundTrip : 2);
    const travel = after.find(x => x.code === 'ZZ-TRAVEL-9');
    const truck = after.find(x => x.code === 'ZZ-TRUCK-1');
    check('the main travel line got mileage × roundTripFactor despite a blank UOM',
      !!travel && travel.qty === expectedQty, JSON.stringify(travel) + ' (expected ' + expectedQty + ')');
    check('the UOM-only "km" item ALSO got mileage × roundTripFactor',
      !!truck && truck.qty === expectedQty, JSON.stringify(truck) + ' (expected ' + expectedQty + ')');
    check('the ordinary line was left at qty 1',
      after.find(x => x.code === 'ZZ-PLAIN-1' && x.qty === 1) !== undefined, JSON.stringify(after));
    check('both per-km lines sorted ahead of the ordinary line despite being added later',
      after[0].code !== 'ZZ-PLAIN-1' && after[1].code !== 'ZZ-PLAIN-1', JSON.stringify(after));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
