// The Team tile's green dot, and the location it reads alongside it.
//
// 2026-09-04, owner's request: the dot used to read `u.lastSync === 'live'` — seed text
// planted once at boot that nothing in the app ever wrote back to, so a technician who
// had been actively logging jobs all morning and one who had not touched their phone in
// three days could both show green, or both show grey, purely by what the demo data
// happened to say. Fixed to the same honest "last heard from" measure the ticket-level
// presence dot already uses: the newest of a person's latest position fix or their most
// recent ticket sync, green only inside a 15-minute window — never a claim that someone
// is online right now, which no device but their own can actually know.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function office(ctx) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 1000 });
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
  await p.waitForTimeout(1400);
  return p;
}

// Reads the Team table row for one technician: the dot's own inline style (checked as a
// literal string, since the binding sets it directly rather than through a class a
// computed-style lookup would have to resolve) and the text beside it.
const teamRow = (p, name) => p.evaluate((who) => {
  const row = Array.from(document.querySelectorAll('tr')).find((tr) => tr.innerText.includes(who));
  if (!row) return null;
  const dot = row.querySelector('span[style*="border-radius"]');
  return { dotStyle: dot ? dot.getAttribute('style') : '', rowText: row.innerText };
}, name);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await b.newContext();
  const p = await office(ctx);

  // A technician who has actually just logged something is fresh contact — green,
  // labelled honestly as "in contact" rather than a claim they are online right now.
  await p.evaluate(() => {
    const app = window.__mkApp;
    app.mutate((d) => {
      const t = d.tickets.find((x) => (x.tech === 'Yousef Al-Harbi' || (x.crew || []).indexOf('Yousef Al-Harbi') >= 0));
      if (t) { t.syncedAt = new Date().toISOString(); t.synced = true; }
    });
  });
  await p.evaluate(() => window.__mkApp.setState({ mgrScreen: 'team', roleTab: 'tickets' }));
  await p.waitForTimeout(500);
  let r = await teamRow(p, 'Yousef Al-Harbi');
  check('a technician heard from just now shows the green dot',
    r && /var\(--success\)/.test(r.dotStyle), JSON.stringify(r));
  check('and is labelled by when, not by a claim of being online right now',
    r && /in contact/i.test(r.rowText), r && r.rowText);

  // The same technician, but the only contact on record is old — grey, and the label
  // says when they were last heard from rather than pretending to know "yes" or "no".
  await p.evaluate(() => {
    const app = window.__mkApp;
    app.mutate((d) => {
      const t = d.tickets.find((x) => (x.tech === 'Mahmoud Zaki' || (x.crew || []).indexOf('Mahmoud Zaki') >= 0));
      if (t) { t.syncedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); t.synced = true; }
    });
  });
  await p.evaluate(() => window.__mkApp.setState({}));
  await p.waitForTimeout(400);
  r = await teamRow(p, 'Mahmoud Zaki');
  check('stale contact shows grey, never green, however long ago it was',
    r && !/var\(--success\)/.test(r.dotStyle), JSON.stringify(r));
  check('and says when they were last heard from', r && /last heard/i.test(r.rowText), r && r.rowText);

  await ctx.close();
  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
