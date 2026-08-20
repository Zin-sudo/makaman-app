// The numbering claim as a shift-level thing, and the tools panel as its own subject.
//
// Handing the claim over used to be a button inside whichever ticket happened to be
// open, which framed it as a per-ticket decision. It is not: whoever holds it numbers
// every job from the moment they receive it. It belongs in Account, and — this is the
// part that matters operationally — an Admin has to be able to move it, because the
// usual reason it needs moving is that the holder is not there to move it himself.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const open = async (email, wipe) => {
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await p.evaluate((w) => { if (w) localStorage.clear(); else localStorage.removeItem('makaman.jobtickets.session.v1'); }, !!wipe);
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    const i = p.locator('input');
    await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(1500);
    return p;
  };
  const account = async (p) => {
    await p.getByRole('button', { name: /^Account$/i }).last().click();
    await p.waitForTimeout(700);
    return p.innerText('body');
  };

  // ── the holder finds it in Account, not in a ticket ──────────────────────
  let p = await open('omar@makaman.ly', true);
  let body = await account(p);
  check('the claim has its own section in Account', /Ticket numbering claim/i.test(body));
  check('naming who holds it, and that it is them',
    /Omar Al-Saleh — you/i.test(body),
    (body.split('\n').find(l => /Omar Al-Saleh/.test(l)) || '').trim());
  check('and saying it covers every job from when they got it',
    /Numbering every job raised/i.test(body),
    (body.split('\n').find(l => /Numbering every job/.test(l)) || '').trim());
  check('the holder is offered the handover', await p.getByRole('button', { name: /Hand over the claim/i }).count() === 1);

  // and it is no longer inside a ticket
  await p.evaluate(() => {
    const app = window.__mkApp;
    const t = app.state.data.tickets.find(x => x.status !== 'logging') || app.state.data.tickets[0];
    app.setState({ activeId: t.id, mgrScreen: 'review', roleTab: 'tickets' });
  });
  await p.waitForTimeout(900);
  body = await p.innerText('body');
  check('the ticket still says who holds the claim', /holds the numbering claim/i.test(body));
  check('but no longer offers a handover from inside it',
    await p.getByRole('button', { name: /^Hand over$/i }).count() === 0);
  await p.close();

  // ── a manager who does not hold it is told what to do ────────────────────
  p = await open('lateri@makaman.ly');
  body = await account(p);
  check('an Admin sees the claim section too', /Ticket numbering claim/i.test(body));
  check('and is warned that moving it is an override',
    /recorded as an Admin override/i.test(body),
    (body.split('\n').find(l => /override/i.test(l)) || '').trim().slice(0, 80));
  check('the Admin is offered the move even though they do not hold it',
    await p.getByRole('button', { name: /Move the claim/i }).count() === 1);

  // ── an Admin can actually move it while the holder is away ───────────────
  await p.getByRole('button', { name: /Move the claim/i }).click();
  await p.waitForTimeout(700);
  body = await p.innerText('body');
  check('the dialog frames it as a move, not a hand-over',
    /Move ticket numbering to someone else/i.test(body),
    (body.split('\n').find(l => /Move ticket numbering/i.test(l)) || '').trim());
  check('and explains the holder is unavailable',
    /when the person holding it is not available/i.test(body));

  // The dialog's select, not the month filter that is also on the Account page behind
  // it. Scoped by finding the one inside a fixed-position ancestor — the overlay.
  const offered = await p.evaluate(() => {
    const inOverlay = (el) => { let e = el; while (e) { if (getComputedStyle(e).position === 'fixed') return true; e = e.parentElement; } return false; };
    const sel = Array.from(document.querySelectorAll('select')).find(inOverlay);
    return sel ? Array.from(sel.options).map(o => o.value).filter(Boolean) : null;
  });
  // Only people who can actually hold it. Handing numbering to a technician would give
  // it to someone the app then refuses to let number anything.
  check('the claim is offered only to managers and admins',
    !!offered && offered.length > 0 && !offered.some(n => /Yousef|Mahmoud/.test(n)),
    JSON.stringify(offered));
  const picked = await p.evaluate(() => {
    const inOverlay = (el) => { let e = el; while (e) { if (getComputedStyle(e).position === 'fixed') return true; e = e.parentElement; } return false; };
    const sel = Array.from(document.querySelectorAll('select')).find(inOverlay);
    const opt = Array.from(sel.options).map(o => o.value).filter(Boolean);
    if (!opt.length) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, opt[0]);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return opt[0];
  });
  check('a recipient can be chosen', !!picked, String(picked));
  await p.waitForTimeout(400);
  // Clicked in the page rather than through the locator: the overlay sits above the
  // Account button of the same name, and Playwright's actionability check keeps
  // resolving to the one underneath.
  await p.evaluate(() => {
    const inOverlay = (el) => { let e = el; while (e) { if (getComputedStyle(e).position === 'fixed') return true; e = e.parentElement; } return false; };
    const b = Array.from(document.querySelectorAll('button'))
      .filter(inOverlay).find(x => /^Move the claim$/i.test(x.textContent.trim()));
    if (b) b.click();
  });
  await p.waitForTimeout(900);
  const claim = await p.evaluate(() => window.__mkApp.state.data.numbering);
  check('the claim moves to them', claim.holderName === picked, JSON.stringify(claim.holderName));
  check('and is stamped with when they received it', !!claim.since, claim.since);
  // Recorded on the claim itself. It used to be written onto whichever ticket was open,
  // which from Account would mean nowhere at all.
  check('the move is recorded even with no ticket open',
    (claim.history || []).length === 1, JSON.stringify((claim.history || []).length));
  check('and marked as an Admin override rather than a hand-over',
    (claim.history || [])[0] && claim.history[0].admin === true
    && claim.history[0].by === 'M. Lateri',
    JSON.stringify(claim.history && claim.history[0]));

  body = await account(p);
  check('the panel shows the last move', /Moved by Admin M\. Lateri/i.test(body),
    (body.split('\n').find(l => /Moved by Admin/i.test(l)) || '').trim());
  await p.close();

  // ── the old holder is now locked out, the new one is not ─────────────────
  p = await open('omar@makaman.ly');
  body = await account(p);
  check('the previous holder is told who has it now',
    /holds it\. Ask them to hand it over/i.test(body) || new RegExp(picked).test(body),
    (body.split('\n').find(l => /holds it|Ask them/i.test(l)) || '').trim().slice(0, 90));
  check('and is no longer offered a handover',
    await p.getByRole('button', { name: /Hand over the claim|Move the claim/i }).count() === 0);
  await p.close();

  // ── the tools panel stands on its own ────────────────────────────────────
  p = await open('lateri@makaman.ly');
  await p.evaluate(() => {
    const app = window.__mkApp;
    // A running job: tools are allocated while the work is live, so that is when the
    // panel is editable and therefore when its position is worth asserting.
    const t = app.state.data.tickets.find(x => x.status === 'logging') || app.state.data.tickets[0];
    app.setState({ activeId: t.id, mgrScreen: 'review', roleTab: 'tickets' });
  });
  await p.waitForTimeout(900);
  const order = await p.evaluate(() => {
    const heads = Array.from(document.querySelectorAll('div'))
      .filter(d => d.children.length === 0 && /^(Tools & crossovers allocated|Ticket header|3 · Job log from the field|4 · Approval)$/i.test(d.textContent.trim()))
      .map(d => ({ text: d.textContent.trim(), y: d.getBoundingClientRect().top + window.scrollY,
                   x: d.getBoundingClientRect().left }));
    return heads;
  });
  const find = (re) => order.find(h => re.test(h.text));
  const tools = find(/Tools & crossovers/i), header = find(/Ticket header/i),
        approval = find(/4 · Approval/i);
  check('the tools panel is its own container, not a footnote', !!tools,
    JSON.stringify(order.map(o => o.text)));
  check('it sits above the ticket header', !!tools && !!header && tools.y < header.y,
    tools && header ? `tools ${Math.round(tools.y)} vs header ${Math.round(header.y)}` : 'missing');
  check('and no longer inside the approval block', !!tools && !!approval && tools.y < approval.y,
    tools && approval ? `tools ${Math.round(tools.y)} vs approval ${Math.round(approval.y)}` : 'missing');
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
