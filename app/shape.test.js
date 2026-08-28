// Shape: which corners are round, which are square, and why each one is what it is.
//
// Three decisions live here, and all three are the kind that go wrong quietly. A radius
// is never an error — it is always *a* number, just sometimes the wrong one — so nothing
// crashes when a rule fails to match, or matches something it should not have reached.
// That is exactly how the app arrived at a dead 3px stripe once already.
//
// The claims:
//   1. Everything that IS the page is 8px — fields, buttons, cards, panels, and the two
//      boxes that only look like fields.
//   2. Everything that drops in ON TOP of the page is 12px — the toast, the pending-sync
//      bar, the stripe notices.
//   3. The A4 sheets are square, and stay square against a rule written to break them.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function boot(b, email, w, h) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w || 412, height: h || 900 });
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
  await p.waitForTimeout(1500);
  return { ctx, p };
}
// The app only writes to localStorage after a real interaction, so seeding the store
// means touching a control first rather than assuming it is already there.
async function persist(p) {
  if (await p.evaluate(() => !!localStorage.getItem('makaman.jobtickets.v2'))) return;
  await p.getByRole('button', { name: /^Account$/i }).last().click();
  await p.waitForTimeout(400);
  await p.evaluate(() => {
    const t = Array.from(document.querySelectorAll('button')).find(x => x.style.width === '42px');
    if (t) { t.click(); t.click(); }
  });
  await p.waitForTimeout(400);
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── 1. Fields, and the two boxes that are not fields ──────────────────────
  //
  // The technician's name and the stamped arrival time are divs — you cannot type into
  // either — but they sit in the same column as the inputs. A square box between two
  // rounded ones reads as a mistake, so they carry .mk-readonly and take the same value.
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly');
    await p.getByRole('button', { name: /New Job Ticket/i }).first().click();
    await p.waitForTimeout(900);
    const r = await p.evaluate(() => {
      const radii = el => getComputedStyle(el).borderRadius;
      const vis = sel => Array.from(document.querySelectorAll(sel)).filter(e => e.offsetParent !== null);
      const fields = vis('input, select, textarea');
      // The segmented controls are the one deliberate exception: their buttons sit flush
      // inside one bordered box, so the box carries the shape and they stay square.
      const buttons = vis('button').filter(e => !e.closest('.mk-seg'));
      const ro = Array.from(document.querySelectorAll('.mk-readonly'));
      return {
        fieldCount: fields.length,
        fieldRadii: Array.from(new Set(fields.map(radii))),
        buttonCount: buttons.length,
        buttonRadii: Array.from(new Set(buttons.map(radii))),
        readonlyCount: ro.length,
        readonlyRadii: Array.from(new Set(ro.map(radii))),
        readonlyText: ro.map(e => (e.innerText || '').slice(0, 24).replace(/\n/g, ' ')),
      };
    });
    check('every visible field on the new-ticket screen is 8px',
      r.fieldCount > 0 && r.fieldRadii.length === 1 && r.fieldRadii[0] === '8px',
      r.fieldCount + ' field(s) → ' + JSON.stringify(r.fieldRadii));
    check('and every button on it is the same 8px',
      r.buttonCount > 0 && r.buttonRadii.length === 1 && r.buttonRadii[0] === '8px',
      r.buttonCount + ' button(s) → ' + JSON.stringify(r.buttonRadii));
    check('the two boxes that only look like fields are there',
      r.readonlyCount === 2, JSON.stringify(r.readonlyText));
    check('and they are the same 8px, not merely close',
      r.readonlyRadii.length === 1 && r.readonlyRadii[0] === r.fieldRadii[0],
      JSON.stringify(r.readonlyRadii));
    await ctx.close();
  }

  // ── 2. The sheets are square because a rule says so ───────────────────────
  //
  // The .mk-sheet lock restates every property the sheet's contents inherit, but
  // border-radius is not inherited — so until it was stated outright the seal held only
  // because no rule happened to reach in. This asserts the seal, and then asserts it
  // survives a rule that deliberately tries to break it.
  {
    const { ctx, p } = await boot(b, 'omar@makaman.ly', 1100, 1200);
    await p.evaluate(() => {
      const app = window.__mkApp;
      const tk = (app.state.data.tickets || []).find(x => x.status === 'approved') || app.state.data.tickets[0];
      app.setState({ activeId: tk.id, mgrScreen: 'print' });
    });
    await p.waitForTimeout(1500);
    const seal = () => p.evaluate(() => {
      const sheets = Array.from(document.querySelectorAll('.mk-sheet'));
      const all = sheets.concat(Array.from(document.querySelectorAll('.mk-sheet *')));
      return { count: all.length, distinct: Array.from(new Set(all.map(e => getComputedStyle(e).borderRadius))) };
    });
    const before = await seal();
    check('the sheets rendered', before.count > 100, before.count + ' element(s)');
    check('every one of them is square', before.distinct.length === 1 && before.distinct[0] === '0px',
      JSON.stringify(before.distinct));

    // The sheet's own ink survived removing two exemption selectors that never matched.
    const ink = await p.evaluate(() => {
      const all = Array.from(document.querySelectorAll('.mk-sheet *'));
      const muted = all.filter(e => /color:\s*rgba\(29,\s*31,\s*32/.test(e.getAttribute('style') || ''));
      const blue = all.filter(e => /color:\s*(#1d2d3d|rgb\(29,\s*45,\s*61\))/.test(e.getAttribute('style') || ''));
      return {
        muted: muted.length, blue: blue.length,
        mutedColours: Array.from(new Set(muted.map(e => getComputedStyle(e).color))),
        blueColours: Array.from(new Set(blue.map(e => getComputedStyle(e).color))),
      };
    });
    check('cells with their own muted ink keep it', ink.muted > 0 &&
      // rgba(...,1) computes back as rgb(...), so both spellings are the same ink.
      ink.mutedColours.every(c => /^rgba?\(29, 31, 32[,)]/.test(c)),
      ink.muted + ' cell(s) → ' + JSON.stringify(ink.mutedColours));
    check('and cells with the accent ink keep that', ink.blue > 0 &&
      ink.blueColours.every(c => c === 'rgb(29, 45, 61)'),
      ink.blue + ' cell(s) → ' + JSON.stringify(ink.blueColours));

    // ── The seal, tested the way it will actually be attacked ──
    //
    // Not a stray stylesheet — a general tweak written where general tweaks get written,
    // inside @layer app, with !important and a selector broad enough to hit everything.
    // If the sheet survives this it survives anything short of editing the sheet block
    // itself, which is the promise the layer order is there to make.
    const shape = () => p.evaluate(() => {
      const sh = document.querySelector('.mk-sheet');
      const r = sh.getBoundingClientRect();
      const cs = getComputedStyle(sh);
      return {
        w: Math.round(r.width), h: Math.round(r.height),
        bg: cs.backgroundColor, ink: cs.color, font: cs.fontFamily, size: cs.fontSize,
      };
    });
    const before2 = await shape();
    await p.evaluate(() => {
      const el = document.createElement('style');
      el.textContent = '@layer app { div, table, td, th, span, tr {' +
        'border-radius:20px !important; background:#ff00ff !important;' +
        'color:#00ff00 !important; font-size:31px !important;' +
        'font-family:cursive !important; padding:19px !important;' +
        'letter-spacing:4px !important; text-transform:uppercase !important; } }';
      document.head.appendChild(el);
    });
    await p.waitForTimeout(250);
    const after = await seal(), after2 = await shape();
    check('the hostile rule is live', await p.evaluate(() =>
      getComputedStyle(document.querySelector('.mk-page div') || document.body).borderRadius === '20px'
      || Array.from(document.querySelectorAll('style')).some(x => /ff00ff/.test(x.textContent))));
    check('the sheets stay square against an !important rule inside the app layer',
      after.distinct.length === 1 && after.distinct[0] === '0px', JSON.stringify(after.distinct));
    check('and the sheet container keeps every one of its own settings',
      JSON.stringify(before2) === JSON.stringify(after2),
      JSON.stringify(before2) + '  vs  ' + JSON.stringify(after2));

    // ── The one hole, closed by an invariant rather than by hope ──
    //
    // The layer order seals the sheet against every NORMAL declaration the app can
    // write, at any specificity. It cannot seal it against `!important` in the app
    // layer, because an important declaration in a later layer outranks both an earlier
    // layer and the sheet's own inline styles — which is exactly what the run above
    // demonstrates on the cells.
    // So the rule is stated and enforced instead of assumed: no important declaration in
    // the app layer may set a property the sheet depends on, on a selector that reaches
    // a sheet element. That covers the properties the sheet block pins and the ones its
    // markup sets inline — 30-odd of them, gathered from the live document rather than
    // from a list somebody has to remember to update.
    const breach = await p.evaluate(() => {
      const sheetEls = Array.from(document.querySelectorAll('.mk-sheet, .mk-sheet *'));
      const guarded = new Set();
      sheetEls.forEach(e => { for (let k = 0; k < e.style.length; k++) guarded.add(e.style[k]); });
      const walk = (rules, layer, out) => {
        Array.from(rules || []).forEach(r => {
          if (r.cssRules) return walk(r.cssRules, r.name || layer, out);
          if (!r.style || !r.selectorText) return;
          if (layer !== 'app') return;
          for (let k = 0; k < r.style.length; k++) {
            const prop = r.style[k];
            if (r.style.getPropertyPriority(prop) !== 'important') continue;
            if (!guarded.has(prop)) continue;
            let hit = false;
            try { hit = sheetEls.some(e => e.matches(r.selectorText)); } catch (err) { hit = false; }
            if (hit) out.push(r.selectorText + ' { ' + prop + ' !important }');
          }
        });
      };
      const out = [];
      Array.from(document.styleSheets).forEach(ss => {
        // The injected hostile rule is the test's own; the app's own sheets are the ones
        // under audit.
        try { if (!/ff00ff/.test(ss.ownerNode.textContent || '')) walk(ss.cssRules, null, out); } catch (e) {}
      });
      return { guarded: guarded.size, breaches: out };
    });
    check('the audit knows what the sheet depends on', breach.guarded > 25, breach.guarded + ' propert(ies)');
    check('no !important rule in the app layer can reach a sheet property',
      breach.breaches.length === 0, JSON.stringify(breach.breaches));

    await ctx.close();
  }

  // ── 3a. The toast is a pill, and nothing inside it hits the arc ───────────
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly');
    await p.evaluate(() => window.__mkApp.setState({ toast: { text: 'Ticket synchronised with the office.', kind: 'ok' } }));
    await p.waitForTimeout(500);
    const t = await p.evaluate(() => {
      const el = document.querySelector('.mk-toast');
      if (!el) return { found: false };
      const btn = el.querySelector('button');
      return {
        found: true, radius: getComputedStyle(el).borderRadius,
        btnRadius: getComputedStyle(btn).borderRadius,
        h: Math.round(el.getBoundingClientRect().height),
      };
    });
    check('the toast is 12px', t.found && t.radius === '12px', JSON.stringify(t));
    check('and the control inside it is 8px — a control is 8px wherever it appears',
      t.btnRadius === '8px', t.btnRadius);
    await ctx.close();
  }

  // ── 3b. The pending-sync bar: 12px box, 8px button ───────────────────────
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly');
    await persist(p);
    await p.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
      d.tickets.forEach(t => { if (t.tech === 'Yousef Al-Harbi') { t.status = 'done'; t.synced = false; } });
      localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
    });
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(1300);
    const s = await p.evaluate(() => {
      const el = document.querySelector('.mk-banner');
      if (!el) return { found: false };
      const btn = el.querySelector('button');
      if (!btn) return { found: true, noBtn: true };
      return {
        found: true, radius: getComputedStyle(el).borderRadius,
        btnRadius: getComputedStyle(btn).borderRadius,
        btnText: (btn.innerText || '').trim(),
        h: Math.round(el.getBoundingClientRect().height),
      };
    });
    check('the pending-sync bar appeared', s.found && !s.noBtn, JSON.stringify(s));
    check('the bar is 12px', s.radius === '12px', s.radius);
    check('and the SYNC button in it is 8px', s.btnRadius === '8px', s.btnText + ' → ' + s.btnRadius);
    await ctx.close();
  }

  // ── 3c. Stripe notices are not pills, for a reason that can be measured ───
  //
  // The coloured bar is a 3px left border. A border follows the corner arc, so on a box
  // rounded to half its height it is drawn as a crescent tapering to nothing at both
  // ends — the stripe stops being a stripe. The radius therefore has to stay small
  // enough that the bar reads as straight down most of the edge, which is what the
  // second assertion measures: the arcs together may not eat more than half the height.
  {
    const { ctx, p } = await boot(b, 'yousef@makaman.ly');
    await persist(p);
    await p.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('makaman.jobtickets.v2'));
      d.tickets.forEach(t => { if (t.tech === 'Yousef Al-Harbi') { t.status = 'done'; t.synced = false; } });
      localStorage.setItem('makaman.jobtickets.v2', JSON.stringify(d));
    });
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(1200);
    await p.getByRole('button', { name: /^Tickets$/i }).last().click();
    await p.waitForTimeout(500);
    const card = p.locator('.mk-ticket-card').first();
    await card.click();
    await p.waitForTimeout(900);
    const n = await p.evaluate(() => {
      const els = Array.from(document.querySelectorAll('.mk-note')).filter(e => e.offsetParent !== null);
      return els.map(e => {
        const cs = getComputedStyle(e), r = e.getBoundingClientRect();
        return { radius: cs.borderRadius, stripe: cs.borderLeftWidth, h: Math.round(r.height) };
      });
    });
    check('a stripe notice is on screen', n.length > 0, n.length + ' notice(s)');
    check('it is 12px, like the other notices',
      n.length > 0 && n.every(x => x.radius === '12px'), JSON.stringify(n.map(x => x.radius)));
    check('its stripe is still a 3px bar',
      n.length > 0 && n.every(x => x.stripe === '3px'), JSON.stringify(n.map(x => x.stripe)));
    check('and the two arcs together still leave most of the stripe straight',
      n.length > 0 && n.every(x => 2 * parseFloat(x.radius) <= x.h / 2),
      JSON.stringify(n.map(x => x.radius + ' on ' + x.h + 'px')));
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
