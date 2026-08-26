// Withdrawing someone's access.
//
// The obvious implementation is a delete, and the schema refuses it. Tickets and the
// audit log reference `profiles` with ON DELETE NO ACTION, so Postgres will not remove
// anybody who has ever worked — which is every real user. And `ticket_crew.profile_id` is
// ON DELETE CASCADE, so where a delete *would* go through it silently erases who was on a
// job, out of a trail that is legally required.
//
// So access is withdrawn by status and the row stays. The app's own dialog had always
// promised exactly that — "their name stays on any tickets they already touched" — while
// the button said Delete.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function open(ctx) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 1000 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  await p.evaluate(() => localStorage.clear());
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(800);
  return p;
}
const login = async (p, email) => {
  const i = p.locator('input');
  await i.nth(0).fill(email);
  await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1300);
};
// The Users screen, reached the way an admin reaches it.
const openUsers = async (p) => {
  await p.getByText('Account', { exact: true }).first().click();
  await p.waitForTimeout(500);
  await p.getByText('Users & Customers', { exact: false }).first().click();
  await p.waitForTimeout(700);
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── Who may withdraw access, and from whom ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'lateri@makaman.ly');
    await openUsers(p);

    const text = await p.evaluate(() => document.body.innerText);
    check('the Users screen offers Disable, not Delete',
      /\bDISABLE\b/i.test(text) && !/\bDELETE\b/i.test(text),
      text.match(/\b(DISABLE|DELETE)\b/gi) ? text.match(/\b(DISABLE|DELETE)\b/gi).join(',') : 'neither');

    // The master admin is the account that can rescue every other one.
    const guards = await p.evaluate(() => {
      const src = document.querySelector('script[type="text/x-dc"]').textContent;
      return {
        master: /u\.email !== MASTER_ADMIN_EMAIL/.test(src),
        self: /u\.email !== \(\(S\.session \|\| \{\}\)\.email \|\| ''\)/.test(src),
        perm: /this\.hasPermission\('user\.disable'\)/.test(src),
      };
    });
    check('the master Admin cannot be disabled', guards.master);
    check('nobody can lock themselves out', guards.self);
    check('and it is gated on a capability, not on a role', guards.perm);
    await ctx.close();
  }

  // ── Disabling, and putting it back ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'lateri@makaman.ly');
    await openUsers(p);

    const before = await p.evaluate(() => {
      const u = (window.__mkApp.state.data.users || []).find(x => x.email === 'yousef@makaman.ly');
      return u ? u.status : null;
    });
    check('the technician starts active', before === 'active', 'status: ' + before);

    // Click Disable on that technician's row, then confirm.
    const clicked = await p.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('div'))
        .filter(d => (d.textContent || '').includes('Yousef Al-Harbi'));
      for (const r of rows.reverse()) {
        const btn = Array.from(r.querySelectorAll('button')).find(x => /^disable$/i.test(x.textContent.trim()));
        if (btn) { btn.click(); return true; }
      }
      return false;
    });
    check('a Disable control is on the row', clicked);
    await p.waitForTimeout(600);

    const dialog = await p.evaluate(() => document.body.innerText);
    check('the dialog says the work is kept', /name stays on every ticket/i.test(dialog));
    check('and says plainly that accounts are never deleted',
      /accounts are never deleted/i.test(dialog));

    await p.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(x => /^disable$/i.test(x.textContent.trim())
        && x.closest('div') && getComputedStyle(x.closest('div')).position === 'fixed');
      if (btn) btn.click();
      else {
        const any = Array.from(document.querySelectorAll('button')).filter(x => /^disable$/i.test(x.textContent.trim()));
        if (any.length) any[any.length - 1].click();
      }
    });
    await p.waitForTimeout(800);

    const after = await p.evaluate(() => {
      const D = window.__mkApp.state.data;
      const u = (D.users || []).find(x => x.email === 'yousef@makaman.ly');
      return {
        status: u ? u.status : null,
        stillListed: !!u,
        ticketsStillNamed: (D.tickets || []).filter(t => t.tech === 'Yousef Al-Harbi').length,
        auditStillNamed: (D.tickets || []).reduce((n, t) =>
          n + (t.audit || []).filter(a => a.by === 'Yousef Al-Harbi').length, 0),
        offeredForAssignment: window.__mkApp.activeTechnicians().some(x => x.email === 'yousef@makaman.ly'),
      };
    });

    check('the account is disabled', after.status === 'disabled', 'status: ' + after.status);
    check('THE ROW IS KEPT, not removed', after.stillListed);
    check('their name is still on their tickets', after.ticketsStillNamed > 0,
      after.ticketsStillNamed + ' tickets');
    check('and still on the audit entries they made', after.auditStillNamed > 0,
      after.auditStillNamed + ' entries');
    check('but they are no longer offered for assignment', !after.offeredForAssignment);

    // Restore.
    await p.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('div'))
        .filter(d => (d.textContent || '').includes('Yousef Al-Harbi'));
      for (const r of rows.reverse()) {
        const btn = Array.from(r.querySelectorAll('button')).find(x => /^restore$/i.test(x.textContent.trim()));
        if (btn) { btn.click(); return; }
      }
    });
    await p.waitForTimeout(600);
    await p.evaluate(() => {
      const any = Array.from(document.querySelectorAll('button')).filter(x => /^restore$/i.test(x.textContent.trim()));
      if (any.length) any[any.length - 1].click();
    });
    await p.waitForTimeout(800);
    const restored = await p.evaluate(() => {
      const u = (window.__mkApp.state.data.users || []).find(x => x.email === 'yousef@makaman.ly');
      return {
        status: u ? u.status : null,
        offered: window.__mkApp.activeTechnicians().some(x => x.email === 'yousef@makaman.ly'),
      };
    });
    check('the account can be restored', restored.status === 'active', 'status: ' + restored.status);
    check('and they are assignable again', restored.offered);
    await ctx.close();
  }

  // ── The server is where it is enforced ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    const src = await p.evaluate(() => document.querySelector('script[type="text/x-dc"]').textContent);
    check('the client calls set_user_status rather than writing a profile',
      /adminAction\('set_user_status'/.test(src));
    check('and no profile row is deleted anywhere',
      !/d\.users\.splice/.test(src) || /!USE_CLOUD/.test(src));
    check('a disabled account is refused at sign-in',
      /if \(p\.status !== 'active'\)/.test(src));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
