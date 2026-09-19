// Owner's report, 2026-09-19: "Notification feed doesn't mention that the 1884 that was
// taken is free again and doesn't show the override for 1883."
//
// Two separate gaps in the numbering trail, both fixed here:
//
//   1. Taking a number from a series logs "Ticket No. X taken from the Y series," but
//      changing a ticket away from a number it once held said nothing at all — the
//      series' own next-available counter (`last`) never walked back down either, so
//      the number was not actually freed for the next person, not just unannounced.
//      reseatSeries() (built for the "unfamiliar number, discard" dialog) is now also
//      run on every ticket-number blur that changes a number away from one belonging to
//      a series, and logs a matching "released back to" entry whenever it genuinely
//      moves the counter.
//   2. noteFloorOverride() only ever fired from the ticket-number field's own blur —
//      correct for "type the number, then check the box," but the live report was the
//      OTHER order: the number was typed and refused first (no override yet, nothing to
//      log), and only the checkbox was touched after, with the number field never
//      blurring again — so the override note never fired even though the override
//      genuinely took effect. Now checked from the checkbox's own toggle too.
//
// Uses a synthetic series and a throwaway ticket added directly to the local demo store
// (same technique other suites in this project use), rather than a real seeded fixture,
// so the exact starting numbers are under this test's control.
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
const auditTexts = (p, ticketId) => p.evaluate(([id]) => {
  const t = (window.__mkApp.state.data.tickets || []).find(x => x.id === id);
  return (t && t.audit || []).map(a => a.text);
}, [ticketId]);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 980 } });

  // ── 1. Releasing a taken number ──────────────────────────────────────────────
  {
    const p = await signIn(ctx);
    const TICKET_ID = 'guard-release-0000-0000-0000-000000000001';
    const SERIES_ID = 'guard-release-series-0000-0000-000000000001';
    await p.evaluate(([ticketId, seriesId]) => window.__mkApp.mutate(d => {
      d.series.push({ id: seriesId, label: 'Guard Series', prefix: 'GRD', last: 101, floor: 100 });
      d.tickets.push({
        id: ticketId, tech: 'Yousef Al-Harbi', customer: 'GUARD-RELEASE-CUST', field: 'GUARD-FIELD',
        well: 'GUARD-WELL', rig: 'GUARD-RIG', crew: [{ name: 'Yousef Al-Harbi', email: 'yousef@makaman.ly' }],
        holder: 'Yousef Al-Harbi', jobType: 'Test', arrival: new Date().toISOString(), start: '', end: '',
        status: 'logging', synced: true, syncedAt: new Date().toISOString(), ticketNo: 'GRD101',
        mileage: '10', events: [], items: [], audit: [], currency: 'USD',
      });
    }), [TICKET_ID, SERIES_ID]);
    await p.waitForTimeout(300);

    await p.locator('.mk-ticket-card', { hasText: 'GUARD-RELEASE-CUST' }).first().click();
    await p.waitForTimeout(600);
    check('the ticket opens holding the number it was seeded with',
      await numberField(p).inputValue().then(v => v === 'GRD101'));

    // Change it to something outside the series entirely — the release check should not
    // care what it becomes, only what it stopped being.
    await typeNumber(p, '9001');

    const seriesAfter = await p.evaluate(([seriesId]) =>
      (window.__mkApp.state.data.series || []).find(s => s.id === seriesId), [SERIES_ID]);
    check('the series\' own counter walks back down once the number is no longer in use anywhere',
      seriesAfter && seriesAfter.last === 100, JSON.stringify(seriesAfter));

    const audit = await auditTexts(p, TICKET_ID);
    check('and a lifecycle entry announces the release, naming the number and the series',
      audit.some(t => /Ticket No\. GRD101 released back to the Guard Series series\./.test(t)),
      JSON.stringify(audit));
    await p.close();
  }

  // ── 2. Checking the override box AFTER a refused blur, with no second blur ──────
  {
    const p = await signIn(ctx);
    const TICKET_ID = 'guard-override-000-0000-0000-000000000002';
    const SERIES_ID = 'guard-override-series-0000-000000000002';
    await p.evaluate(([ticketId, seriesId]) => window.__mkApp.mutate(d => {
      d.series.push({ id: seriesId, label: 'Guard Floor Series', prefix: 'GFL', last: 50, floor: 50 });
      d.tickets.push({
        id: ticketId, tech: 'Yousef Al-Harbi', customer: 'GUARD-OVERRIDE-CUST', field: 'GUARD-FIELD',
        well: 'GUARD-WELL', rig: 'GUARD-RIG', crew: [{ name: 'Yousef Al-Harbi', email: 'yousef@makaman.ly' }],
        holder: 'Yousef Al-Harbi', jobType: 'Test', arrival: new Date().toISOString(), start: '', end: '',
        status: 'logging', synced: true, syncedAt: new Date().toISOString(), ticketNo: '',
        mileage: '10', events: [], items: [], audit: [], currency: 'USD',
      });
    }), [TICKET_ID, SERIES_ID]);
    await p.waitForTimeout(300);

    await p.locator('.mk-ticket-card', { hasText: 'GUARD-OVERRIDE-CUST' }).first().click();
    await p.waitForTimeout(600);

    // Type the below-floor number first, WITHOUT the override — refused, exactly the
    // live order of events.
    await typeNumber(p, 'GFL49');
    let body = await p.innerText('body');
    check('typed below the floor with no override yet: refused', /REFUSED/i.test(body));
    let audit = await auditTexts(p, TICKET_ID);
    check('and nothing about an override is logged yet', !audit.some(t => /overridden/i.test(t)));

    // Now only touch the checkbox — no further edit or blur on the number field.
    await p.locator('input[type=checkbox]').last().check();
    await p.waitForTimeout(300);
    body = await p.innerText('body');
    check('checking the box alone lifts the refusal', !/REFUSED/i.test(body));
    audit = await auditTexts(p, TICKET_ID);
    check('and the override is logged from the checkbox itself, with no second blur needed',
      audit.some(t => /Numbering floor overridden by .* GFL49 entered below the declared floor of GFL50/.test(t)),
      JSON.stringify(audit));
    await p.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
