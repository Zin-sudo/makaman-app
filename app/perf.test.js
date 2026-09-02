// What the app costs to use, measured rather than felt.
//
// The office reported the PWA feeling slow on button presses, and the self-check screen
// printing "Elapsed: 2500+ ms". Neither turned out to be about rendering: one mutate()
// with the live database's volume loaded is ~10 ms, and the whole store is under half a
// megabyte. What costs is going to the server, and specifically how many of those trips
// wait for each other. From Libya a round trip is ~300 ms, so four in a row is over a
// second before anything appears.
//
// So these assert on SHAPE — request counts and sequential depth — not on milliseconds.
// A wall-clock assertion would pass or fail on how busy this machine is; a count is the
// thing the code actually decides.
const { chromium } = require('playwright-core');
const { makeDB, STUB } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

// The live database's real shape. 2,610 price-list rows is what makes the paging
// question a real one rather than a hypothetical.
const DB = makeDB();
const CLIENT = DB.clients[0].id;
DB.price_list_items = [];
for (let i = 0; i < 2610; i++) DB.price_list_items.push({
  id: 'p' + i, client_id: CLIENT, item_number: 'MKN-' + i,
  description: 'A charged item with a description about as long as a real one, number ' + i,
  uom: 'Km', unit_cost: 3.9 + i, unit_cost_additional: null, currency: 'USD', has_valid_code: true });

const LATENCY = 60;   // per round trip, so sequential depth shows up as wall clock

