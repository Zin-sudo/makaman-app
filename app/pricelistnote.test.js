// 2026-09-11, owner's report: "why it keep telling me '3 charged line(s) were priced from
// the old list — check them'" on ticket 1886 — a ticket whose customer had never been
// touched. customerNote (app/index.html) read only "does this ticket have any charged
// lines at all", so the warning fired on every ticket with items, forever, regardless of
// whether a customer switch had ever happened. Fixed to check for the one durable record
// pickReviewCustomer's own confirm handler leaves behind — a "Customer changed by …" audit
// entry — so the warning means what it says.
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
  const i = p.locator('input');
  await i.nth(0).fill('omar@makaman.ly'); await i.nth(1).fill('makaman2026');
  await p.getByRole('button', { name: /log in/i }).click();
  await p.waitForTimeout(1300);
  return p;
}

// Locate the note by the customer <select>'s own sibling, not by searching the whole page
// for the warning text — a page that never renders the note at all must never be able to
// pass an "it doesn't say the warning" check.
const customerNoteText = (p) => p.evaluate(() => {
  const sel = document.querySelector('select[onchange], select');
  const labels = Array.from(document.querySelectorAll('label')).find(l => l.textContent.trim() === 'Customer');
  if (!labels) return null;
  const wrap = labels.parentElement;
  const note = wrap && wrap.lastElementChild;
  return note ? note.textContent : null;
});

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── A ticket with charged lines whose customer was never touched ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await p.evaluate(() => {
      const app = window.__mkApp;
      app.mutate(d => {
        const t = d.tickets.find(x => x.id === 't3');
        t.items = [{ id: 'i1', itemNumber: 'MKN-1', desc: 'Test item', qty: 1, cost: 100, kind: 'flat' }];
      });
      app.openReview('t3');
    });
    await p.waitForTimeout(800);
    const text = await customerNoteText(p);
    check('the note is on screen at all', !!text, text);
    check('a ticket with 3+ charged lines but no customer change shows the neutral note, not the warning',
      !!text && /Sets which price list/i.test(text) && !/priced from the old list/i.test(text), text);
    await ctx.close();
  }

  // ── A ticket whose customer WAS changed after it already had charged lines ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await p.evaluate(() => {
      const app = window.__mkApp;
      app.mutate(d => {
        const t = d.tickets.find(x => x.id === 't3');
        t.items = [{ id: 'i1', itemNumber: 'MKN-1', desc: 'Test item', qty: 1, cost: 100, kind: 'flat' }];
        t.audit = (t.audit || []).concat([{ ts: new Date().toISOString(), kind: 'edit', by: 'Omar Al-Saleh',
          text: 'Customer changed by Omar Al-Saleh: Old Customer Co → New Customer Co.' }]);
      });
      app.openReview('t3');
    });
    await p.waitForTimeout(800);
    const text = await customerNoteText(p);
    check('after an actual customer change, the warning does show, naming the line count',
      !!text && /1 charged line\(s\) were priced from the old list/i.test(text), text);
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
