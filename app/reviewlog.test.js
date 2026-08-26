// The per-ticket log in the Review screen.
//
// The container was already there. What it did not do was matter more than what it did:
// it was ungated, and the Observer reaches this screen — showMgrPage lets them in at
// mgrScreen === 'review'. So the full edit history of every ticket was readable by the
// one role the Activity tab had just been taught to withhold it from. Same capability,
// second place, and fixing the first did nothing for this one (B-15.5).
//
// It also dropped `by`, which every entry has carried all along. "Ticket approved" with
// no name is the half of the record that does not settle an argument.
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

// Put a known pair of entries — one stage, one edit — on the seeded ticket, through the
// app's own state rather than through localStorage. The store is not written until the
// first mutation, so injecting into localStorage before one happens writes into nothing;
// window.__mkApp is the handle the other suites already use for exactly this reason.
const seedAudit = (p) => p.evaluate(() => {
  const app = window.__mkApp;
  const t = (app.state.data.tickets || []).find(x => x.status !== 'logging')
    || (app.state.data.tickets || [])[0];
  if (!t) return null;
  app.mutate(d => {
    const x = d.tickets.find(y => y.id === t.id);
    x.audit = [
      { ts: '2026-08-20T08:00:00.000Z', text: 'Job closed by the technician.', kind: 'lifecycle', by: 'Yousef Al-Harbi' },
      { ts: '2026-08-20T09:00:00.000Z', text: 'Mileage changed from 100 to 120.', kind: 'edit', by: 'Omar Al-Saleh' },
    ];
  });
  app.setState({ activeId: t.id, mgrScreen: 'review', roleTab: 'tickets' });
  return t.id;
});

// The panel, located by its own DOM node rather than by searching body text. The page
// says "written to the audit trail" in prose further up, so a text search finds that
// first and reads the ticket header as though it were the log.
const panel = (p) => p.evaluate(() => {
  const head = Array.from(document.querySelectorAll('div'))
    .find(d => (d.textContent || '').trim().toLowerCase() === 'audit trail');
  return head && head.parentElement ? head.parentElement.innerText : '';
});

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── The office reads the whole log, with names ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'omar@makaman.ly');
    const id = await seedAudit(p);
    await p.waitForTimeout(900);
    const text = await panel(p);

    check('the office reaches the audit trail', !!text, text ? '' : 'no panel rendered');
    check('it says what it is showing', /every recorded change to this ticket/i.test(text));
    check('a stage entry is listed', /job closed by the technician/i.test(text));
    check('an edit entry is listed', /mileage changed from 100 to 120/i.test(text));
    check('entries say who made them',
      /Yousef Al-Harbi/.test(text) && /Omar Al-Saleh/.test(text));
    check('entries are labelled by kind', /\bSTAGE\b/.test(text) && /\bEDIT\b/.test(text));
    await ctx.close();
  }

  // ── The Observer reads the work, not the edits ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'founder@makaman.ly');
    await seedAudit(p);
    await p.waitForTimeout(900);
    const text = await panel(p);

    // Every negative below is conditional on the panel actually being there. A blank
    // screen must never be able to pass an "is not shown" assertion — an earlier run of
    // this suite did exactly that and reported the leak as fixed when nothing had
    // rendered at all.
    check('the Observer still reaches the trail', !!text, text ? '' : 'no panel rendered');
    check('and is told it is narrowed', !!text && /job stages only/i.test(text));
    check('the stage entry is there', !!text && /job closed by the technician/i.test(text));
    check('THE EDIT IS WITHHELD',
      !!text && !/mileage changed from 100 to 120/i.test(text),
      'the leak this container had before');
    check("and the editor's name goes with it", !!text && !/Omar Al-Saleh/.test(text));
    await ctx.close();
  }

  // ── The properties, read from the source ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    const src = await p.evaluate(() => document.querySelector('script[type="text/x-dc"]').textContent);
    check('the per-ticket log reads the same capability as the Activity tab',
      /const curAuditDeep = this\.hasPermission\('activity\.view_edits'\);/.test(src));
    check('and the gate is applied to the rows, not only to a label',
      /\.filter\(a => curAuditDeep \|\| auditKind\(a\) === 'lifecycle'\)/.test(src));
    check('the empty state uses the same gate, so it cannot disagree with the list',
      /curAuditEmpty: .*curAuditDeep \|\| auditKind\(a\) === 'lifecycle'/.test(src));
    check('who made the entry is carried through', /by: a\.by \? a\.by : '',/.test(src));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
