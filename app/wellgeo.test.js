// Two things: the coordinates printed beside the well number, and the press-and-hold
// that copies the technician's own position out of the app bar.
//
// The reason both are worth asserting is that both fail quietly. A footnote that runs
// into the next column still produces a PDF — an unreadable one. A copy that silently
// does nothing looks exactly like a copy that worked, right up to the moment someone
// pastes an empty message to the person coming to find them.
const { chromium } = require('playwright-core');
const fs = require('fs');
const pathmod = require('path');
const URL = 'http://localhost:8934/index.html';
const TMP = '/tmp/claude-0/-home-user-makaman-app/d91117f5-d40f-52d2-8052-784fa32d1e1b/scratchpad/wellgeo';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const FIX = { lat: 28.906745, lon: 19.213311 };
const COORD = '28.906745, 19.213311';

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── press and hold copies, a tap does not ────────────────────────────────
  const mob = await browser.newContext({
    viewport: { width: 430, height: 940 }, hasTouch: true, isMobile: true,
    permissions: ['geolocation', 'clipboard-read', 'clipboard-write'],
    geolocation: { latitude: FIX.lat, longitude: FIX.lon },
  });
  let p = await mob.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; window.__HOLD_TEST_MS = 250; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  let i = p.locator('input');
  await i.nth(0).fill('yousef@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(2000);

  const chip = p.locator('.mk-nav-fix');
  check('the app bar carries the position chip', await chip.count() === 1);
  check('and it reads as coordinates', (await chip.innerText()).includes(COORD),
    (await chip.innerText()).replace(/\s+/g, ' '));

  const box = await chip.boundingBox();
  const press = (ms) => p.evaluate(async ([x, y, hold]) => {
    const el = document.elementFromPoint(x, y).closest('.mk-nav-fix');
    const ev = (t) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y }));
    ev('pointerdown');
    await new Promise(r => setTimeout(r, hold));
    ev('pointerup');
    await new Promise(r => setTimeout(r, 120));
  }, [box.x + box.width / 2, box.y + box.height / 2, ms]);
  const clip = () => p.evaluate(() => navigator.clipboard.readText());
  const toastNow = () => p.evaluate(() => window.__mkApp.state.toast);

  await p.evaluate(() => navigator.clipboard.writeText('UNTOUCHED'));
  await press(80);
  check('a quick tap does not copy', (await clip()) === 'UNTOUCHED', await clip());
  // Falsy rather than strictly null: nothing has raised a banner yet this session, so
  // state.toast is still undefined — it only becomes null once one has been dismissed.
  check('and raises no banner', !(await toastNow()));

  await press(400);
  check('a press and hold copies the coordinates', (await clip()) === COORD, await clip());
  let t = await toastNow();
  check('and says so', !!t && /Coordinates Copied!/i.test(t.text), JSON.stringify(t));
  check('in the success tone, not the default blue', !!t && t.tone === 'ok', t && t.tone);

  // Held twice in a row: one banner, not two stacked. Same anti-spam rule as everything
  // else that can be pressed repeatedly.
  await press(400);
  check('holding again does not stack a second banner',
    await p.evaluate(() => document.querySelectorAll('.mk-toast').length) === 1);

  // ── the banner is short, not the standard six seconds ────────────────────
  const life = await p.evaluate(async ([x, y]) => {
    const el = document.elementFromPoint(x, y).closest('.mk-nav-fix');
    const ev = (n) => el.dispatchEvent(new PointerEvent(n, { bubbles: true, clientX: x, clientY: y }));
    const app = window.__mkApp;
    app.dismissToast();
    await new Promise(r => setTimeout(r, 60));
    ev('pointerdown');
    await new Promise(r => setTimeout(r, 300));
    ev('pointerup');
    const t0 = performance.now();
    while (!app.state.toast && performance.now() - t0 < 2000) await new Promise(r => setTimeout(r, 10));
    const born = performance.now();
    while (app.state.toast && performance.now() - born < 9000) await new Promise(r => setTimeout(r, 20));
    return Math.round(performance.now() - born);
  }, [box.x + box.width / 2, box.y + box.height / 2]);
  check('the copy banner clears in about two seconds, not six',
    life > 1500 && life < 3000, life + ' ms');
  await p.close();

  // ── the coordinates print beside the well number ─────────────────────────
  const desk = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
  p = await desk.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1400);
  // A deliberately absurd well number. The realistic ones all fit; the question worth
  // asking is what happens when one does not.
  await p.evaluate(([f]) => window.__mkApp.mutate(d => {
    d.tickets.forEach((x, n) => {
      x.geo = { open: { lat: f.lat, lon: f.lon, ts: new Date().toISOString() }, last: null, pingedAt: new Date().toISOString() };
      x.status = 'approved';
      x.ticketNo = x.ticketNo || String(9100 + n);
      // Ticket 0 gets a realistic well number, so the footnote must actually appear.
      // Ticket 1 gets an absurd one, so the guard must be exercised. Asking one ticket
      // to demonstrate both would be asking it to print the coordinates and to drop
      // them, which is why this is two tickets and two zips.
      if (n === 0) x.well = 'B235i-59W';
      if (n === 1) x.well = 'B235i-59W-EXTRA-LONG-WELL-NAME-XX';
    });
  }), [FIX]);
  await p.waitForTimeout(600);

  const noted = await p.evaluate(() => {
    const app = window.__mkApp;
    const t = app.state.data.tickets[0];
    const SH = app.buildSheets(t);
    return (JSON.stringify(SH).match(/"noteA":"\[[^"]*\]"/g) || []).length;
  });
  check('every sheet puts the coordinates on its Well No. row', noted === 8, noted + ' rows');

  await p.evaluate(() => window.__mkApp.setState({ mgrScreen: 'print' }));
  await p.waitForTimeout(900);
  const rendered = await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll('div')).find(d => d.textContent.trim() === 'Well No:');
    if (!el) return null;
    const row = el.parentElement;
    const val = row.querySelector('div:nth-child(2)');
    // The template runtime wraps every {{ binding }} in a span of its own, so the first
    // span in this row belongs to the label, not to the footnote. Pick the one actually
    // holding the coordinates — otherwise this compares the label against the value and
    // passes without ever looking at the thing under test.
    const note = Array.from(row.querySelectorAll('span'))
      .filter(sp => sp.textContent.trim().startsWith('[')).pop();
    return {
      text: row.innerText.replace(/\s+/g, ' '),
      valueSize: parseFloat(getComputedStyle(val).fontSize),
      noteSize: note ? parseFloat(getComputedStyle(note).fontSize) : null,
      overflows: row.scrollWidth > row.clientWidth + 1,
    };
  });
  check('the preview shows well then coordinates', !!rendered && rendered.text.includes('[' + COORD + ']'),
    rendered && rendered.text);
  check('the coordinates are set smaller, like a footnote',
    !!rendered && rendered.noteSize > 0 && rendered.noteSize <= rendered.valueSize - 3,
    rendered && (rendered.noteSize + 'px note vs ' + rendered.valueSize + 'px value'));
  check('and the row does not overflow its cell', !!rendered && !rendered.overflows);

  // ── and in both generated files ──────────────────────────────────────────
  const save = async (fn, name) => {
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 40000 }), p.evaluate(fn)]);
    const out = pathmod.join(TMP, name);
    await dl.saveAs(out);
    return out;
  };
  const bundle = await save(() => window.__mkApp.exportBundle(window.__mkApp.state.data.tickets, 'all-months'), 'bundle.pdf');
  const zip = await save(() => window.__mkApp.exportTicketZip(window.__mkApp.state.data.tickets[0]), 'ticket.zip');
  const zipLong = await save(() => window.__mkApp.exportTicketZip(window.__mkApp.state.data.tickets[1]), 'ticket-longwell.zip');
  check('the overview bundle downloads', fs.statSync(bundle).size > 1000);
  check('the per-ticket zip downloads', fs.statSync(zip).size > 1000);
  check('and so does one for the over-long well number', fs.statSync(zipLong).size > 1000);
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  // The two PDFs are inspected by wellgeo-pdf.py, which has a real PDF parser; this
  // file's job is the browser half.
  process.exit(fail ? 1 : 0);
})();
