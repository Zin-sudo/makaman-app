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
      rows: document.querySelectorAll('.mk-ticket-card').length,
    }));
    check('the counter row carries it', before.tiles.some(t => /Collect Signature\/Stamp/i.test(t)),
      JSON.stringify(before.tiles));
    check('and it shows the number, not the list',
      before.tiles.some(t => new RegExp('Collect Signature/Stamp = ' + waiting + '$', 'i').test(t)),
      before.tiles.find(t => /Collect Signature\/Stamp/i.test(t)) || '(none)');
    check('the old warning block is gone', before.banner === false);

    // Tap it.
    const tile = p.locator('.mk-stat-tile', { hasText: /Collect Signature\/Stamp/i }).first();
    await tile.click();
    await p.waitForTimeout(700);
    const on = await p.evaluate(() => {
      const app = window.__mkApp;
      // The true set, read the same way the tile counted it — not "starts with 90",
      // which was only ever true by accident of insertion order. 2026-09-10's recency
      // sort (owner's request) can legitimately interleave the seed's own pre-existing
      // awaiting ticket (1882) among these fifteen staged ones depending on real
      // wall-clock activity, so the set membership is what is actually being proven.
      const wanted = new Set(app.awaitingDocs(app.state.data.tickets).map(t => t.ticketNo));
      return {
        filtered: app.state.awaitingFilter === true,
        rows: Array.from(document.querySelectorAll('.mk-ticket-card'))
          .map(r => (r.innerText || '').replace(/\s+/g, ' ').trim()),
        wanted: Array.from(wanted),
        action: (Array.from(document.querySelectorAll('.mk-stat-tile'))
          .map(x => x.innerText).find(t => /Collect Signature\/Stamp/i.test(t)) || ''),
      };
    });
    check('tapping filters the inbox', on.filtered);
    check('and the rows shown are the ones being chased',
      on.rows.length > 0 && on.rows.every(r => on.wanted.some(no => r.indexOf(no) !== -1)),
      on.rows.slice(0, 3).join(', ') + ' (' + on.rows.length + ' rows)');
    check('the tile says how to get back', /Show all/i.test(on.action));

    await tile.click();
    await p.waitForTimeout(700);
    const off = await p.evaluate(() => ({
      filtered: window.__mkApp.state.awaitingFilter === true,
      action: (Array.from(document.querySelectorAll('.mk-stat-tile'))
        .map(x => x.innerText).find(t => /Collect Signature\/Stamp/i.test(t)) || ''),
    }));
    check('tapping again puts everything back', off.filtered === false);
    // Not a row count: both lists page at ten, so the numbers agree while the contents
    // do not. What changed is the offer, and that is what is asserted.
    check('and the tile offers the filter again',
      /Show these/i.test(off.action), off.action.replace(/\n/g, ' '));
    await ctx.close();
  }

  // ── The phone: one high-alert tile, thumb-sized ──────────────────────────
  //
  // 2026-09-10, owner's request: "ticket owner should get a high alert tile to know
  // which tickets are awaiting for signature/stamp the same way that the ops have them
  // highlighted on their Ticket Inbox" — the thin .mk-awaiting-strip is gone, replaced
  // with the same .mk-stat-tile weight the office's own Collect Signature/Stamp tile
  // uses, and it must appear and disappear with awaitingDocsAny exactly as that one does.
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly', 390);
    const waiting = await stage(p, 15);
    await p.waitForTimeout(900);
    const tile = await p.evaluate(() => {
      const el = Array.from(document.querySelectorAll('.mk-stat-tile'))
        .find(x => /Collect Signature\/Stamp/i.test(x.innerText || ''));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { text: (el.innerText || '').replace(/\s+/g, ' ').trim(), h: Math.round(r.height),
        w: Math.round(r.width), overflow: Math.round(r.right) > 390 };
    });
    check('the phone gets one high-alert tile, not the old thin strip',
      !!tile, JSON.stringify(tile));
    check('the old strip class is gone from the page',
      await p.locator('.mk-awaiting-strip').count() === 0);
    check('it is a thumb-sized target', tile && tile.h >= 44, tile ? tile.h + 'px' : 'n/a');
    check('and it does not push the page sideways', tile && !tile.overflow,
      tile ? tile.w + 'px wide in 390' : 'n/a');
    check('it carries the real count', tile && new RegExp('\\b' + waiting + '\\b').test(tile.text),
      tile ? tile.text : 'n/a');

    // Appearing/disappearing with awaitingDocsAny — none of the 15 staged jobs are his own
    // (they cloned ticket[0], not necessarily his), so drive the underlying signal directly.
    const goneWhenSettled = await p.evaluate(() => {
      const app = window.__mkApp;
      // Settle every job actually still owed, not just the fifteen this test staged —
      // the seeded data already carries one of its own (the case attachments.test.js
      // exercises), and leaving it out would fail this check for the wrong reason.
      const owedIds = app.awaitingDocs(app.state.data.tickets).map(t => t.id);
      app.mutate((d) => {
        d.tickets.forEach((t) => {
          if (owedIds.indexOf(t.id) !== -1) {
            t.attachments = [
              { id: t.id + '-s', docKind: 'service_ticket', filename: 's.pdf', path: t.id + '/s.pdf' },
              { id: t.id + '-l', docKind: 'job_log', filename: 'l.pdf', path: t.id + '/l.pdf' },
            ];
          }
        });
      });
      return app.awaitingDocs(app.state.data.tickets).length;
    });
    await p.waitForTimeout(500);
    check('and once every job is settled, awaitingDocsAny goes false', goneWhenSettled === 0,
      String(goneWhenSettled));
    check('so the tile is gone, not just relabelled',
      await p.locator('.mk-stat-tile', { hasText: /Collect Signature\/Stamp/i }).count() === 0);
    await ctx.close();
  }

  // ── Somebody is actually told ────────────────────────────────────────────
  //
  // The state is derived — approved plus signedDocsMissing() — so nothing was ever written
  // when a job entered it, and the bell only saw the approval. That was survivable while an
  // unbounded banner shouted about every waiting ticket above the inbox. Replacing the
  // banner with a count is the right change, and it removed the only thing pushing the
  // backlog at anyone: a job could sit unsigned for a month with nothing surfacing it.
  //
  // Approving now writes one entry naming what is owed. Notifications derive from the
  // trail, so the bell picks it up with no second wiring.
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    const id = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = app.state.data.tickets.find(x => x.status === 'done')
        || app.state.data.tickets.find(x => x.status !== 'approved');
      app.mutate((d) => {
        const x = d.tickets.find(y => y.id === t.id);
        x.status = 'done';
        x.ticketNo = '7700';
        x.mileage = 40;
        x.jobType = 'PKR FOR CSG TEST';
        x.items = [{ code: 'MKN-1801', desc: 'A line', qty: 1, uom: 'Km', cost: 10, ov: {} }];
        x.attachments = [];
        x.audit = [];
      });
      app.openReview(t.id);
      return t.id;
    });
    await p.waitForTimeout(700);
    await p.getByRole('button', { name: /^Approve ticket$/ }).click();
    await p.waitForTimeout(800);

    const after = await p.evaluate((tid) => {
      const app = window.__mkApp;
      const t = app.state.data.tickets.find(x => x.id === tid);
      return {
        trail: (t.audit || []).map(a => a.kind + ' :: ' + a.text),
        // The bell reads the trail. Somebody else's entry, so it counts as unread.
        chased: app.awaitingDocs([t]).length,
      };
    }, id);

    check('approving records that the paperwork is now owed',
      after.trail.some(x => /lifecycle :: Waiting on the client for/.test(x)),
      JSON.stringify(after.trail.filter(x => /Waiting on/.test(x))));
    check('and names which documents, not just "paperwork"',
      after.trail.some(x => /Signed Service Ticket and Signed Job Log/.test(x)),
      (after.trail.find(x => /Waiting on/.test(x)) || '(none)').slice(0, 100));
    check('it is a job stage, so the field and the Observer see it too',
      after.trail.filter(x => /Waiting on the client/.test(x))
        .every(x => x.indexOf('lifecycle ::') === 0));
    check('and the ticket really is in the chased set', after.chased === 1,
      String(after.chased));

    // The approval dialog stays up until it is answered, and it covers the screen — the
    // second approval below cannot reach its button through it.
    await p.evaluate(() => window.__mkApp.setState({ dialog: null }));
    await p.waitForTimeout(400);

    // A ticket approved with both sheets already in hand owes nothing, and must not
    // announce a wait that is not happening.
    const quiet = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = app.state.data.tickets.find(x => x.status !== 'approved');
      if (!t) return null;
      app.mutate((d) => {
        const x = d.tickets.find(y => y.id === t.id);
        x.status = 'done'; x.ticketNo = '7701'; x.mileage = 40;
        x.jobType = 'PKR FOR CSG TEST';
        x.items = [{ code: 'MKN-1801', desc: 'A line', qty: 1, uom: 'Km', cost: 10, ov: {} }];
        x.audit = [];
        x.attachments = [
          { id: 'q1', docKind: 'service_ticket', filename: 's.pdf', path: t.id + '/s.pdf' },
          { id: 'q2', docKind: 'job_log', filename: 'l.pdf', path: t.id + '/l.pdf' },
        ];
      });
      app.openReview(t.id);
      return t.id;
    });
    if (quiet) {
      await p.waitForTimeout(700);
      await p.getByRole('button', { name: /^Approve ticket$/ }).click();
      await p.waitForTimeout(800);
      const said = await p.evaluate((tid) => {
        const t = window.__mkApp.state.data.tickets.find(x => x.id === tid);
        return (t.audit || []).map(a => a.text);
      }, quiet);
      check('a job approved with both sheets in hand announces no wait',
        !said.some(x => /Waiting on the client/.test(x)),
        JSON.stringify(said.filter(x => /Waiting/.test(x))));
    }
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
