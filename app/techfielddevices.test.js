// Devices on Field, for a technician too. 2026-09-09, owner's request: "a technician
// should also be able to see Devices on Field under the Sync Button on the same tab. the
// same way others like ops, admin, observers see the rest of the team."
//
// One derivation (fieldDevices/hasFieldDevices), shown on both the office's Field Devices
// screen and now the technician's own Sync tab — not a second list kept in step with the
// first by hand, so this only has to prove the technician screen actually renders it, not
// re-litigate what it shows (fielddevices.test.js already covers that in full).
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 420, height: 900 } });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const i = p.locator('input');
  await i.nth(0).fill('yousef@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1200);

  await p.getByRole('button', { name: /^Sync$/i }).last().click();
  await p.waitForTimeout(600);
  const body = await p.innerText('body');

  check('the technician\'s own Sync tab still shows the phone-side sync content',
    /Last upload/.test(body));
  check('and now also a "Devices on field" section', /Devices on field/i.test(body));
  // Mahmoud is Yousef's colleague in the seed — seeing his card is the actual ask
  // ("see... the rest of the team"), not just an empty section heading.
  check('a colleague\'s device shows in it', /Mahmoud Zaki/.test(body));
  check('with the same Well location / Latest-Current location fields the office sees',
    /well location/i.test(body) && /latest\/current location/i.test(body));

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
