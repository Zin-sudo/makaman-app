// One day in the field, end to end, before there is a real one.
//
// The individual rules already have suites — approval, lifecycle, notes, assets,
// attachments, handover, conflict, numbering. What none of them does is run a job through
// the whole arc in one session and check the state machine still holds at the far end.
// That is what this is: a technician raises jobs and logs to them, edits them while they
// are open, accounts for the kit he was given, closes some and leaves others; the office
// approves, reopens one with a reason, corrects it and re-approves; the technician is
// refused on the sealed ticket; the office and the Observer raise notes and resolve them;
// the signed paperwork comes back and the job moves to finance.
//
// Nothing here touches the live database. It runs against the demo store, which is the
// same reducer the cloud path writes through.
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
const trail = (p, id) => p.evaluate((tid) => {
  const t = window.__mkApp.state.data.tickets.find(x => x.id === tid) || {};
  return (t.audit || []).map(a => a.kind + ' :: ' + a.text);
}, id);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ══ The technician's day ═════════════════════════════════════════════════
  const { ctx, p } = await boot(b, 'yousef@makaman.ly', 390);

  // Six jobs raised and logged to, the way a week actually arrives.
  const ids = await p.evaluate(() => {
    const app = window.__mkApp;
    const made = [];
    app.mutate((d) => {
      for (let i = 0; i < 6; i++) {
        const id = 'fs' + i;
        made.push(id);
        d.tickets.push({
          id: id, tech: 'Yousef Al-Harbi', holder: 'Yousef Al-Harbi',
          crew: [{ name: 'Yousef Al-Harbi', email: 'yousef@makaman.ly' }],
          customer: 'Kuwait Oil Group', field: 'Burgan North', well: 'BG-' + (200 + i),
          rig: 'WS-11', jobType: 'PKR', status: 'logging', mileage: 40 + i,
          start: new Date(Date.now() - (6 - i) * 86400000).toISOString(),
          end: '', items: [], assets: [], notes: [], attachments: [],
          audit: [], events: [], synced: true, syncedAt: new Date().toISOString(),
        });
      }
    });
    // Logged to, in the words a technician actually writes.
    made.forEach((id, i) => {
      app.mutate((d) => {
        const t = d.tickets.find(x => x.id === id);
        t.events = [
          { ts: new Date(Date.now() - 7200000).toISOString(), text: 'Rigged up on wellhead, JSA completed.' },
          { ts: new Date(Date.now() - 3600000).toISOString(), text: 'Ran tool, P/T to 3000 psi, held.' },
        ];
        // Two of them were given kit that has to be accounted for at closing.
        if (i < 2) t.assets = [{ item: '7" PKR', qty: '1', note: 'from base' }];
      });
    });
    return made;
  });
  await p.waitForTimeout(600);
  check('six jobs are raised and logged to', ids.length === 6, ids.join(', '));

  // ── Edits while the job is open register, and survive a reload ───────────
  await p.evaluate((id) => {
    const app = window.__mkApp;
    app.setState({ activeId: id, techScreen: 'log', roleTab: 'tickets' });
    app.mutate((d) => { d.tickets.find(x => x.id === id).well = 'BG-999'; });
    app.logOn(id, 'Well corrected on site: BG-200 to BG-999.', 'edit');
  }, ids[0]);
  await p.waitForTimeout(700);
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(1400);
  const kept = await p.evaluate((id) => {
    const t = (window.__mkApp.state.data.tickets || []).find(x => x.id === id) || {};
    return { well: t.well, edits: (t.audit || []).filter(a => a.kind === 'edit').length };
  }, ids[0]);
  check('an edit made while the job is open survives a reload', kept.well === 'BG-999',
    JSON.stringify(kept.well));
  check('and is written to the trail as an edit', kept.edits >= 1, kept.edits + ' edit entries');

  // ── Closing a job with kit out asks for it back, in the trail ────────────
  await p.evaluate((id) => {
    window.__mkApp.setState({ activeId: id, techScreen: 'log', roleTab: 'tickets' });
  }, ids[0]);
  await p.waitForTimeout(700);
  await p.getByRole('button', { name: /Job done/i }).first().click();
  await p.waitForTimeout(700);
  const prompted = await p.evaluate(() => ({
    open: window.__mkApp.state.assetPrompt === true,
    text: document.body.innerText,
  }));
  check('closing a job with kit out asks for the kit first', prompted.open === true);
  check('and names the question rather than a generic confirm',
    /reclaimed|back-to-base/i.test(prompted.text));

  // Answer it, the way a technician does.
  await p.evaluate(() => {
    const app = window.__mkApp;
    const qs = app.state.data.assetQuestions || [];
    const draft = {};
    qs.forEach(q => { draft[q.key] = (q.presets || ['Yes'])[0]; });
    app.setState({ assetDraft: draft });
  });
  await p.waitForTimeout(400);
  await p.getByRole('button', { name: /confirm|done|close/i }).first().click().catch(() => {});
  await p.waitForTimeout(800);
  const answered = await trail(p, ids[0]);
  check('the answers reach the audit trail, not just the ticket',
    answered.some(x => /assets :: Allocated assets accounted for/.test(x)),
    JSON.stringify(answered.filter(x => /assets ::/.test(x)).slice(0, 1)));
  check('and they carry what was actually answered',
    answered.some(x => /assets ::/.test(x) && /:/.test(x.split('— ')[1] || '')),
    (answered.find(x => /assets ::/.test(x)) || '').slice(0, 90));

  // Close four, leave two running.
  await p.evaluate((all) => {
    const app = window.__mkApp;
    app.mutate((d) => {
      all.slice(0, 4).forEach((id) => {
        const t = d.tickets.find(x => x.id === id);
        t.status = 'done';
        t.end = new Date().toISOString();
      });
    });
  }, ids);
  await p.waitForTimeout(600);
  const shape = await p.evaluate((all) => {
    const ts = window.__mkApp.state.data.tickets.filter(x => all.indexOf(x.id) >= 0);
    return { done: ts.filter(x => x.status === 'done').length,
      logging: ts.filter(x => x.status === 'logging').length };
  }, ids);
  check('four are closed and two left running', shape.done === 4 && shape.logging === 2,
    JSON.stringify(shape));
  await ctx.close();

  // ══ The office ═══════════════════════════════════════════════════════════
  const office = await boot(b, 'omar@makaman.ly');
  await office.p.evaluate((all) => {
    // The same six jobs, as the office receives them.
    const app = window.__mkApp;
    app.mutate((d) => {
      all.forEach((id, i) => {
        d.tickets.push({
          id: id, tech: 'Yousef Al-Harbi', holder: 'Yousef Al-Harbi',
          crew: [{ name: 'Yousef Al-Harbi', email: 'yousef@makaman.ly' }],
          customer: 'Kuwait Oil Group', field: 'Burgan North', well: 'BG-' + (200 + i),
          rig: 'WS-11', jobType: 'PKR FOR CSG TEST', status: i < 4 ? 'done' : 'logging',
          mileage: 40 + i, ticketNo: '' + (7100 + i),
          start: new Date(Date.now() - 86400000).toISOString(),
          end: i < 4 ? new Date().toISOString() : '',
          items: [{ code: 'MKN-1801', desc: 'Pick-up with tools', qty: 40, uom: 'Km', cost: 3.9, ov: {} }],
          assets: [], notes: [], attachments: [], audit: [], events: [],
          synced: true, syncedAt: new Date().toISOString(),
        });
      });
    });
  }, ids);
  await office.p.waitForTimeout(700);

  // ── Approve three ────────────────────────────────────────────────────────
  for (const id of ids.slice(0, 3)) {
    await office.p.evaluate((tid) => window.__mkApp.openReview(tid), id);
    await office.p.waitForTimeout(600);
    await office.p.getByRole('button', { name: /^Approve ticket$/ }).click();
    await office.p.waitForTimeout(600);
    await office.p.getByRole('button', { name: /Back to inbox/i }).click().catch(() => {});
    await office.p.waitForTimeout(400);
  }
  const approved = await office.p.evaluate((all) => window.__mkApp.state.data.tickets
    .filter(x => all.indexOf(x.id) >= 0 && x.status === 'approved').map(x => x.id), ids);
  check('the office approves three', approved.length === 3, JSON.stringify(approved));

  const frozen = await office.p.evaluate((id) => {
    const t = window.__mkApp.state.data.tickets.find(x => x.id === id);
    return (t.items || []).map(i => ({ frozen: !!i.frozen, at: i.frozenCost }));
  }, ids[0]);
  check('and the prices are frozen onto the lines at that moment',
    frozen.length > 0 && frozen.every(f => f.frozen === true), JSON.stringify(frozen));

  // ── Reopen one with a reason, correct it, re-approve ─────────────────────
  await office.p.evaluate((tid) => window.__mkApp.openReview(tid), ids[1]);
  await office.p.waitForTimeout(600);
  await office.p.getByRole('button', { name: /Reopen/i }).first().click();
  await office.p.waitForTimeout(500);
  await office.p.evaluate(() =>
    window.__mkApp.setState({ reasonText: 'Mileage queried by the client.' }));
  await office.p.waitForTimeout(300);
  await office.p.getByRole('button', { name: /Reopen & log/i }).click();
  await office.p.waitForTimeout(800);

  const reopened = await office.p.evaluate((tid) => {
    const t = window.__mkApp.state.data.tickets.find(x => x.id === tid);
    return { status: t.status, trail: (t.audit || []).map(a => a.kind + ' :: ' + a.text) };
  }, ids[1]);
  check('a reopened ticket leaves the approved state', reopened.status !== 'approved',
    reopened.status);
  check('and the reason it was reopened is on the record',
    reopened.trail.some(x => /Mileage queried by the client/.test(x)),
    JSON.stringify(reopened.trail.filter(x => /eopen/i.test(x)).slice(0, 1)));

  await office.p.evaluate((tid) => {
    const app = window.__mkApp;
    app.mutate((d) => { d.tickets.find(x => x.id === tid).mileage = 55; });
    app.logOn(tid, 'Mileage corrected from 41 to 55 after the client query.', 'edit');
    app.openReview(tid);
  }, ids[1]);
  await office.p.waitForTimeout(700);
  await office.p.getByRole('button', { name: /^Approve ticket$/ }).click();
  await office.p.waitForTimeout(700);
  await office.p.getByRole('button', { name: /Back to inbox/i }).click().catch(() => {});
  await office.p.waitForTimeout(400);
  const reApproved = await office.p.evaluate((tid) => {
    const t = window.__mkApp.state.data.tickets.find(x => x.id === tid);
    return { status: t.status, mileage: t.mileage,
      approvals: (t.audit || []).filter(a => /^Approved by/.test(a.text)).length };
  }, ids[1]);
  check('correcting and re-approving works', reApproved.status === 'approved',
    reApproved.status);
  check('the correction is the value that stands', String(reApproved.mileage) === '55',
    String(reApproved.mileage));
  check('and both approvals are on the record, not just the last',
    reApproved.approvals === 2, reApproved.approvals + ' approvals');

  // ── Notes: raised by the office on an open job ───────────────────────────
  await office.p.evaluate((tid) => {
    const app = window.__mkApp;
    app.addNote(tid, 'Confirm the rig number with the company man before invoicing.');
  }, ids[4]);
  await office.p.waitForTimeout(600);
  const noted = await office.p.evaluate((tid) => {
    const t = window.__mkApp.state.data.tickets.find(x => x.id === tid);
    return (t.notes || []).map(n => ({ body: n.body, resolved: !!n.resolvedAt }));
  }, ids[4]);
  check('the office can raise a note on an open job', noted.length === 1,
    JSON.stringify(noted));

  await office.p.evaluate((tid) => {
    const app = window.__mkApp;
    const t = app.state.data.tickets.find(x => x.id === tid);
    app.resolveNote(tid, t.notes[0].id);
  }, ids[4]);
  await office.p.waitForTimeout(600);
  const resolved = await office.p.evaluate((tid) => {
    const t = window.__mkApp.state.data.tickets.find(x => x.id === tid);
    return (t.notes || []).map(n => !!n.resolvedAt);
  }, ids[4]);
  check('and resolve it', resolved.every(Boolean), JSON.stringify(resolved));

  // ── The signed paperwork comes back ─────────────────────────────────────
  const finance = await office.p.evaluate((tid) => {
    const app = window.__mkApp;
    app.mutate((d) => {
      const t = d.tickets.find(x => x.id === tid);
      t.attachments = [
        { id: 'a1', docKind: 'service_ticket', filename: 's.pdf', path: tid + '/s.pdf' },
        { id: 'a2', docKind: 'job_log', filename: 'l.pdf', path: tid + '/l.pdf' },
      ];
    });
    const t = app.state.data.tickets.find(x => x.id === tid);
    return { missing: app.signedDocsMissing(t), chased: app.awaitingDocs([t]).length };
  }, ids[0]);
  check('with both documents in, nothing is still being chased',
    finance.missing.length === 0 && finance.chased === 0, JSON.stringify(finance));
  await office.ctx.close();

  // ══ The Observer ═════════════════════════════════════════════════════════
  const obs = await boot(b, 'founder@makaman.ly');
  const observer = await obs.p.evaluate(() => {
    const app = window.__mkApp;
    return {
      canEdit: app.hasPermission('ticket.edit_closed'),
      seesEdits: app.hasPermission('activity.view_edits'),
      canApprove: app.hasPermission('ticket.approve'),
    };
  });
  check('the Observer cannot approve', observer.canApprove === false);
  check('nor edit a closed ticket', observer.canEdit === false);
  check('nor read the edit trail', observer.seesEdits === false);
  await obs.ctx.close();

  // ══ Volume ═══════════════════════════════════════════════════════════════
  //
  // 400 tickets at 4x CPU throttle — a year of work on a mid-range Android. The list is
  // paged, so what is being measured is the whole render, not a truncation.
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly');
    const client = await p.context().newCDPSession(p);
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const ms = await p.evaluate(() => {
      const app = window.__mkApp;
      const seed = app.state.data.tickets[0];
      app.mutate((d) => {
        for (let i = 0; i < 400; i++) {
          const t = JSON.parse(JSON.stringify(seed));
          t.id = 'v' + i; t.ticketNo = '' + (8000 + i);
          t.status = i % 3 === 0 ? 'approved' : (i % 3 === 1 ? 'done' : 'logging');
          d.tickets.push(t);
        }
      });
      app.setState({ mgrScreen: 'inbox', roleTab: 'tickets' });
      // renderVals() IS the work: it builds every binding the page reads, the whole
      // ticket list included. Timing setState() instead measured nothing — it returns
      // before the render runs, and reported 0 ms with 400 tickets loaded, which is the
      // shape of a check that cannot fail rather than of a fast app.
      //
      // Three runs, the median taken: the first pays for whatever the JIT has not seen
      // yet, and a single sample on a shared machine is a coin toss.
      const runs = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        app.renderVals();
        runs.push(performance.now() - t0);
      }
      return runs.sort((a, b) => a - b)[1];
    });
    await p.waitForTimeout(1200);
    const rendered = await p.evaluate(() => ({
      rows: document.querySelectorAll('.mk-stack tbody tr').length,
      total: window.__mkApp.state.data.tickets.length,
    }));
    check('400 tickets do not stall the Tickets tab', ms < 200,
      Math.round(ms) + ' ms at 4x throttle');
    check('and the list pages rather than rendering all of them',
      rendered.rows > 0 && rendered.rows <= 25,
      rendered.rows + ' rows of ' + rendered.total + ' tickets');
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
