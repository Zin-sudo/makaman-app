// Real authentication against the live project. Separate from the behaviour suites,
// which deliberately pin authMode to 'local': those are about what the screens do, this
// is about who is allowed through the door.
//
// Needs a network. Creates a throwaway account each run and cleans up after itself.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };
const STAMP = Date.now();
const EMAIL = `probe.${STAMP}@makaman.test`;
const PASS = 'Probe-' + STAMP + '!';

async function open(ctx, mode) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 430, height: 940 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  if (mode) await p.addInitScript((m) => { window.MAKAMAN_CONFIG = { authMode: m }; }, mode);
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(900);
  return p;
}
const login = async (p, email, pw) => {
  const i = p.locator('input');
  await i.nth(0).fill(email); await i.nth(1).fill(pw);
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(2500);
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 940 } });

  // ── the stub is gone: a wrong password is refused, locally too ───────────
  let p = await open(ctx, 'local');
  await login(p, 'yousef@makaman.ly', 'whatever');
  let body = await p.innerText('body');
  check('a wrong password is refused even in demo mode', /not correct/i.test(body),
    (body.split('\n').find(l => /correct|Signed in/i.test(l)) || '').trim());
  check('and the app is still on the login screen', /log in/i.test(body) && !/My Tickets|Ticket Inbox/i.test(body));
  await login(p, 'yousef@makaman.ly', 'makaman2026');
  check('the right password gets in', /Northern Gulf|My Tickets|On this device/i.test(await p.innerText('body')));
  await p.close();

  // ── the cloud path, against a stubbed client ────────────────────────────
  // The sandbox blocks egress to the project (403 on CONNECT), so the live server cannot
  // be reached from here. What can still be checked is the part that is mine: what the
  // app decides given each answer the server can give. The stub returns exactly what
  // supabase-js would.
  // Service workers are blocked in this context on purpose. sw.js answers every
  // same-origin GET by calling fetch() itself, and a fetch made by a worker never reaches
  // page.route — so with the worker alive the page quietly loaded the REAL client,
  // pointed it at a hostname that does not exist, and reported the resulting network
  // failure as a rejected credential. The stub only takes hold once the worker is out of
  // the way.
  const stubCtx = await browser.newContext({ viewport: { width: 430, height: 940 }, serviceWorkers: 'block' });
  const withStub = async (behaviour) => {
    const pg = await stubCtx.newPage();
    pg.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    // The stub has to REPLACE the vendored client, not precede it: a global assigned in
    // an init script is overwritten the moment the real library loads. Serving the stub
    // in place of the file is the only version of this that actually holds.
    await pg.route('**/vendor/supabase.umd.js', route => route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `window.supabase = {
        createClient: function () {
          var b = ${JSON.stringify(behaviour)};
          return {
            auth: {
              signInWithPassword: function () {
                return Promise.resolve(b.signInFails
                  ? { error: { message: 'Invalid login credentials' } }
                  : { data: { user: { id: 'stub-user' } }, error: null });
              },
              signOut: function () { return Promise.resolve({ error: null }); },
              signUp: function () { return Promise.resolve({ data: {}, error: null }); },
            },
            from: function () {
              return { select: function () { return { eq: function () { return { single: function () {
                return Promise.resolve(b.noProfile
                  ? { data: null, error: { message: 'no rows' } }
                  : { data: { email: 'stub@makaman.ly', full_name: 'Stub Person', role: b.role, status: b.status }, error: null });
              } }; } }; } };
            },
          };
        },
      };`,
    }));
    await pg.addInitScript(() => {
      window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' };
    });
    await pg.goto(URL, { waitUntil: 'networkidle' });
    await pg.waitForTimeout(300);
    await pg.evaluate(() => localStorage.clear());
    await pg.reload({ waitUntil: 'networkidle' });
    await pg.waitForTimeout(800);
    return pg;
  };

  let q = await withStub({ signInFails: true });
  await login(q, 'someone@makaman.ly', 'wrong');
  check('cloud: a rejected credential says so without saying which part',
    /not correct/i.test(await q.innerText('body')));
  await q.close();

  q = await withStub({ role: 'technician', status: 'pending' });
  await login(q, 'newbie@makaman.ly', 'Correct-Horse-1!');
  body = await q.innerText('body');
  check('cloud: a correct password on a pending account still cannot get in',
    /waiting for an admin/i.test(body),
    (body.split('\n').find(l => /waiting|correct/i.test(l)) || '').trim());
  check('cloud: and it does not land on a signed-in screen',
    !/On this device|Ticket Inbox|Observer View/i.test(body));
  await q.close();

  q = await withStub({ role: 'technician', status: 'active' });
  await login(q, 'tech@makaman.ly', 'Correct-Horse-1!');
  check('cloud: an approved technician gets the technician app',
    /On this device|New Job Ticket/i.test(await q.innerText('body')));
  await q.close();

  q = await withStub({ role: 'ops_manager', status: 'active' });
  await login(q, 'ops@makaman.ly', 'Correct-Horse-1!');
  check("cloud: the database's ops_manager becomes the app's Ops Manager",
    /Ticket Inbox/i.test(await q.innerText('body')));
  await q.close();

  q = await withStub({ role: 'founder', status: 'active' });
  await login(q, 'obs@makaman.ly', 'Correct-Horse-1!');
  check("cloud: the database's founder becomes the Observer",
    /Observer View/i.test(await q.innerText('body')));
  await q.close();

  q = await withStub({ role: 'technician', status: 'active', noProfile: true });
  await login(q, 'ghost@makaman.ly', 'Correct-Horse-1!');
  check('cloud: an auth user with no profile row is refused rather than let in blank',
    /no profile yet/i.test(await q.innerText('body')));
  await q.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
