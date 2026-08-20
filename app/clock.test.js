// Two rules about time, both easy to get wrong quietly.
//
//  1. The operating zone is Libya, on every device, and nobody can change it. A ticket's
//     timestamps are evidence of when someone was on a wellhead; if a phone set to Dubai
//     stamped arrival an hour out, the sheet would be wrong and nothing would say so.
//  2. 12-hour is a reading preference. It changes the screen and never the record: every
//     PDF and every sheet ships 24-hour, whoever pressed the button and whatever they
//     prefer to read.
//
// Both are the kind of rule that fails silently — the app carries on, the numbers are
// just wrong — so they are asserted rather than assumed.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  // A device deliberately set to the wrong side of the world. If any timestamp follows
  // the device rather than Libya, this is what makes it visible.
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 950 }, timezoneId: 'America/Los_Angeles',
  });
  const p = await ctx.newPage();
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
  await p.waitForTimeout(1200);

  // ── the zone is pinned, not chosen ───────────────────────────────────────
  await p.evaluate(() => window.__mkApp.setState({ showSettings: true }));
  await p.waitForTimeout(500);
  let body = await p.innerText('body');
  check('Settings no longer offers a timezone',
    !/Device timezone|Cairo|Riyadh|Dubai|London/i.test(body));
  check('and says which zone everything is in instead', /Libya time \(UTC\+2\)/i.test(body));
  check('the accent-colour swatches are gone',
    await p.evaluate(() => document.querySelectorAll('span[style*="border-radius:50%"]').length) === 0);
  check('Appearance still offers the three modes',
    /system/i.test(body) && /light/i.test(body) && /dark/i.test(body));

  // Ten in the morning Libya time is one in the morning in Los Angeles, and on the
  // previous day. A formatter following the device would show both differences.
  const shown = await p.evaluate(() => {
    const F = window.__mkApp.fmt();
    return { tz: F.tz, stamp: F.stamp('2026-03-10T08:00:00.000Z'), date: F.date('2026-03-10T08:00:00.000Z') };
  });
  check('the formatter is pinned to Africa/Tripoli', shown.tz === 'Africa/Tripoli', shown.tz);
  check('a UTC instant reads as Libya wall-clock, not the device\'s',
    /10:00/.test(shown.stamp) && /10 Mar/i.test(shown.date),
    shown.stamp + '  /  ' + shown.date);

  // ── 12-hour changes the screen ───────────────────────────────────────────
  await p.evaluate(() => window.__mkApp.updateSettings({ timeFormat: '12' }));
  await p.waitForTimeout(400);
  const twelve = await p.evaluate(() => window.__mkApp.fmt().stamp('2026-03-10T08:00:00.000Z'));
  check('picking 12-hour changes what is on screen', /10:00\s*am/i.test(twelve), twelve);
  check('and still in Libya time, not the device\'s', !/1:00\s*am/i.test(twelve), twelve);

  // ── and never the record ─────────────────────────────────────────────────
  const printed = await p.evaluate(() => window.__mkApp.fmt(true).stamp('2026-03-10T08:00:00.000Z'));
  check('but a generated document is 24-hour regardless',
    /10:00/.test(printed) && !/am|pm/i.test(printed), printed);

  // The sheets are what actually reaches a client, so assert on those rather than only
  // on the formatter that builds them.
  await p.evaluate(() => window.__mkApp.setState({ showSettings: false }));
  await p.waitForTimeout(300);
  const sheetStamps = await p.evaluate(() => {
    const app = window.__mkApp;
    const t = (app.state.data.tickets || []).find(x => x.arrival) || app.state.data.tickets[0];
    const SH = app.buildSheets(t);
    return JSON.stringify(SH).match(/\d{1,2}:\d{2}(\s*[ap]m)?/gi) || [];
  });
  check('no sheet field carries an am/pm stamp while 12-hour is selected',
    sheetStamps.length > 0 && !sheetStamps.some(s => /[ap]m/i.test(s)),
    sheetStamps.slice(0, 6).join(' , ') || '(no stamps found)');

  // ── everyone starts on 24-hour ───────────────────────────────────────────
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const fresh = await p.evaluate(() => window.__mkApp.state.data.settings);
  check('a device that has never been configured starts on 24-hour',
    fresh.timeFormat === '24', JSON.stringify(fresh));
  check('and carries no accent preference at all', fresh.accent === undefined,
    'accent=' + fresh.accent);

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
