// 2026-09-11, owner's report, on the Observer's own "Live activity — in the field right
// now" section: "the LAST HEARD 10 Sept 2026 - 22:28 text is pushing the client name out
// of alignment. spread and fix the spacing properly when possible to have everything
// fitting and aligned across the whole section." .mk-live-presence is flex:none/
// white-space:nowrap on purpose (a timestamp must never wrap onto a second line), so
// sharing one 240px row with the customer/tech/location block meant the badge's own
// width always won and the name got whatever was left — which for a long "Last heard"
// label was well under half the box. Fixed by stacking the two vertically: the name
// always gets the full 240px on its own line, the badge always gets the full 240px on
// the line below it, at any length.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill('founder@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1200);

  // A live, synced ticket whose holder was last heard from a long time ago — the exact
  // shape that produces the long "Last heard <date> · <time>" label, and give it a
  // realistically long customer/tech/location line too, so this is the worst case, not
  // a cherry-picked short one.
  await p.evaluate(() => {
    window.__mkApp.mutate(d => {
      const t = d.tickets.find(x => x.status === 'logging');
      t.synced = true;
      t.syncedAt = '2026-09-01T10:00:00.000Z';
      t.customer = 'A Very Long Customer Name Company Ltd';
    });
  });
  await p.waitForTimeout(500);

  const row = await p.evaluate(() => {
    const r = document.querySelector('.mk-live-row');
    const head = r.querySelector('.mk-live-head');
    const nameBox = head.firstElementChild;
    const presence = r.querySelector('.mk-live-presence');
    const hb = head.getBoundingClientRect(), nb = nameBox.getBoundingClientRect(), pb = presence.getBoundingClientRect();
    return {
      presenceText: presence.textContent.trim(),
      headWidth: hb.width, nameWidth: nb.width, presenceWidth: pb.width,
      sameLine: Math.abs(nb.top - pb.top) < 3,
    };
  });
  check('the long presence label is the one actually being tested',
    /^Last heard/.test(row.presenceText), row.presenceText);
  check('the name and the presence badge are on separate lines, never sharing one',
    !row.sameLine, JSON.stringify(row));
  check('the customer/tech/location block gets the full 240px column, not a squeezed remainder',
    row.nameWidth > 200, row.nameWidth);
  check('and the presence badge itself is never cut off either',
    row.presenceWidth > 100, row.presenceWidth);

  // 2026-09-11, owner's report: "even though Abobaker Awhida handed over the job his
  // name still shows as the holder on the Live Activity." The row printed lt.tech —
  // whoever originally raised the job — which a handover never changes; holderOf(t)
  // (t.holder once a handover has set it, t.tech otherwise) is the field every other
  // screen already uses for "who has this now" (Well Sites, the office Inbox).
  await p.evaluate(() => {
    window.__mkApp.mutate(d => {
      const t = d.tickets.find(x => x.status === 'logging');
      t.holder = 'Abobaker Awhida';
    });
  });
  await p.waitForTimeout(500);
  const nameLine = await p.evaluate(() => {
    const r = document.querySelector('.mk-live-row');
    return r.querySelector('.mk-live-head').firstElementChild.lastElementChild.textContent;
  });
  check('the current holder\'s name shows, not whoever originally raised the job',
    /Abobaker Awhida/.test(nameLine), nameLine);
  check('and the original raiser\'s name is gone from this line',
    !/Yousef Al-Harbi/.test(nameLine), nameLine);

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
