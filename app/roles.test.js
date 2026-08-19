// What each role gets on each of the four tabs.
// Needs the app served locally (python3 -m http.server 8934 from app/) and
// playwright-core with the pre-installed Chromium.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(browser, email, w, h) {
  const p = await browser.newPage({ viewport: { width: w || 1300, height: h || 950 } });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  await p.evaluate(() => localStorage.removeItem('makaman.jobtickets.session.v1'));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('x');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1000);
  return p;
}
// innerText, not textContent: textContent also returns the <script> source, whose
// comments contain words the assertions look for.
const tab = async (p, name) => {
  await p.getByRole('button', { name: new RegExp('^' + name + '$', 'i') }).last().click();
  await p.waitForTimeout(700);
  return p.innerText('body');
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ---- Technician ----
  let p = await signIn(browser, 'yousef@makaman.ly', 430, 950);
  let body = await tab(p, 'Account');
  check('tech Account shows profile', /Name/.test(body) && /yousef@makaman\.ly/.test(body) && /Ahmadi Base/.test(body));
  check('tech Account surfaces the location toggle', /Share my position/.test(body));
  body = await tab(p, 'Sync');
  check('tech Sync is about this device', !/Field devices/.test(body));
  await p.close();

  // ---- Ops Manager ----
  p = await signIn(browser, 'omar@makaman.ly');
  body = await tab(p, 'Sync');
  check('office Sync lists field devices', /Field devices/.test(body));
  check('office Sync names technicians', /Yousef Al-Harbi/.test(body) && /Mahmoud Zaki/.test(body));
  check('office Sync excludes office staff', !/Omar Al-Saleh/.test(body.split('Field devices')[1] || ''));
  check('office Sync shows last contact', /Last contact/i.test(body));
  body = await tab(p, 'Account');
  check('mgr Account has Team', /Team/.test(body));
  check('mgr Account has no profile table', !/Share my position/.test(body));
  await p.close();

  // ---- Observer ----
  p = await signIn(browser, 'founder@makaman.ly');
  body = await p.innerText('body');
  check('observer Tickets no longer carries report controls', !/Report size/.test(body));
  body = await tab(p, 'Account');
  // Case-insensitive: innerText applies text-transform, so these render uppercase.
  check('observer Account has Reports', /Reports/i.test(body) && /Report size/i.test(body) && /Generate report/i.test(body));
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
