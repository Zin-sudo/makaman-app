// The technician's own position readout, and what it does when there isn't one.
//
// The report: a technician at the base saw NO GPS FIX in the app bar, turned the
// "Share my location" toggle on and off, and nothing changed. Three separate faults sat
// behind that, and all three are asserted here.
//
//  1. `enableHighAccuracy: true` asks the phone for the GPS radio specifically. Under a
//     metal roof that radio never gets a lock — it burns the full 15s and returns
//     TIMEOUT — while the device knew roughly where it was the whole time from wifi and
//     cell towers and was never asked. There is now a coarse second attempt.
//  2. Every failure printed the same four words. Blocked, timed out, and no hardware are
//     three different problems with three different answers, and the readout said none
//     of them.
//  3. There was no way to ask again. A refusal is sticky for the session by design (so
//     the app does not badger anyone with permission prompts), but nothing distinguished
//     "the app has stopped asking" from "the app is broken", and the only control that
//     looked related — the sharing toggle — governs what the OFFICE is told and has
//     never had anything to do with whether the phone can find you.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

// A fake GPS built to behave like a real one, which is the only way to test this: the
// browser's own mock always succeeds, and succeeding is not the case that was broken.
//   mode 'gps-only'   — high accuracy times out, coarse succeeds. The base office.
//   mode 'blocked'    — PERMISSION_DENIED, whatever is asked for.
//   mode 'none'       — no geolocation on the device at all.
//   mode 'ok'         — both succeed.
async function boot(mode) {
  return async (ctx) => {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: 1180, height: 900 });
    p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
    await p.addInitScript((m) => {
      window.MAKAMAN_CONFIG = { authMode: 'local' };
      window.__gpsCalls = [];
      if (m === 'none') { try { delete navigator.geolocation; } catch (e) {} 
        Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
        return; }
      const fix = { coords: { latitude: 32.887209, longitude: 13.191338, accuracy: 1200 }, timestamp: Date.now() };
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition(ok, err, opts) {
            const high = !!(opts && opts.enableHighAccuracy);
            window.__gpsCalls.push(high ? 'high' : 'coarse');
            setTimeout(() => {
              if (m === 'blocked') return err({ code: 1, message: 'User denied Geolocation' });
              if (m === 'gps-only' && high) return err({ code: 3, message: 'Timeout expired' });
              ok({ coords: Object.assign({}, fix.coords), timestamp: Date.now() });
            }, 20);
          },
          watchPosition() { return 0; }, clearWatch() {},
        },
      });
    }, mode);
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForTimeout(300);
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: 'networkidle' });
    await p.waitForTimeout(700);
    const i = p.locator('input');
    await i.nth(0).fill('yousef@makaman.ly'); await i.nth(1).fill('makaman2026');
    await p.getByRole('button', { name: /log in/i }).click();
    await p.waitForTimeout(1400);
    return p;
  };
}
const readout = (p) => p.evaluate(() => {
  const el = document.querySelector('.mk-nav-fix');
  return el ? el.innerText.replace(/\s+/g, ' ').trim() : null;
});

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── Indoors: GPS cannot lock, and the coarse fix answers ──
  {
    const ctx = await b.newContext();
    const p = await (await boot('gps-only'))(ctx);
    const calls = await p.evaluate(() => window.__gpsCalls.slice());
    check('the phone is asked for a precise fix first', calls[0] === 'high', calls.join(','));
    check('and asked again coarsely when that cannot lock', calls[1] === 'coarse', calls.join(','));
    const txt = await readout(p);
    check('so a technician indoors reads a position, not a failure',
      /\d+\.\d{6}, \d+\.\d{6}/.test(txt || ''), txt);
    const st = await p.evaluate(() => ({
      fix: !!window.__mkApp.state.selfFix,
      failed: window.__mkApp.state.selfFixFailed,
    }));
    check('and the app holds it as a fix rather than a failure', st.fix && !st.failed);
    await ctx.close();
  }

  // ── Blocked: say so, and say where to fix it ──
  {
    const ctx = await b.newContext();
    const p = await (await boot('blocked'))(ctx);
    const txt = await readout(p);
    check('a refusal reads as a refusal', /BLOCKED/i.test(txt || ''), txt);
    check('and does not read as a missing signal', !/NO GPS FIX/i.test(txt || ''), txt);
    const hint = await p.evaluate(() => (document.querySelector('.mk-nav-fix') || {}).title || '');
    check('the hint says where it is blocked', /browser settings/i.test(hint), hint);
    // One request, not one a minute. Being told no is an answer.
    const before = await p.evaluate(() => window.__gpsCalls.length);
    check('a refusal is asked once, not repeatedly', before === 1, before + ' calls');

    // ...until the technician asks, which is the whole point of the tap.
    await p.evaluate(() => {
      // Answer yes this time — he went and allowed it in the browser, then came back.
      const g = navigator.geolocation;
      g.getCurrentPosition = function (ok) {
        window.__gpsCalls.push('after-allow');
        setTimeout(() => ok({ coords: { latitude: 32.9, longitude: 13.2, accuracy: 30 }, timestamp: Date.now() }), 20);
      };
    });
    await p.locator('.mk-nav-fix').click();
    await p.waitForTimeout(600);
    const after = await readout(p);
    check('tapping the readout asks again', /\d+\.\d{6}, \d+\.\d{6}/.test(after || ''), after);
    await ctx.close();
  }

  // ── The sharing toggle asks too ──
  //
  // It governs what the office is told, not what the phone can find — but a technician
  // with no position who reaches for the location switch is asking for one thing, and
  // handing him a settings change and no position is how this became permanent.
  {
    const ctx = await b.newContext();
    const p = await (await boot('blocked'))(ctx);
    check('nothing is found while it is blocked', /BLOCKED/i.test(await readout(p) || ''));
    await p.evaluate(() => {
      navigator.geolocation.getCurrentPosition = function (ok) {
        setTimeout(() => ok({ coords: { latitude: 32.9, longitude: 13.2, accuracy: 30 }, timestamp: Date.now() }), 20);
      };
      // Off, then on — the sequence the technician actually performed.
      window.__mkApp.updateSettings({ shareLocation: false });
    });
    await p.waitForTimeout(300);
    const wired = await p.evaluate(() => {
      const src = document.querySelector('script[type="text/x-dc"]').textContent;
      return /if \(next\) \{ this\.geoDenied = false; this\.selfGeoTick\(true\); \}/.test(src);
    });
    check('turning sharing back on clears the refusal and asks again', wired);
    await ctx.close();
  }

  // ── A device with no location hardware at all ──
  {
    const ctx = await b.newContext();
    const p = await (await boot('none'))(ctx);
    const txt = await readout(p);
    check('a device with no location says that, not "no fix"',
      /NO LOCATION/i.test(txt || '') && !/NO GPS FIX/i.test(txt || ''), txt);
    await ctx.close();
  }

  // ── Working normally, nothing changed ──
  {
    const ctx = await b.newContext();
    const p = await (await boot('ok'))(ctx);
    const calls = await p.evaluate(() => window.__gpsCalls.slice());
    check('a phone that can lock is asked once', calls.length === 1 && calls[0] === 'high', calls.join(','));
    check('and the readout is the coordinates', /\d+\.\d{6}, \d+\.\d{6}/.test(await readout(p) || ''));
    // Press and hold still copies; the tap-to-retry must not have displaced it.
    const holds = await p.evaluate(() => {
      const src = document.querySelector('script[type="text/x-dc"]').textContent;
      return /barFixRetry: \(\) => \{ if \(!S\.selfFix\) this\.selfGeoTick\(true\); \}/.test(src);
    });
    check('and a tap does nothing when there IS a fix — the hold copies it', holds);
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
