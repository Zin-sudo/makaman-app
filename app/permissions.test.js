// The permission registry, driven through the real UI.
//
// The point of the registry is that a role is a shorthand for a set of capabilities, and
// the shorthand runs out the moment one person needs an exception. So the assertions
// that matter are: the screen lists what someone may do, a toggle writes an exception
// that actually changes the answer, toggling back to the role's own answer removes the
// exception rather than storing a redundant one, and hasPermission() reads the result.
//
// Runs on authMode 'local' like the other behaviour suites: this is about what the
// screens do. The database half is verified separately against the live project.
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
  await p.waitForTimeout(1200);
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── The catalogue exists and is coherent ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    const cat = await p.evaluate(() => {
      const s = document.querySelector('script[type="text/x-dc"]').textContent;
      // Re-evaluate the two constants in isolation. They are pure data derived from one
      // another, so this tests the real definitions rather than a transcription.
      const grab = (name) => {
        const at = s.indexOf('const ' + name + ' = (function');
        let d = 0, started = false;
        for (let j = at; j < s.length; j++) {
          if (s[j] === '(') { d++; started = true; }
          else if (s[j] === ')') { d--; if (started && !d) return s.slice(at, s.indexOf(';', j) + 1); }
        }
        return null;
      };
      const fn = new Function('ROLE_TO_DB', `
        ${grab('PERMISSION_DEFAULTS')}
        ${grab('PERMISSION_CATALOGUE_DEMO')}
        return { defs: PERMISSION_DEFAULTS, cat: PERMISSION_CATALOGUE_DEMO };
      `)({ tech: 'technician', mgr: 'ops_manager', admin: 'admin', founder: 'founder' });
      return {
        n: Object.keys(fn.defs).length,
        catN: fn.cat.length,
        adminOnly: Object.keys(fn.defs).filter(k => fn.defs[k].length === 1 && fn.defs[k][0] === 'admin'),
        techHas: Object.keys(fn.defs).filter(k => fn.defs[k].indexOf('tech') >= 0),
        viewAll: fn.defs['activity.view_all'],
        viewEdits: fn.defs['activity.view_edits'],
        levels: fn.cat.reduce((a, r) => { a[r.level] = (a[r.level] || 0) + 1; return a; }, {}),
        categories: Array.from(new Set(fn.cat.map(r => r.category))).sort(),
        rolesAreDbSpelling: fn.cat.every(r => r.defaultRoles.every(x => ['technician','ops_manager','admin','founder'].indexOf(x) >= 0)),
      };
    });
    // Deliberately not a magic number — the registry grows. What must hold is that it is
    // populated and that the two sides of it agree.
    check('the registry is populated', cat.n >= 30, 'got ' + cat.n);
    // The lesson from converting the activity gates: two capabilities that differ for
    // any one role must be two keys. Seeing every ticket's stages and seeing the edit
    // trail differ for the Observer, so they cannot share a row.
    check('seeing all activity and seeing edits are separate capabilities',
      cat.techHas.indexOf('activity.view_all') < 0
      && JSON.stringify(cat.viewAll) !== JSON.stringify(cat.viewEdits),
      'view_all: ' + (cat.viewAll || []).join('+') + '  view_edits: ' + (cat.viewEdits || []).join('+'));
    check('the Observer reads the work but not the edit trail',
      (cat.viewAll || []).indexOf('founder') >= 0 && (cat.viewEdits || []).indexOf('founder') < 0,
      'view_edits: ' + (cat.viewEdits || []).join('+'));
    check('the demo catalogue covers all of them', cat.catN === cat.n, cat.catN + ' vs ' + cat.n);
    // Not a count. The registry grows — note.add made this 7 the day it landed — and a
    // magic number turns every intended addition into a failure that says nothing about
    // what changed. What must hold is that a technician's set is routine work and nothing
    // that settles money or people.
    {
      const privileged = ['ticket.approve', 'ticket.charge_items', 'user.change_role',
        'user.manage_permissions', 'pricelist.edit', 'note.resolve'];
      const overreach = cat.techHas.filter(k => privileged.indexOf(k) >= 0);
      check('a technician holds only routine work', overreach.length === 0,
        overreach.length ? 'holds: ' + overreach.join(', ') : cat.techHas.join(', '));
    }
    check('changing a role and managing permissions are admin-only',
      cat.adminOnly.indexOf('user.change_role') >= 0 && cat.adminOnly.indexOf('user.manage_permissions') >= 0,
      cat.adminOnly.join(', '));
    check('every level is represented', Object.keys(cat.levels).length === 3, JSON.stringify(cat.levels));
    check('the catalogue speaks the database spelling of roles', cat.rolesAreDbSpelling);
    check('capabilities are grouped, not one flat list', cat.categories.length >= 4, cat.categories.join(', '));
    await ctx.close();
  }

  // ── The screen renders, and only for an admin ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'lateri@makaman.ly');
    await p.getByText('Account', { exact: true }).first().click();
    await p.waitForTimeout(600);
    const tileThere = await p.evaluate(() => /Permissions/.test(document.body.innerText));
    check('Admin sees a Permissions tile in Account', tileThere);

    await p.getByText('Permissions', { exact: false }).first().click();
    await p.waitForTimeout(700);
    const before = await p.evaluate(() => document.body.innerText);
    check('the screen opens and asks you to choose someone', /Choose someone to see what they may do/i.test(before));

    // Pick a technician and read their capabilities.
    await p.getByText('Yousef Al-Harbi', { exact: false }).first().click();
    await p.waitForTimeout(600);
    const picked = await p.evaluate(() => document.body.innerText);
    check('choosing a person shows their role', /Field Technician/.test(picked));
    check('they start with no exceptions', /0 exceptions to their role/.test(picked),
      (picked.match(/\d+ exceptions? to their role/) || ['?'])[0]);
    check('a capability their role does not carry reads No',
      /APPROVE A TICKET|Approve a ticket|Approve/i.test(picked));
    await ctx.close();
  }

  // ── A toggle writes an exception, and toggling back removes it ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'lateri@makaman.ly');
    await p.getByText('Account', { exact: true }).first().click();
    await p.waitForTimeout(500);
    await p.getByText('Permissions', { exact: false }).first().click();
    await p.waitForTimeout(600);
    await p.getByText('Yousef Al-Harbi', { exact: false }).first().click();
    await p.waitForTimeout(600);

    // Click the button belonging to one named capability. Grabbing the first No or Yes
    // on the page picks whichever row happens to sort first — which is how an earlier
    // version of this test toggled `report.generate` and then blamed the app.
    const clickRow = (label) => p.evaluate((want) => {
      const rows = Array.from(document.querySelectorAll('div'))
        .filter(d => d.querySelector(':scope > button')
          && (d.querySelector(':scope > div > div') || {}).textContent === want);
      if (!rows.length) return null;
      const row = rows[0];
      const btn = row.querySelector(':scope > button');
      const was = btn.textContent.trim();
      btn.click();
      return was;
    }, label);

    const granted = await clickRow('Approve');
    await p.waitForTimeout(700);
    const after = await p.evaluate(() => document.body.innerText);
    check('granting writes one exception', /1 exception to their role/.test(after),
      'toggled: ' + granted + ' | ' + (after.match(/\d+ exceptions? to their role/) || ['?'])[0]);
    check('the exception says which way it goes', /Granted — their role would not/.test(after));

    // The store is the record. Read it rather than trusting the label.
    const stored = await p.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || '{}');
      return d.permissionOverrides || {};
    });
    check('the override is persisted, keyed by person and capability',
      Object.keys(stored).length === 1 && Object.keys(stored)[0].indexOf('|') > 0,
      JSON.stringify(stored));

    // Toggle the same row back. The role already says no, so the row should be deleted,
    // not stored as a redundant false.
    const wasYes = await clickRow('Approve');
    check('the granted row is now showing Yes', wasYes === 'Yes', 'button read: ' + wasYes);
    await p.waitForTimeout(700);
    const back = await p.evaluate(() => ({
      text: document.body.innerText,
      stored: JSON.parse(localStorage.getItem('makaman.jobtickets.v2') || '{}').permissionOverrides || {},
    }));
    check('toggling back to the role default removes the exception',
      Object.keys(back.stored).length === 0, JSON.stringify(back.stored));
    check('and the count returns to zero', /0 exceptions to their role/.test(back.text),
      (back.text.match(/\d+ exceptions? to their role/) || ['?'])[0]);
    await ctx.close();
  }

  // ── A granted override actually changes what Account offers, not just what
  //    hasPermission() answers ──
  // 2026-09-04, reported live: an admin granted an ops manager `paperwork_email.manage`
  // and "the option did not exist" on that account afterward. The database side was
  // correct — hasPermission() read the override fine — but the Paperwork Email tile was
  // built inside the admin-only branch of accountTiles, a hardcoded role check no
  // override could ever reach. This drives the exact reported scenario end to end: grant
  // it, sign in as the person, see the tile; revoke it, sign in again, the tile is gone.
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'lateri@makaman.ly');
    await p.getByText('Account', { exact: true }).first().click();
    await p.waitForTimeout(500);
    await p.getByText('Permissions', { exact: false }).first().click();
    await p.waitForTimeout(600);
    await p.getByText('Omar Al-Saleh', { exact: false }).first().click();
    await p.waitForTimeout(600);

    // paperwork_email.manage has no prose in the demo catalogue (it is generated from
    // PERMISSION_DEFAULTS, not written out by hand — see the comment above that table),
    // so its row's description falls back to the id itself, which is what's unique to
    // match on: several other capabilities share its generated name, "Manage".
    const clickByDesc = (desc) => p.evaluate((want) => {
      const row = Array.from(document.querySelectorAll('div'))
        .find(d => d.querySelector(':scope > button')
          && (d.querySelector(':scope > div > div:nth-child(2)') || {}).textContent === want);
      if (!row) return null;
      const btn = row.querySelector(':scope > button');
      const was = btn.textContent.trim();
      btn.click();
      return was;
    }, desc);

    const before = await clickByDesc('paperwork_email.manage');
    check('Omar (ops manager) starts without the override', before === 'No', 'read: ' + before);
    await p.waitForTimeout(700);

    const logout = async () => {
      await p.getByRole('button', { name: /^Account$/i }).last().click();
      await p.waitForTimeout(400);
      await p.getByRole('button', { name: /^Log out$/ }).first().click();
      await p.waitForTimeout(600);
    };
    const loggedInAs = async (email) => {
      await logout();
      await login(p, email);
      await p.getByText('Account', { exact: true }).first().click();
      await p.waitForTimeout(500);
      return p.evaluate(() => document.body.innerText);
    };

    const grantedView = await loggedInAs('omar@makaman.ly');
    check('granted: Omar\'s own Account tab now offers Paperwork Email',
      /Paperwork Email/.test(grantedView));

    // Revoke it and confirm the tile leaves exactly as reliably as it arrived.
    await logout();
    await login(p, 'lateri@makaman.ly');
    await p.getByText('Account', { exact: true }).first().click();
    await p.waitForTimeout(500);
    await p.getByText('Permissions', { exact: false }).first().click();
    await p.waitForTimeout(600);
    await p.getByText('Omar Al-Saleh', { exact: false }).first().click();
    await p.waitForTimeout(600);
    const wasYes = await clickByDesc('paperwork_email.manage');
    check('the row read Yes just before revoking', wasYes === 'Yes', 'read: ' + wasYes);
    await p.waitForTimeout(700);

    const revokedView = await loggedInAs('omar@makaman.ly');
    check('revoked: the tile is gone again, not left behind once granted',
      !/Paperwork Email/.test(revokedView));
    await ctx.close();
  }

  // ── hasPermission reads the registry, not the role ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    const src = await p.evaluate(() => document.querySelector('script[type="text/x-dc"]').textContent);
    check('hasPermission exists as one shared helper', /hasPermission\(key\)\s*\{/.test(src));
    check('it prefers the hydrated map over the role defaults',
      src.indexOf('myPermissions') < src.indexOf('PERMISSION_DEFAULTS[key]'));
    check('an unknown capability is refused, not allowed',
      /return !!roles && roles\.indexOf\(this\.state\.role\) >= 0;/.test(src));
    check('the permissions screen gates itself through hasPermission',
      /permCannotEdit: !this\.hasPermission\('user\.manage_permissions'\)/.test(src));
    // The bug this exists for: export.master was added to the database and to a gate,
    // and not to PERMISSION_DEFAULTS. hasPermission() then answered false for everyone
    // offline and in the demo store, and the whole tile silently never rendered. Every
    // key the app asks for must be a key the offline fallback knows.
    {
      const asked = Array.from(new Set(
        (src.match(/hasPermission\('([a-z_]+\.[a-z_]+)'\)/g) || [])
          .map(m => m.replace(/.*'([^']+)'.*/, '$1'))));
      const defs = src.slice(src.indexOf('const PERMISSION_DEFAULTS'), src.indexOf('const PERMISSION_CATALOGUE_DEMO'));
      const missing = asked.filter(k => defs.indexOf("'" + k + "'") < 0);
      check('every capability the app asks for is one the offline defaults know',
        missing.length === 0,
        missing.length ? 'missing: ' + missing.join(', ') : asked.length + ' keys asked for');
    }
    check('hydrate pulls the catalogue and the caller\'s own answer',
      /all\('permissions'\), c\.rpc\('my_permissions'\)/.test(src));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
