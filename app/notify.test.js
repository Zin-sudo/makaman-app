// Notifications.
//
// Built as a view over the audit trail rather than a table of its own. A notification is
// an audit entry you have not read yet, so the only thing stored is how far you have
// read — one timestamp. The alternative, a notifications table fanned out by a trigger,
// is a second copy of a truth that already exists, and two records of one fact drifting
// apart quietly is the failure this project keeps meeting.
//
// So the assertions are mostly about that: the count and the list cannot disagree, your
// own actions never notify you, reading is not deleting, and what you may be notified
// about is exactly what you may already read.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function signIn(ctx, email) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1180, height: 900 });
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
// By its title, never its position — the first button in the app bar is the role swap,
// and an early version of this test swapped the user's role instead of opening a panel.
const bell = (p) => p.locator('.mk-appbar button[title]').filter({ hasText: '◉' }).first();

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── The count is the list ──
  {
    const ctx = await b.newContext();
    const p = await signIn(ctx, 'omar@makaman.ly');
    const n = await p.evaluate(() => ({
      unread: window.__mkApp.unreadEntries().length,
      activity: window.__mkApp.activityEntries().length,
      badge: (Array.from(document.querySelectorAll('.mk-appbar button span'))
        .map(s => s.textContent.trim()).filter(t => /^\d+$/.test(t))[0]) || null,
    }));
    check('there is something unread to show', n.unread > 0, n.unread + ' of ' + n.activity);
    check('the badge shows exactly that number', String(n.unread) === n.badge,
      'badge ' + n.badge + ' vs ' + n.unread);

    await bell(p).click();
    await p.waitForTimeout(500);
    const shown = await p.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('button'))
        .filter(x => /·/.test(x.textContent) && x.querySelector('span > span'));
      return { heading: (document.body.innerText.match(/\d+ unread|Up to date/) || [])[0], rows: rows.length };
    });
    check('the panel opens and heads with the same number',
      shown.heading === n.unread + ' unread', JSON.stringify(shown.heading));
    check('and lists that many entries', shown.rows === n.unread, shown.rows + ' rows');
    await ctx.close();
  }

  // ── Nobody is told what they did themselves ──
  {
    const ctx = await b.newContext();
    const p = await signIn(ctx, 'omar@makaman.ly');
    const r = await p.evaluate(() => {
      const app = window.__mkApp;
      const me = (app.state.session || {}).name;
      const before = app.unreadEntries().length;
      const t = app.state.data.tickets[0];
      // An entry written by this person, right now.
      app.logOn(t.id, 'Something this user did themselves.', 'lifecycle');
      const mine = app.unreadEntries().length;
      // And one by somebody else, equally recent.
      app.mutate((d) => {
        const x = d.tickets.find(y => y.id === t.id);
        (x.audit = x.audit || []).push({ ts: new Date().toISOString(), kind: 'lifecycle',
          by: 'Someone Else', text: 'Something another person did.' });
      });
      return { me: me, before: before, afterMine: mine, afterTheirs: app.unreadEntries().length };
    });
    check('my own action does not notify me', r.afterMine === r.before,
      r.before + ' -> ' + r.afterMine);
    check('somebody else\'s does', r.afterTheirs === r.before + 1,
      r.afterMine + ' -> ' + r.afterTheirs);
    await ctx.close();
  }

  // ── Reading is not deleting ──
  {
    const ctx = await b.newContext();
    const p = await signIn(ctx, 'omar@makaman.ly');
    await bell(p).click();
    await p.waitForTimeout(400);
    const before = await p.evaluate(() => window.__mkApp.activityEntries().length);
    await p.getByRole('button', { name: /MARK ALL READ/i }).click();
    await p.waitForTimeout(700);
    const after = await p.evaluate(() => ({
      unread: window.__mkApp.unreadEntries().length,
      activity: window.__mkApp.activityEntries().length,
      readAt: (window.__mkApp.state.data.settings || {}).notificationsReadAt || '',
      badgeGone: !Array.from(document.querySelectorAll('.mk-appbar button span'))
        .some(s => /^\d+$/.test(s.textContent.trim())),
    }));
    check('marking read clears the unread count', after.unread === 0, String(after.unread));
    check('and the badge with it', after.badgeGone);
    check('a moment is recorded, not a deletion', /^\d{4}-/.test(after.readAt), after.readAt);
    check('the Activity tab still shows everything', after.activity === before,
      before + ' -> ' + after.activity);

    // The marker is a preference, so it rides the settings path that already works —
    // adding a field to `settings` with no column behind it is a refused write, and a
    // refused write jams the head of the outbox.
    const persisted = await p.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || '{}');
      return (d.settings || {}).notificationsReadAt || '';
    });
    check('and it is persisted with the other preferences', persisted === after.readAt);
    await ctx.close();
  }

  // ── You are only told about what you may already read ──
  //
  // The Observer reads job stages, not the edit trail (activity.view_edits). Since
  // notifications are a filter over the same reducer, that gate is inherited rather than
  // reimplemented — which is the point of there being one reducer.
  {
    const ctx = await b.newContext();
    const p = await signIn(ctx, 'founder@makaman.ly');
    const r = await p.evaluate(() => {
      const app = window.__mkApp;
      const t = app.state.data.tickets[0];
      app.mutate((d) => {
        const x = d.tickets.find(y => y.id === t.id);
        (x.audit = x.audit || []).push({ ts: new Date().toISOString(), kind: 'edit',
          by: 'Omar Al-Saleh', text: 'Changed a price after approval.' });
      });
      return {
        deep: app.hasPermission('activity.view_edits'),
        unreadKinds: Array.from(new Set(app.unreadEntries().map(a => a.kind))),
        sawTheEdit: app.unreadEntries().some(a => /Changed a price/.test(a.text)),
      };
    });
    check('the Observer does not hold the edit-trail capability', r.deep === false);
    check('and is not notified about an edit', !r.sawTheEdit,
      'kinds seen: ' + r.unreadKinds.join(','));
    check('while still being notified about job stages',
      r.unreadKinds.every(k => k === 'lifecycle'), r.unreadKinds.join(','));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