async function open(b) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: STUB(DB) }));
  await p.addInitScript(() => {
    window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
    window.__DRAIN_TEST_MS = 120;
  });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('whatever');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1600);
  return { ctx, p };
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── A full pull, and how deep it is ──
  {
    const { ctx, p } = await open(b);
    const r = await p.evaluate((ms) => {
      window.__rtt = 0; window.__stubLatency = ms;
      const t = Date.now();
      return window.__mkApp.hydrateForTest().then(
        () => ({ ms: Date.now() - t, rtt: window.__rtt }),
        () => ({ ms: Date.now() - t, rtt: window.__rtt }));
    }, LATENCY);
    const depth = Math.round(r.ms / LATENCY);

    // Twenty-one tables are pulled. The old pager cost two requests for every one of
    // them — the rows, then an empty page to be told there were no more — plus four
    // walked end to end for the price list. Asking for the count alongside the first
    // page removes the wasted request and turns the walk into a fan-out.
    check('a full pull is one request per table, not two', r.rtt <= 25, r.rtt + ' requests');
    check('and nothing waits on more than two of them in a row', depth <= 2,
      depth + ' sequential (' + r.ms + ' ms at ' + LATENCY + ' ms each)');
    await ctx.close();
  }

  // ── A3 · Where the time actually goes ───────────────────────────────────
  //
  // "Make sure we don't have a single dependency bottleneck — if one action is taking 90%
  // of the round trip that is our bottleneck." The count of requests cannot answer that:
  // twenty that overlap cost one round trip, and two that wait on each other cost two.
  // So every answer the fake gives records its own span, and the critical path is the
  // UNION of the spans — overlapping requests are paid once.
  //
  // What is charged to each dependency is its EXCLUSIVE contribution: how much shorter
  // the pull would be if that one request did not exist. A first attempt charged each
  // event its whole duration as a share of the path, which reported nineteen parallel
  // 60 ms requests as nineteen things each holding 100% of a 60 ms path — every one of
  // them "the bottleneck", in the shape that is precisely the absence of one. Sharing a
  // window with nineteen others is not the same as owning it.
  //
  // The rule: no dependency may own more than half the critical path. Above that, making
  // everything else faster changes nothing measurable.
  {
    const { ctx, p } = await open(b);
    const r = await p.evaluate((ms) => {
      window.__stubLatency = ms;
      window.__events = [];
      const t0 = Date.now();
      return window.__mkApp.hydrateForTest().then(() => ({
        wall: Date.now() - t0,
        events: window.__events.map(e => ({ what: e.what, ms: e.end - e.start,
          start: e.start - t0, end: e.end - t0 })),
      }), () => ({ wall: Date.now() - t0, events: [] }));
    }, LATENCY);

    // The union of a set of spans, in milliseconds.
    const union = (evs) => {
      const merged = [];
      evs.slice().sort((a, b) => a.start - b.start).forEach((e) => {
        const last = merged[merged.length - 1];
        if (last && e.start <= last.end) last.end = Math.max(last.end, e.end);
        else merged.push({ start: e.start, end: e.end });
      });
      return { ms: merged.reduce((n, x) => n + (x.end - x.start), 0), stages: merged.length };
    };
    const whole = union(r.events);
    const path = whole.ms || 1;

    // One table fetched in four pages is one dependency, not four.
    const names = Array.from(new Set(r.events.map(e => e.what)));
    const table = names.map((what) => {
      const without = union(r.events.filter(e => e.what !== what)).ms;
      return { what: what, owns: path - without, share: (path - without) / path,
        ms: r.events.filter(e => e.what === what).reduce((n, e) => n + e.ms, 0) };
    }).sort((a, b) => b.owns - a.owns || b.ms - a.ms);

    console.log('\n    critical path ' + path + ' ms of ' + r.wall + ' ms wall · '
      + r.events.length + ' requests in ' + whole.stages + ' stage(s)');
    console.log('      owns   spent  dependency');
    table.slice(0, 6).forEach(x => console.log('      '
      + String(Math.round(x.share * 100)).padStart(3) + '%  '
      + String(x.ms).padStart(5) + ' ms  ' + x.what));

    check('every request in the pull is accounted for', r.events.length > 0,
      r.events.length + ' events');
    const worst = table[0];
    check('no single dependency owns more than half the critical path',
      !!worst && worst.share <= 0.5,
      worst ? worst.what + ' owns ' + Math.round(worst.share * 100) + '%' : 'nothing measured');
    check('and the pull is wide rather than deep',
      whole.stages <= 3, whole.stages + ' sequential stages');

    // And the detector is shown to fire, because one that has only ever said "no
    // bottleneck" is not known to work. One table is made ten times slower than the rest;
    // it should own nearly all of a path it now defines by itself.
    const rigged = await p.evaluate((ms) => {
      window.__stubLatency = ms;
      window.__slowOne = { what: 'tickets', ms: ms * 10 };
      window.__events = [];
      const t0 = Date.now();
      return window.__mkApp.hydrateForTest().then(() => {
        window.__slowOne = null;
        return { events: window.__events.map(e => ({ what: e.what,
          start: e.start - t0, end: e.end - t0 })) };
      });
    }, LATENCY);
    const rigWhole = union(rigged.events).ms || 1;
    const rigWithout = union(rigged.events.filter(e => e.what !== 'tickets')).ms;
    const rigShare = (rigWhole - rigWithout) / rigWhole;
    check('a real bottleneck IS caught — the check is not vacuous',
      rigShare > 0.5, 'tickets owns ' + Math.round(rigShare * 100)
        + '% when made ' + (LATENCY * 10) + ' ms');
    await ctx.close();
  }

  // ── The price list does not come down with everything else ──
  //
  // It used to: 2,610 rows, the company's entire pricing, pulled at every sign-in onto
  // every device including phones that have no use for it. Migration 0045 refuses the
  // read to anyone outside the office and hydrate() no longer asks. What replaces it is
  // ensurePriceList(), which fetches ONE customer's rows when the office actually opens
  // something that needs them — and it has to be complete, because a short price list is
  // the fault this whole pager exists to have fixed.
  {
    const { ctx, p } = await open(b);
    const atSignIn = await p.evaluate(() =>
      (window.__mkApp.state.data.clients || []).reduce((n, c) => n + (c.items || []).length, 0));
    check('a full pull brings no price-list rows at all', atSignIn === 0, atSignIn + ' rows');

    // Asked for, and complete. Same count-driven fan-out, one customer's worth.
    const fetched = await p.evaluate(() => {
      const app = window.__mkApp;
      const name = app.state.data.clients[0].name;
      return app.ensurePriceList(name).then(() => (app.client(name).items || []).length);
    });
    check('and the office gets all 2,610 when it asks for them', fetched === 2610,
      fetched + ' of 2610');

    // A server whose own cap is smaller than the page asked for. The count-driven
    // fan-out learns the real page size from what actually came back, so this must
    // still be complete — and it is the case a first draft of the pager got wrong.
    const capped = await p.evaluate(() => {
      window.__maxRows = 250;
      const app = window.__mkApp;
      const name = app.state.data.clients[0].name;
      // Cleared so the second fetch is a real fetch and not the guard returning early.
      app.setState({ data: Object.assign({}, app.state.data, {
        clients: app.state.data.clients.map(c => Object.assign({}, c, { items: [], priceListLoaded: false })) }) });
      return app.ensurePriceList(name).then(() => (app.client(name).items || []).length);
    });
    check('and still arrive when the server caps pages below what was asked for',
      capped === 2610, capped + ' of 2610 with a 250-row cap');

    // The point of the whole change: fetched, used, never written down.
    const onDisk = await p.evaluate(() => {
      const raw = localStorage.getItem('makaman.cloud.v1')
        || localStorage.getItem('makaman.jobtickets.v2') || '{}';
      return ((JSON.parse(raw).clients) || []).reduce((n, c) => n + ((c.items || []).length), 0);
    });
    check('and none of them reach localStorage', onDisk === 0, onDisk + ' rows on disk');
    await ctx.close();
  }

  // ── The self-check reports its own shape, not the network's ──
  {
    const { ctx, p } = await open(b);
    const r = await p.evaluate((ms) => {
      window.__stubLatency = ms;
      // When each query STARTS, not how long the whole thing took. Wall clock here also
      // contains the edge-function probe, which is a real fetch to a host that does not
      // exist in a test and takes as long as the machine's DNS feels like taking — that
      // is not sequencing in the app, and an assertion on it would be measuring the
      // harness. When a query starts is decided entirely by the code.
      const t0 = Date.now();
      const starts = [];
      const wire = window.__wire;
      window.__wire = function (body) { starts.push(Date.now() - t0); return wire(body); };
      const t = Date.now();
      return window.__mkApp.runSelfCheck().then((rows) => ({
        ms: Date.now() - t,
        starts: starts,
        names: rows.map((x) => x.name),
        elapsed: (rows.find((x) => x.name === 'Elapsed') || {}).detail,
      }));
    }, LATENCY);
    // Nine independent checks that used to be a .then() chain — each waiting on the one
    // before it for no reason, since none of them uses its result. From Libya that chain
    // was the whole of "Elapsed: 2500 ms": the headline number measured the shape of the
    // diagnostic rather than anything about the deploy, and sent the office looking for a
    // slowness that was not there.
    const spread = r.starts.length ? Math.max.apply(null, r.starts) : 0;
    check('every check is asked at once, not one after another',
      r.starts.length >= 2 && spread < LATENCY,
      r.starts.length + ' queries, all started within ' + spread + ' ms');
    // Order is what makes the report readable, and running them together loses it
    // unless it is put back deliberately.
    const iReach = r.names.indexOf('Reachable');
    const iPrice = r.names.indexOf('Price lists complete');
    const iEnd = r.names.indexOf('Elapsed');
    check('and still reports in a fixed order', iReach > 0 && iReach < iPrice && iPrice < iEnd,
      r.names.join(' | '));
    check('with Elapsed last', iEnd === r.names.length - 1, r.elapsed);
    await ctx.close();
  }

  // ── A double-pressed button is one request ──
  {
    const { ctx, p } = await open(b);
    // The dedupe is in adminAction, so it is asserted at the source rather than by
    // trying to catch two requests racing.
    const wired = await p.evaluate(() => {
      const src = document.querySelector('script[type="text/x-dc"]').textContent;
      return {
        keyed: /const key = action \+ ':' \+ JSON\.stringify\(payload \|\| \{\}\)/.test(src),
        joins: /const already = inFlight\.get\(key\);\s*\n\s*if \(already\) return already;/.test(src),
        // A failed call that stayed in the map would kill the button permanently —
        // worse than the double-send it prevents.
        clears: /const done = \(\) => \{ inFlight\.delete\(key\); setBusy\(-1\); \};\s*\n\s*call\.then\(done, done\);/.test(src),
      };
    });
    check('a repeated privileged call joins the one in flight', wired.joins);
    check('and is keyed on what it is asked to do, not just the action', wired.keyed);
    check('and the key is released whether it succeeds or fails', wired.clears);
    check('the app bar shows something is happening', await p.evaluate(() => {
      const src = document.querySelector('script[type="text/x-dc"]').textContent;
      return /serverBusy: !!S\.serverBusy/.test(src);
    }));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
