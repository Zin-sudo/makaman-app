// A number at or below a series' declared floor was used before this system tracked
// numbers at all (on paper) — the Numbering Series screen's own subtitle already promises
// "the system continues from there and refuses any number already used." Proves that
// promise is actually kept, and that the declared, audited override exists for special
// cases (2026-09-10, owner's request) without becoming a standing mode.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(ctx, email, fresh) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1300, height: 980 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.__TOAST_TEST_MS = 20000; });
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  await p.evaluate((w) => { if (w) localStorage.clear(); else localStorage.removeItem('makaman.jobtickets.session.v1'); }, !!fresh);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(900);
  return p;
}
const seedAll = (p) => p.evaluate(() => {
  const raw = localStorage.getItem('makaman.jobtickets.v2');
  if (!raw) return;
  const d = JSON.parse(raw);
  d.tickets.forEach(t => { t.synced = true; t.syncedAt = new Date().toISOString(); });
  localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
});
const openReview = async (p, text) => {
  const row = p.locator('.mk-ticket-card', { hasText: text }).first();
  await row.click();
  await p.waitForTimeout(800);
};
const numberField = (p) => p.locator('input[placeholder="1884 / F703 / D5024"]');
const typeNumber = async (p, v) => {
  const f = numberField(p);
  await f.click({ clickCount: 3 });
  await f.fill(v);
  await f.blur();
  await p.waitForTimeout(400);
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 980 } });

  let p = await signIn(ctx, 'omar@makaman.ly', true);
  await seedAll(p); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await openReview(p, 'Al-Dhafra');

  // Seeded Fishing series: prefix F, floor 702.
  await typeNumber(p, 'F700');
  let body = await p.innerText('body');
  check('a number at or below the declared floor is refused',
    /REFUSED.*already used, before this series started/i.test(body), (body.match(/REFUSED[^\n]*/) || ['none'])[0]);
  const approveDisabled1 = await p.getByRole('button', { name: /Approve/i }).first().isDisabled().catch(() => null);
  check('and approval stays blocked while the field-level check fails', approveDisabled1 !== false);

  await typeNumber(p, 'F800');
  body = await p.innerText('body');
  check('a number above the floor is accepted', /Available\./i.test(body), (body.match(/Available[^\n]*/) || ['none'])[0]);

  // ── the override ──────────────────────────────────────────────────────────
  const overrideBox = p.getByText('Override — allow a number below the series floor');
  check('an ops manager (holding numbering.override_floor) sees the override control',
    await overrideBox.count() > 0);
  await p.locator('input[type=checkbox]').last().check();
  await p.waitForTimeout(200);
  await typeNumber(p, 'F701');
  body = await p.innerText('body');
  check('with the override on, a below-floor number is accepted, not refused',
    !/REFUSED/i.test(body) , (body.match(/REFUSED[^\n]*/) || ['none, correctly'])[0]);

  const audit = await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    const t = d.tickets.find(x => x.customer && x.customer.indexOf('Al-Dhafra') === 0);
    return (t.audit || []).map(a => a.text);
  });
  check('the override is recorded to the audit trail, naming the number and the floor',
    audit.some(t => /Numbering floor overridden by .* F701 entered below the declared floor of F702/.test(t)),
    JSON.stringify(audit.filter(t => /overridden/i.test(t))));

  // Un-ticking should stop letting new below-floor numbers through.
  await p.locator('input[type=checkbox]').last().uncheck();
  await p.waitForTimeout(200);
  await typeNumber(p, 'F700');
  body = await p.innerText('body');
  check('unticking the override brings the refusal straight back', /REFUSED/i.test(body));
  await p.close();

  // ── nobody without the permission sees the control at all ───────────────────
  p = await signIn(ctx, 'yousef@makaman.ly');
  const hasPerm = await p.evaluate(() => window.__mkApp.hasPermission('numbering.override_floor'));
  check('a technician does not hold numbering.override_floor', hasPerm === false, String(hasPerm));
  await p.close();

  p = await signIn(ctx, 'founder@makaman.ly');
  const hasPermFounder = await p.evaluate(() => window.__mkApp.hasPermission('numbering.override_floor'));
  check('the Observer does not hold numbering.override_floor either', hasPermFounder === false, String(hasPermFounder));
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
