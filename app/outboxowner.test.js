// Unsent work belongs to a person, not to a phone.
//
// The bug this pins down cost a week of numbering-claim handovers and was invisible from
// every angle the app could see. The outbox was ONE device-wide localStorage key that
// sign-out deliberately left alone. So: Lateri (admin) hands the claim to Abobaker, the op
// is queued, and then — to check it worked — he signs in as Abobaker on the same phone.
// That session drains the queue it inherited and sends Lateri's write AS ABOBAKER.
// `numbering_claim`'s insert policy is admin-only, so it is refused, five times, and
// dead-lettered. The server never moves, the next hydrate puts Lateri back on screen, and
// the app has no way to tell anyone what happened. Verified against the live database
// before this was written: the identical op is refused as Abobaker and accepted as Lateri.
//
// So the thing under test is not "does the queue drain". It is: whose work is it, and can
// anybody else's session touch it.
//
// Driven through ONE page — one shared localStorage, signing out and back in. Two browser
// contexts would each get their own storage and prove exactly nothing about a shared phone,
// which is the whole condition.
const { chromium } = require('playwright-core');
const { OPS, makeDB, STUB, assertStubParses } = require('./cloudstub.js');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

const ADMIN = '99999999-9999-4999-8999-999999999999';
const DB = makeDB();
DB.profiles.push({ id: ADMIN, email: 'lateri@makaman.ly', full_name: 'Lateri', role: 'admin', status: 'active' });
// Lateri holds the claim to begin with, exactly as the live row does.
DB.numbering_claim = [{ id: true, holder_id: ADMIN, since: '2026-08-31T23:03:53.000Z' }];
assertStubParses(DB);

const outbox = (p, email) => p.evaluate((who) => {
  const acct = who || ((window.__mkApp.state.session || {}).email || '');
  const key = 'makaman.outbox.v1' + (acct ? '.' + acct.toLowerCase() : '');
  return JSON.parse(localStorage.getItem(key) || '[]');
}, email || null);

const claimWrites = (p) => p.evaluate(() =>
  (window.__writes || []).filter(w => w.table === 'numbering_claim').length);

async function signIn(p, email) {
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill('x');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1700);
}
async function signOut(p) {
  await p.getByText('Account', { exact: true }).first().click();
  await p.waitForTimeout(600);
  await p.getByRole('button', { name: /^Log out$/ }).first().click();
  await p.waitForTimeout(800);
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1180, height: 950 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.route('**/vendor/supabase.umd.js', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: STUB(DB) }));
  await p.addInitScript(() => {
    window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
    window.__DRAIN_TEST_MS = 100;
  });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);

  // ── Lateri hands the claim on, with no signal ────────────────────────────
  //
  // Offline so the op is QUEUED and not sent — the real sequence, where somebody makes a
  // change and signs out before it has drained. Through mutate() rather than the dialog
  // because what is on trial is the queue, not the confirm button: this is the same
  // diffOps -> outboxPush -> outboxDrain path the handover takes.
  await signIn(p, 'lateri@makaman.ly');
  const staged = await p.evaluate((opsId) => {
    window.__offline = true;
    const app = window.__mkApp;
    const target = (app.state.data.users || []).find(u => u.id === opsId) || {};
    app.mutate((d) => {
      d.numbering = { holderEmail: target.email || '', holderName: target.name,
        since: new Date().toISOString(), history: [] };
    });
    return { to: target.email, mine: (app.state.session || {}).email };
  }, OPS);
  await p.waitForTimeout(900);

  const lateriQueue = await outbox(p);
  const claimOp = lateriQueue.find(o => o.key === 'numbering_claim');
  check('the handover is queued', !!claimOp, JSON.stringify(lateriQueue.map(o => o.key)));
  check("and filed under the account that made it", staged.mine === 'lateri@makaman.ly');
  check('carrying who queued it, so no session can send it unknowingly',
    !!claimOp && claimOp.acct === 'lateri@makaman.ly', JSON.stringify(claimOp && claimOp.acct));
  check('as an update, not an upsert — the insert policy is admin-only and is not the rule',
    !!claimOp && claimOp.action === 'update', JSON.stringify(claimOp && claimOp.action));

  // ── Abobaker signs in on the same phone. The signal is back. ─────────────
  //
  // This is the exact moment the claim used to die.
  await signOut(p);
  await p.evaluate(() => { window.__offline = false; window.__writes = []; });
  await signIn(p, 'omar@makaman.ly');
  await p.evaluate(() => window.__mkApp.refresh().catch(() => {}));
  await p.waitForTimeout(1200);

  check("the other account's session sends none of it",
    await claimWrites(p) === 0, (await claimWrites(p)) + ' numbering_claim writes');
  const stillThere = await outbox(p, 'lateri@makaman.ly');
  check('and the work is still there, not drained away and not destroyed',
    stillThere.some(o => o.key === 'numbering_claim'),
    JSON.stringify(stillThere.map(o => o.key)));
  const hisOwn = await outbox(p);
  check('his own queue is his own, and empty of it',
    !hisOwn.some(o => o.key === 'numbering_claim'), JSON.stringify(hisOwn.map(o => o.key)));

  // The belt-and-braces half: even planted directly into HIS queue, an op stamped with
  // somebody else's name is stepped over rather than sent — and left where it is, because
  // it is still somebody's unsent work.
  await p.evaluate(() => {
    const key = 'makaman.outbox.v1.omar@makaman.ly';
    const q = JSON.parse(localStorage.getItem(key) || '[]');
    q.push({ key: 'numbering_claim', table: 'numbering_claim', action: 'update', id: true,
      row: { holder_id: null }, seq: 9001, acct: 'lateri@makaman.ly' });
    localStorage.setItem(key, JSON.stringify(q));
  });
  await p.evaluate(() => window.__mkApp.refresh().catch(() => {}));
  await p.waitForTimeout(1200);
  check('an op stamped with another name is not sent even from his own queue',
    await claimWrites(p) === 0, (await claimWrites(p)) + ' numbering_claim writes');
  const planted = await outbox(p);
  check('and is left in place rather than quietly dropped',
    planted.some(o => o.seq === 9001), JSON.stringify(planted.map(o => o.seq)));

  // ── Lateri comes back ────────────────────────────────────────────────────
  await signOut(p);
  await p.evaluate(() => { window.__writes = []; });
  await signIn(p, 'lateri@makaman.ly');
  await p.evaluate(() => window.__mkApp.refresh().catch(() => {}));
  await p.waitForTimeout(1400);

  check('his own session sends it, at last', await claimWrites(p) > 0,
    (await claimWrites(p)) + ' numbering_claim writes');
  const drained = await outbox(p);
  check('and the queue lets it go once it is actually gone',
    !drained.some(o => o.key === 'numbering_claim'), JSON.stringify(drained.map(o => o.key)));
  const server = await p.evaluate(() => (window.__db.numbering_claim || [])[0] || {});
  check('the row the office reads has actually moved', server.holder_id === OPS,
    JSON.stringify(server.holder_id));

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await ctx.close();
  await b.close();
  process.exit(fail ? 1 : 0);
})();
