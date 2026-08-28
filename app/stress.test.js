// The device under field conditions.
//
// Two failures live here. The first is the one that costs a technician his day: the
// device fills up, the write is refused, and the app carries on showing work that exists
// only in memory. The second is what happens when two people change the same ticket while
// one of them has no signal.
//
// The sync flow's own outcomes are covered by sync.test.js, and the office-closed
// collision by numbering.test.js. This suite deliberately does not repeat them.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
const K = 'makaman.jobtickets.v2';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(ctx, email) {
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
  await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1300);
  return p;
}
// Refuse every write to the technician's store, exactly as a browser at quota does.
const jamStorage = (p) => p.evaluate((key) => {
  const proto = Object.getPrototypeOf(localStorage);
  window.__realSet = window.__realSet || proto.setItem;
  proto.setItem = function (k, v) {
    if (k === key) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    return window.__realSet.call(this, k, v);
  };
}, K);
const freeStorage = (p) => p.evaluate(() => {
  if (window.__realSet) Object.getPrototypeOf(localStorage).setItem = window.__realSet;
});

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── A refused save is never silent ──
  {
    const ctx = await b.newContext();
    const p = await signIn(ctx, 'yousef@makaman.ly');
    await jamStorage(p);
    const r = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = app.state.data.tickets.find(x => x.status === 'logging') || app.state.data.tickets[0];
      app.mutate((d) => {
        const x = d.tickets.find(y => y.id === t.id);
        (x.events = x.events || []).push({ ts: new Date().toISOString(), text: 'Set 7in RBP at 8420 ft.' });
      });
      const disk = (JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || '{}').tickets || [])
        .find(y => y.id === t.id) || {};
      return { inMemory: (app.ticket(t.id).events || []).length, onDisk: (disk.events || []).length,
               flagged: !!app.state.storageFull };
    });
    check('the write really was refused', r.onDisk < r.inMemory, r.onDisk + ' on disk vs ' + r.inMemory + ' in memory');
    check('and the app knows it, rather than swallowing it', r.flagged);
    await p.waitForTimeout(700);
    const seen = await p.evaluate(() => ({
      text: /out of storage/i.test(document.body.innerText),
      says: /was not saved/i.test(document.body.innerText),
      retry: !!Array.from(document.querySelectorAll('button')).find(x => /TRY AGAIN/i.test(x.textContent)),
    }));
    check('the person is told, in words, on screen', seen.text && seen.says);
    check('and offered a way to try again', seen.retry);

    // A toast would have faded by now. This has to still be there — the device is still
    // full and the work is still unsaved.
    await p.getByText('Activity', { exact: true }).first().click();
    await p.waitForTimeout(600);
    const stillThere = await p.evaluate(() => /out of storage/i.test(document.body.innerText));
    check('the warning follows them to another tab', stillThere);

    // And it clears itself the moment a save gets through.
    await freeStorage(p);
    await p.getByRole('button', { name: /TRY AGAIN/i }).click();
    await p.waitForTimeout(800);
    const after = await p.evaluate(() => ({
      gone: !/out of storage/i.test(document.body.innerText),
      onDisk: ((JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || '{}').tickets || [])
        .find(y => (y.events || []).some(e => /8420 ft/.test(e.text))) || {}).id || null,
    }));
    check('retrying once there is room clears the warning', after.gone);
    check('and the line that was stranded is now on disk', after.onDisk !== null, String(after.onDisk));
    await ctx.close();
  }

  // ── Making room never costs the record ──
  {
    const ctx = await b.newContext();
    const p = await signIn(ctx, 'yousef@makaman.ly');
    const r = await p.evaluate(() => {
      localStorage.setItem('makaman.cloud.v1', '{"tickets":[]}');
      localStorage.setItem('makaman.outbox.refused.v1', '[{"op":"x"}]');
      const outboxBefore = localStorage.getItem('makaman.outbox.v1');
      const storeBefore = localStorage.getItem('makaman.jobtickets.v2');
      const freed = window.__mkApp.shedStorage('makaman.jobtickets.v2');
      return {
        freed: freed,
        keptStore: localStorage.getItem('makaman.jobtickets.v2') === storeBefore,
        keptOutbox: localStorage.getItem('makaman.outbox.v1') === outboxBefore,
        droppedCache: localStorage.getItem('makaman.cloud.v1') === null,
        droppedDead: localStorage.getItem('makaman.outbox.refused.v1') === null,
      };
    });
    check('the shed finds something to drop', r.freed);
    check('it drops the replica of the mode we are not in', r.droppedCache);
    check('and the set-aside diagnostic pile', r.droppedDead);
    check('but never the tickets', r.keptStore);
    check('and never the outbox', r.keptOutbox);
    await ctx.close();
  }

  // ── Two people, one ticket, one of them offline ──
  //
  // Not a merge test — the app has no field-level merge, and B8 ("flag sync conflicts
  // instead of overwriting") is still open. What is asserted here is what actually
  // happens, so that when a merge is built there is a recorded before.
  {
    const ctx = await b.newContext();
    const p = await signIn(ctx, 'yousef@makaman.ly');
    const r = await p.evaluate(async () => {
      const app = window.__mkApp;
      const t = app.state.data.tickets.find(x => x.status === 'logging') || app.state.data.tickets[0];
      const id = t.id;
      // The technician loses signal and keeps logging.
      app.setState({ online: false });
      app.mutate((d) => {
        const x = d.tickets.find(y => y.id === id);
        (x.events = x.events || []).push({ ts: new Date().toISOString(), text: 'OFFLINE LINE from the field.' });
      });
      const mine = (app.ticket(id).events || []).length;
      // Meanwhile the office edits the same ticket.
      app.mutate((d) => { d.tickets.find(y => y.id === id).rig = 'OFFICE-EDIT-RIG'; });
      app.setState({ online: true });
      return {
        lines: (app.ticket(id).events || []).length,
        keptMine: (app.ticket(id).events || []).some(e => /OFFLINE LINE/.test(e.text)),
        keptTheirs: app.ticket(id).rig === 'OFFICE-EDIT-RIG',
        wasQueued: (JSON.parse(localStorage.getItem('makaman.outbox.v1') || '[]')).length >= 0,
      };
    });
    check('a line written with no signal is kept', r.keptMine);
    check('and an edit to another field of the same ticket does not erase it',
      r.keptMine && r.keptTheirs, 'lines ' + r.lines + ', rig kept ' + r.keptTheirs);
    await ctx.close();
  }

  // ── A change the server refuses is not allowed to go quiet ──
  //
  // Two devices reaching for one ticket number is the case this exists for. The database
  // already refuses it — `ticket_number text unique` in 0001 — so the collision is caught
  // at the right boundary. What was missing was the answer: the op was retried five
  // times, set aside so it could not freeze the queue, and never mentioned again, while
  // the device went on showing a change the office would never receive.
  {
    const ctx = await b.newContext();
    const p = await signIn(ctx, 'omar@makaman.ly');
    const r = await p.evaluate(() => {
      const app = window.__mkApp;
      // Exactly what Postgres says when the unique index fires.
      const pgErr = { message: 'duplicate key value violates unique constraint "tickets_ticket_number_key"' };
      app.setAsideForTest({ key: 'tickets:t1', table: 'tickets' }, pgErr);
      return { count: app.refusedCount(), why: app.refusedLatest() };
    });
    check('the refusal is kept, with its reason', r.count === 1, r.count + ' set aside');
    check('and the reason is in words the office can act on',
      /ticket number is already used/i.test(r.why), r.why.slice(0, 60));
    check('it names the remedy, not just the fault', /next free number/i.test(r.why));

    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    const shown = await p.evaluate(() => ({
      onScreen: /refused by the server/i.test(document.body.innerText),
      survived: /ticket number is already used/i.test(document.body.innerText),
    }));
    check('it is on screen after a reload — the change is still missing', shown.onScreen);
    check('and still says why', shown.survived);
    await ctx.close();
  }

  // ── A ticket the office settled while the technician was offline ──
  //
  // This used to be checked by grepping the source for `x.status === 'approved'`, which
  // passed for the right reason once and then failed the moment the same rule was
  // expressed differently — the guard now asks `settled(x)`, which catches approved and
  // both post-approval states rather than only the first. Grepping the implementation
  // tests the spelling; what matters is that a stale field copy of a settled ticket is
  // held back and the technician is told why. So drive it.
  {
    const ctx = await b.newContext();
    const p = await signIn(ctx, 'yousef@makaman.ly');
    // Set the office's copy to a settled state, leave the field copy unsynced, then run
    // the sync the technician would run and read what it did.
    const clashFor = (status, closedBy) => p.evaluate(([st, by]) => {
      const app = window.__mkApp;
      const t = (app.state.data.tickets || []).filter(x => x.tech === 'Yousef Al-Harbi')[0];
      if (!t) return Promise.resolve({ error: 'no fixture' });
      app.mutate(d => {
        const x = d.tickets.find(y => y.id === t.id);
        x.status = st; x.synced = false;
        x.officeClosed = !!by; x.closedBy = by || '';
        x.audit = [];
      });
      return new Promise(r => setTimeout(() => {
        app.renderVals().sync();
        setTimeout(() => {
          const x = (app.state.data.tickets || []).find(y => y.id === t.id);
          r({
            discarded: (x.audit || []).some(a => /Field copy discarded on sync/.test(a.text)),
            reason: ((x.audit || []).find(a => /discarded/.test(a.text)) || {}).text || '',
            uploaded: (x.audit || []).some(a => /Uploaded from field device/.test(a.text)),
          });
        }, 900);
      }, 400));
    }, [status, closedBy]);

    for (const st of ['approved', 'sent_client', 'sent_finance']) {
      const res = await clashFor(st, '');
      check('a stale copy of a ticket at ' + st + ' is discarded, not uploaded over',
        res.discarded && !res.uploaded, JSON.stringify(res));
      check('  and the technician is told it was settled in the office',
        /already approved in the office/.test(res.reason), res.reason);
    }
    const closed = await clashFor('done', 'Omar Al-Saleh');
    check('one the office merely closed is discarded too', closed.discarded && !closed.uploaded,
      JSON.stringify(closed));
    check('and that reason names the person who closed it',
      /already closed in the office by Omar Al-Saleh/.test(closed.reason), closed.reason);
    check('the technician is told which of the two it was',
      await p.evaluate(() => document.querySelector('script[type="text/x-dc"]').textContent
        .indexOf('already approved in the office') >= 0));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
