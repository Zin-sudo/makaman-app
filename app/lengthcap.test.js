// Oilfield, well and rig are capped at ten characters. The customer is not, and must
// not be — company names are made of parts and run long, and truncating one puts a wrong
// name on a client's ticket.
//
// Both halves are asserted at every gate, because they fail in opposite directions. A
// cap that only exists as a maxLength attribute is defeated by a paste. A cap applied
// too widely is worse than none at all: it silently corrupts the one field where the
// full value is contractually the point.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

const LONG = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';           // 26 chars
const LONGCO = 'Sirte Oil Company for Petroleum Operations';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 940 } });
  const open = async (email, w, h) => {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: w || 430, height: h || 940 });
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'local' }; });
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    const i = p.locator('input');
    await i.nth(0).fill(email); await i.nth(1).fill('makaman2026');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(1400);
    return p;
  };

  // ── the technician's new-ticket form ─────────────────────────────────────
  let p = await open('yousef@makaman.ly');
  await p.getByRole('button', { name: /New Job Ticket/i }).click();
  await p.waitForTimeout(500);
  await p.locator('select').first().selectOption({ index: 1 });
  const ins = p.locator('input');
  // fill() sets the value directly, which is what a paste does — it does not type, so
  // it is not stopped by maxLength on every engine. This is the case the handler exists
  // for, so it is the one worth driving.
  await ins.nth(0).fill(LONG);
  await ins.nth(1).fill(LONG);
  await ins.nth(2).fill(LONG);
  await p.waitForTimeout(400);
  let d = await p.evaluate(() => window.__mkApp.state.draft);
  check('a pasted oilfield is cut to ten', (d.field || '').length === 10, JSON.stringify(d.field));
  check('a pasted well is cut to ten', (d.well || '').length === 10, JSON.stringify(d.well));
  check('a pasted rig is cut to ten', (d.rig || '').length === 10, JSON.stringify(d.rig));
  check('and it is the first ten, not the last', d.field === 'ABCDEFGHIJ', d.field);

  const attrs = await p.evaluate(() => Array.from(document.querySelectorAll('input'))
    .filter(i => /Burgan North|BG-214|WS-11/.test(i.placeholder || ''))
    .map(i => i.getAttribute('maxlength')));
  check('the three inputs also carry maxLength, so typing stops at ten',
    attrs.length === 3 && attrs.every(a => a === '10'), JSON.stringify(attrs));

  // Started with the clamped values, the ticket carries them — nothing recovers the
  // over-long text later.
  await p.getByRole('button', { name: /Start Logging/i }).click();
  await p.waitForTimeout(900);
  const t = await p.evaluate(() => {
    const ts = window.__mkApp.state.data.tickets;
    return ts[ts.length - 1];
  });
  check('the started ticket holds the capped values',
    t.field.length === 10 && t.well.length === 10 && t.rig.length === 10,
    [t.field, t.well, t.rig].join(' | '));
  await p.close();

  // ── the office-raised ticket ─────────────────────────────────────────────
  p = await open('omar@makaman.ly', 1400, 1000);
  await p.evaluate(() => window.__mkApp.setState({ mgrScreen: 'new', mgrDraft: { tech: '', customer: '', field: '', well: '', rig: '' } }));
  await p.waitForTimeout(700);
  const found = await p.evaluate(([long, longco]) => {
    const byPlaceholder = (re) => Array.from(document.querySelectorAll('input')).find(i => re.test(i.placeholder || ''));
    const set = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const f = byPlaceholder(/Defa/), w = byPlaceholder(/DF-12/), r = byPlaceholder(/RIG-4/);
    if (!f || !w || !r) return null;
    set(f, long); set(w, long); set(r, long);
    return {
      maxlens: [f, w, r].map(el => el.getAttribute('maxlength')),
    };
  }, [LONG, LONGCO]);
  check('the office form exposes the three inputs', !!found, JSON.stringify(found));
  await p.waitForTimeout(400);
  const md = await p.evaluate(() => window.__mkApp.state.mgrDraft);
  check('the office oilfield is capped too', (md.field || '').length === 10, JSON.stringify(md.field));
  check('the office well is capped too', (md.well || '').length === 10, JSON.stringify(md.well));
  check('the office rig is capped too', (md.rig || '').length === 10, JSON.stringify(md.rig));
  check('and those inputs carry maxLength as well',
    !!found && found.maxlens.every(a => a === '10'), JSON.stringify(found && found.maxlens));

  // ── the customer is explicitly exempt ────────────────────────────────────
  const cust = await p.evaluate(([longco]) => {
    const el = Array.from(document.querySelectorAll('input')).find(i => /customer/i.test(i.placeholder || ''))
      || Array.from(document.querySelectorAll('input')).find(i => i.getAttribute('maxlength') === null && /name/i.test(i.placeholder || ''));
    const app = window.__mkApp;
    // Driven through the handler directly, so this is about the rule rather than about
    // which input happens to be on screen.
    app.renderVals().fm.customer({ target: { value: longco } });
    return { viaHandler: app.state.mgrDraft.customer, hasMaxLen: el ? el.getAttribute('maxlength') : 'no-input' };
  }, [LONGCO]);
  check('a long customer name survives in full', cust.viaHandler === LONGCO,
    cust.viaHandler + ' (' + (cust.viaHandler || '').length + ' chars)');
  check('and the customer input carries no length cap',
    cust.hasMaxLen === null || cust.hasMaxLen === 'no-input', String(cust.hasMaxLen));

  // A store that already holds over-long values — written by an older build, or edited
  // by hand — is left alone locally. The cap belongs on the way in and on the way out to
  // the database, not to a pass that silently rewrites what is already on the device.
  // The database side of that is asserted in cloud.test.js, which has a database.
  const local = await p.evaluate(([long, longco]) => {
    const app = window.__mkApp;
    app.mutate(d => {
      const t = d.tickets[0];
      t.field = long; t.well = long; t.rig = long; t.customer = longco;
    });
    const t = app.state.data.tickets[0];
    return { f: t.field.length, w: t.well.length, r: t.rig.length, c: t.customer.length };
  }, [LONG, LONGCO]);
  check('an existing over-long value is not rewritten behind the user\'s back',
    local.f === LONG.length && local.c === LONGCO.length, JSON.stringify(local));
  await p.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
