// The Observer reads the work, not the machinery behind it: no edits, no tool custody.
// And the Admin owns the wording of the closing questions.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(ctx, email, fresh) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1300, height: 980 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.__TOAST_TEST_MS = 20000; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(250);
  await p.evaluate((w) => { if (w) localStorage.clear(); else localStorage.removeItem('makaman.jobtickets.session.v1'); }, !!fresh);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('x');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1000);
  return p;
}
const tab = async (p, n) => { await p.getByRole('button', { name: new RegExp('^' + n + '$', 'i') }).last().click(); await p.waitForTimeout(600); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 980 } });

  // seed a ticket carrying all three kinds of audit entry
  let p = await signIn(ctx, 'yousef@makaman.ly', true);
  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(400);
  await p.evaluate(() => { const t = Array.from(document.querySelectorAll('button')).find(x => x.style.width === '42px'); if (t) { t.click(); t.click(); } });
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    const t = d.tickets.find(x => x.status === 'approved');
    t.audit = (t.audit || []).concat([
      { ts: new Date().toISOString(), kind: 'lifecycle', by: 'Omar', text: 'STAGEMARKER approved the ticket.' },
      { ts: new Date().toISOString(), kind: 'edit', by: 'Omar', text: 'EDITMARKER unit cost changed by Omar.' },
      { ts: new Date().toISOString(), kind: 'assets', by: 'Yousef', text: 'ASSETMARKER Allocated assets accounted for on closing.' },
    ]);
    t.assetCheck = { answers: { reclaimed: { label: 'Tools allocated reclaimed?', text: 'Yes' } },
                     justification: 'SECRETJUSTIFICATION', at: new Date().toISOString(), by: 'Yousef Al-Harbi' };
    d.tickets.forEach(x => { x.synced = true; });
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
    localStorage.removeItem('makaman.jobtickets.session.v1');
  });
  await p.close();

  // ── Observer ─────────────────────────────────────────────────────────────
  p = await signIn(ctx, 'founder@makaman.ly');
  await tab(p, 'Activity');
  let body = await p.innerText('body');
  check('the Observer sees job stages', /STAGEMARKER/.test(body));
  check('but not edits', !/EDITMARKER/.test(body));
  check('and not tool custody', !/ASSETMARKER/.test(body));
  check('and is not offered the Edits filter at all', !/\bEdits\b/.test(body));
  check('the scope line says job stages', /Job stages/i.test(body));

  // and not on the ticket either
  await tab(p, 'Tickets');
  const rowT = p.locator('tr', { hasText: 'Kuwait' }).first();
  if (await rowT.count()) {
    await rowT.click();
    await p.waitForTimeout(900);
    body = await p.innerText('body');
    check('nor the accounted-for panel on the ticket', !/Allocated assets — accounted for/i.test(body));
    check('nor the justification text', !/SECRETJUSTIFICATION/.test(body));
  }
  await p.close();

  // ── the office still sees all of it ──────────────────────────────────────
  p = await signIn(ctx, 'omar@makaman.ly');
  await tab(p, 'Activity');
  body = await p.innerText('body');
  check('the Ops Manager sees stages, edits and custody',
    /STAGEMARKER/.test(body) && /EDITMARKER/.test(body) && /ASSETMARKER/.test(body));
  check('and keeps the filter chips', /\bEdits\b/.test(body));
  await tab(p, 'Tickets');
  await p.locator('tr', { hasText: 'Kuwait' }).first().getByRole('button', { name: /^(Review|View)$/i }).first().click();
  await p.waitForTimeout(900);
  body = await p.innerText('body');
  check('and reads the custody panel on the ticket', /Allocated assets — accounted for/i.test(body));
  check('including the justification', /SECRETJUSTIFICATION/.test(body));
  await p.close();

  // ── a technician sees stages only, as before ─────────────────────────────
  p = await signIn(ctx, 'yousef@makaman.ly');
  await tab(p, 'Activity');
  body = await p.innerText('body');
  check('a technician sees stages but no edits', /STAGEMARKER/.test(body) && !/EDITMARKER/.test(body));
  check('and no custody entries either', !/ASSETMARKER/.test(body));
  await p.close();

  // ── the Admin owns the questions ─────────────────────────────────────────
  p = await signIn(ctx, 'lateri@makaman.ly');
  await tab(p, 'Account');
  body = await p.innerText('body');
  check('the Admin has a Closing Questions tool', /Closing Questions/i.test(body));
  await p.getByText('Closing Questions').first().click();
  await p.waitForTimeout(800);
  body = await p.innerText('body');
  check('it opens on the editor', /What a technician is asked about allocated tools/i.test(body));

  const first = p.locator('input').filter({ hasNot: p.locator('[type=range]') }).first();
  await first.fill('Did the kit come back?');
  await p.waitForTimeout(500);
  const stored = await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    return (d.assetQuestions || [])[0];
  });
  check('editing a question sticks', stored && stored.label === 'Did the kit come back?', JSON.stringify(stored || {}));

  await p.getByRole('button', { name: /\+ Add option/i }).first().click();
  await p.waitForTimeout(500);
  const opts = await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    return (d.assetQuestions || [])[0].presets;
  });
  check('an option can be added', opts.length === 4, JSON.stringify(opts));

  // the technician sees the Admin's wording, not the built-in default
  await p.close();
  p = await signIn(ctx, 'yousef@makaman.ly');
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
    const t = d.tickets.find(x => x.status === 'logging');
    t.assets = [{ item: '7" PKR', qty: '1', note: '' }];
    localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  await p.getByText('Northern Gulf Petroleum').first().click();
  await p.waitForTimeout(800);
  await p.getByRole('button', { name: /^Job done$/i }).click();
  await p.waitForTimeout(700);
  check("the technician is asked the Admin's wording",
    /Did the kit come back\?/i.test(await p.innerText('body')));
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
