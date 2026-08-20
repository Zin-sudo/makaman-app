// Brief messages are drop banners: they hold for six seconds, can be dismissed sooner,
// and pressing the same button again does not stack a second one — it pushes the
// countdown out, so a held button cannot turn into a spam loop.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
const HOLD = 1500; // stands in for the six seconds
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(ctx, email, offline) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 430, height: 900 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript((ms) => { window.__TOAST_TEST_MS = ms; }, HOLD);
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('x');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(900);
  return p;
}
const toasts = (p) => p.locator('.mk-toast');
const tab = async (p, n) => { await p.getByRole('button', { name: new RegExp('^' + n + '$', 'i') }).last().click(); await p.waitForTimeout(400); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });

  // ── connectivity is detected, not chosen ─────────────────────────────────
  let p = await signIn(ctx, 'yousef@makaman.ly');
  let body = await p.innerText('body');
  check('signed in online without touching anything', /ONLINE/.test(body) && !/NO SIGNAL/.test(body));
  await tab(p, 'Sync');
  body = await p.innerText('body');
  check('the demo TOGGLE button is gone', !/TOGGLE/i.test(body));
  check('status is shown as detected', /Detected automatically/i.test(body));

  // real offline, driven through the browser rather than an in-app switch
  await ctx.setOffline(true);
  await p.waitForTimeout(500);
  body = await p.innerText('body');
  check('going offline is picked up from the device', /NO SIGNAL/.test(body));
  await ctx.setOffline(false);
  await p.waitForTimeout(500);
  check('and coming back online too', /ONLINE/.test(await p.innerText('body')));

  // ── the banner, and the anti-spam rule ───────────────────────────────────
  const btn = p.getByRole('button', { name: /Sync now/i });
  await btn.click();
  await p.waitForTimeout(250);
  check('pressing Sync drops a banner', await toasts(p).count() === 1);
  check('it says what happened', /Already Synchronized/i.test(await toasts(p).first().innerText()));

  // hammer it — one banner must remain, not six
  for (let i = 0; i < 6; i++) { await btn.click(); await p.waitForTimeout(90); }
  check('pressing it repeatedly never stacks a second banner', await toasts(p).count() === 1,
    `${await toasts(p).count()} on screen`);

  // the countdown runs from the LAST press, not the first
  await p.waitForTimeout(HOLD * 0.6);
  check('still showing partway through the hold after the last press', await toasts(p).count() === 1);
  await p.waitForTimeout(HOLD * 0.7);
  check('retires itself once the presses stop', await toasts(p).count() === 0);

  // dismissable sooner
  await btn.click(); await p.waitForTimeout(200);
  await toasts(p).first().getByRole('button').click();
  await p.waitForTimeout(200);
  check('can be closed instantly instead of waiting', await toasts(p).count() === 0);
  await p.close();

  // ── location sharing: caution on the way off, silence on the way on ──────
  p = await signIn(ctx, 'yousef@makaman.ly');
  await tab(p, 'Account');
  const knob = () => p.locator('button').filter({ hasText: '' }).nth(0);
  const flip = async () => {
    await p.evaluate(() => { const t = Array.from(document.querySelectorAll('button')).find(x => x.style.width === '42px'); t.click(); });
    await p.waitForTimeout(350);
  };
  await flip(); // on -> off
  check('turning location sharing off cautions the technician', await toasts(p).count() === 1);
  check('and says why it matters', /emergenc|cannot reach you|No Location Shared/i.test(await toasts(p).first().innerText()),
    (await toasts(p).count()) ? await toasts(p).first().innerText() : '');
  await toasts(p).first().getByRole('button').click();
  await p.waitForTimeout(200);
  await flip(); // off -> on
  check('turning it back on says nothing', await toasts(p).count() === 0);
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
