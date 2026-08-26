// Approving a signup, and the queue that used to swallow it.
//
// The bug this pins down: `profiles` grants a signed-in client SELECT and nothing else,
// so the approval — written into the replica and pushed through the ordinary outbox —
// was refused by the database every time. The refusal sat at the head of the queue and
// blocked every later write, and the next refresh read the old row back, so the account
// reverted to pending. Both halves are asserted here: profile rows must never enter the
// queue, and a permanently-refused op must not freeze the ops behind it.
//
// Harness notes carried from the other suites: newPage() shares storage with its context
// (newContext() is what isolates), the store is not persisted until the first mutation,
// and input *values* never appear in innerText.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function open(ctx, cfg) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 900 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  if (cfg) await p.addInitScript((c) => { window.MAKAMAN_CONFIG = c; }, cfg);
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  return p;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── 1. The source read: profiles is not a table the outbox knows how to send ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx, { authMode: 'local' });
    const src = await p.evaluate(() => document.querySelector('script[type="text/x-dc"]').textContent);

    const pairs = src.slice(src.indexOf('const pairs = ['), src.indexOf('const pairs = [') + 400);
    check('the outbox pair list no longer carries profiles', !pairs.includes("'profiles'"),
      pairs.includes("'profiles'") ? 'still queues profile rows' : '');
    check('clients are still queued the ordinary way', pairs.includes("'clients'"));
    check('an adminAction helper exists to reach the Edge Function', /function adminAction\(/.test(src));
    check('it invokes admin-actions', /functions\.invoke\('admin-actions'/.test(src));
    check('approving calls approve_signup', /adminAction\('approve_signup'/.test(src));
    check('promoting calls promote_role', /adminAction\('promote_role'/.test(src));
    check('creating an account calls create_technician', /adminAction\('create_technician'/.test(src));
    await ctx.close();
  }

  // ── 2. The queue survives an op the server will never accept ──
  // Driven against the real outboxDrain by handing it a client whose every write fails,
  // which is what an RLS refusal looks like from here.
  {
    const ctx = await b.newContext();
    const p = await open(ctx, { authMode: 'local' });
    const out = await p.evaluate(async () => {
      const win = window;
      // Reach the module scope the app runs in by re-evaluating the two functions under
      // test with a stub client — the page keeps them private, and copying them would
      // test the copy rather than the app.
      const src = document.querySelector('script[type="text/x-dc"]').textContent;
      const grab = (name) => {
        const at = src.indexOf('function ' + name + '(');
        if (at < 0) return null;
        let d = 0, i = src.indexOf('{', at);
        for (let j = i; j < src.length; j++) {
          if (src[j] === '{') d++;
          else if (src[j] === '}') { d--; if (!d) return src.slice(at, j + 1); }
        }
        return null;
      };
      const parts = ['outboxRead', 'outboxWrite', 'outboxPush', 'outboxSend', 'outboxSetAside', 'outboxDrain']
        .map(grab).filter(Boolean).join('\n');
      const OUTBOX_K = 'makaman.outbox.v1', DEADLETTER_K = 'makaman.outbox.refused.v1';
      localStorage.setItem(OUTBOX_K, JSON.stringify([
        { key: 'poison', table: 'profiles', action: 'upsert', row: { id: 'x' } },
        { key: 'good', table: 'clients', action: 'upsert', row: { id: 'y' } },
      ]));
      let goodSent = 0;
      const stub = {
        from: (t) => ({
          upsert: () => Promise.resolve(
            t === 'profiles'
              ? { error: { message: 'new row violates row-level security policy' } }
              : (goodSent++, { error: null })),
        }),
      };
      const fn = new Function('OUTBOX_K', 'DEADLETTER_K', 'OUTBOX_TRIES', 'sb', `
        ${parts}
        return outboxDrain;
      `)(OUTBOX_K, DEADLETTER_K, 5, () => stub);

      const runs = [];
      for (let i = 0; i < 6; i++) runs.push(await fn());
      return {
        runs: runs,
        goodSent: goodSent,
        left: JSON.parse(localStorage.getItem(OUTBOX_K) || '[]').length,
        refused: JSON.parse(localStorage.getItem(DEADLETTER_K) || '[]').map(d => d.op.table),
      };
    });

    check('the refused op holds its place while it is still worth retrying', out.runs[0] === 0,
      'first drain sent ' + out.runs[0]);
    check('the write behind it eventually gets through', out.goodSent === 1,
      'clients upserts that succeeded: ' + out.goodSent);
    check('the queue drains empty instead of jamming', out.left === 0, 'left: ' + out.left);
    check('the refusal is kept, not discarded silently', out.refused.join(',') === 'profiles',
      'set aside: ' + JSON.stringify(out.refused));
    await ctx.close();
  }

  // ── 3. The demo store still approves locally — the tests and offline mode need it ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx, { authMode: 'local' });
    const seeded = await p.evaluate(() => {
      const K = 'makaman.jobtickets.v2';
      const d = JSON.parse(localStorage.getItem(K) || 'null');
      return !!d;
    });
    // The store is not written until the first mutation, so sign in to force it.
    const i = p.locator('input');
    await i.nth(0).fill('lateri@makaman.ly');
    await i.nth(1).fill('makaman2026');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(1200);
    const loggedIn = await p.evaluate(() => !/log in/i.test(document.body.innerText.slice(0, 400)));
    check('admin can still sign in to the demo store', loggedIn, 'seeded-before-login: ' + seeded);
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
