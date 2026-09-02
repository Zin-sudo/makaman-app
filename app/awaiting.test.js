// The awaiting-paperwork backlog: a count, not a pile.
//
// It used to render every approved job still missing its signed copy as a row inside a
// warning box ABOVE the inbox — an unbounded `sc-for` in two places, phone and desk. With
// twenty jobs waiting on a client's signature that is twenty rows of warning before the
// first ticket somebody actually opened the screen to read, and the tickets were listed
// twice on one screen.
//
// It is now one figure. On the desk it joins the counter row that already exists; on a
// phone it is a single strip. Tapping either filters the list below to exactly those jobs
// — a filter rather than a second list, so the count and the rows cannot disagree — and
// tapping again puts everything back.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function boot(b, email, width) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.setViewportSize({ width: width || 1180, height: 950 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1500);
  return { ctx, p };
}

// Fifteen approved jobs with no signed paperwork — the volume that made the old banner
// unusable, and the reason this is a count.
const stage = (p, n) => p.evaluate((many) => {
  const app = window.__mkApp;
  const seed = app.state.data.tickets[0];
  app.mutate((d) => {
    for (let i = 0; i < many; i++) {
      const t = JSON.parse(JSON.stringify(seed));
      t.id = 'aw' + i;
      t.ticketNo = '90' + (100 + i);
      t.status = 'approved';
      t.attachments = [];          // nothing signed has come back
      t.audit = [];
      d.tickets.push(t);
    }
  });
  return app.awaitingDocs(app.state.data.tickets).length;
}, n);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── The desk: a fifth counter, and it filters ────────────────────────────
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    const waiting = await stage(p, 15);
    await p.waitForTimeout(800);
    check('there are jobs waiting on paperwork', waiting >= 15, waiting + ' waiting');

    const before = await p.evaluate(() => ({
      // The old banner, gone: an unbounded list of waiting tickets above the inbox.
      banner: /still waiting on their signed paperwork/.test(document.body.innerText)
        && document.querySelectorAll('.mk-awaiting-strip').length === 0
        && !document.querySelector('.mk-stat-tile'),
      tiles: Array.from(document.querySelectorAll('.mk-stat-tile'))
        .map(x => (x.innerText || '').split('\n').slice(0, 2).join(' = ')),
      rows: document.querySelectorAll('.mk-stack tbody tr').length,
    }));
    check('the counter row carries it', before.tiles.some(t => /Awaiting paperwork/i.test(t)),
      JSON.stringify(before.tiles));
    check('and it shows the number, not the list',
      before.tiles.some(t => new RegExp('Awaiting paperwork = ' + waiting + '$', 'i').test(t)),
      before.tiles.find(t => /Awaiting paperwork/i.test(t)) || '(none)');
    check('the old warning block is gone', before.banner === false);

    // Tap it.
    const tile = p.locator('.mk-stat-tile', { hasText: /Awaiting paperwork/i }).first();
    await tile.click();
    await p.waitForTimeout(700);
    const on = await p.evaluate(() => ({
      filtered: window.__mkApp.state.awaitingFilter === true,
      // Every row on screen is one of the jobs being chased.
      rows: Array.from(document.querySelectorAll('.mk-stack tbody tr'))
        .map(r => (r.innerText || '').split('\n')[0]),
      action: (Array.from(document.querySelectorAll('.mk-stat-tile'))
        .map(x => x.innerText).find(t => /Awaiting paperwork/i.test(t)) || ''),
    }));
    check('tapping filters the inbox', on.filtered);
    check('and the rows shown are the ones being chased',
      on.rows.length > 0 && on.rows.every(r => /^90\d\d/.test(r)),
      on.rows.slice(0, 3).join(', ') + ' (' + on.rows.length + ' rows)');
    check('the tile says how to get back', /Show all/i.test(on.action));

    await tile.click();
    await p.waitForTimeout(700);
    const off = await p.evaluate(() => ({
      filtered: window.__mkApp.state.awaitingFilter === true,
      action: (Array.from(document.querySelectorAll('.mk-stat-tile'))
        .map(x => x.innerText).find(t => /Awaiting paperwork/i.test(t)) || ''),
    }));
    check('tapping again puts everything back', off.filtered === false);
    // Not a row count: both lists page at ten, so the numbers agree while the contents
    // do not. What changed is the offer, and that is what is asserted.
    check('and the tile offers the filter again',
      /Show these/i.test(off.action), off.action.replace(/\n/g, ' '));
    await ctx.close();
  }

  // ── The phone: one strip, thumb-sized ────────────────────────────────────
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly', 390);
    await stage(p, 15);
    await p.waitForTimeout(900);
    const strip = await p.evaluate(() => {
      const el = document.querySelector('.mk-awaiting-strip');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { text: (el.innerText || '').replace(/\s+/g, ' ').trim(), h: Math.round(r.height),
        w: Math.round(r.width), overflow: Math.round(r.right) > 390 };
    });
    check('the phone gets one strip, not a list', !!strip, JSON.stringify(strip));
    check('it is a thumb-sized target', strip && strip.h >= 44, strip ? strip.h + 'px' : 'n/a');
    check('and it does not push the page sideways', strip && !strip.overflow,
      strip ? strip.w + 'px wide in 390' : 'n/a');
    // The badge counts; the sentence must not count again. "16 · 16 approved jobs are
    // still waiting" is what reusing the desk label here produced.
    check('it carries the count once, not twice',
      strip && /^\d+ approved jobs? still waiting/.test(strip.text),
      strip ? strip.text : 'n/a');
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
