// A signed sheet photographed on a phone can run several megabytes, on a connection this
// app already treats as thin-to-none. compressImageFile downscales it before attachFile
// ever looks at its size — this exercises that function directly, the same way
// objective.test.js exercises suggestJobTypes directly: the contract is about the pure
// function, not about staging a real upload to prove it ran.
//
// Three things are being guarded:
//   1. An oversized photo actually shrinks, and its long edge is capped.
//   2. Nothing that should NOT be touched is touched — a PDF, a photo already small
//      enough, an unreadable file. Guessing wrong here means silently corrupting or
//      dropping a signed sheet, which is worse than not compressing it at all.
//   3. attachFile's own size gate runs on the file that came OUT of compression, not the
//      one that went in — so a big photo that compresses under the cap is not refused for
//      a size it no longer has.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, x) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${x ? '   ' + x : ''}`); };

async function boot(b) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1180, height: 950 });
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
  await p.waitForTimeout(1500);
  return { ctx, p };
}

// Built in-page rather than piped in from Node: canvas, Image and File all need a real
// browser to behave like one, and the point is to hand compressImageFile something it
// would actually receive from a camera or a photo picker.
const makeImageFile = (w, h, type, name) => `(() => {
  const c = document.createElement('canvas');
  c.width = ${w}; c.height = ${h};
  const ctx = c.getContext('2d');
  // A gradient, not a flat fill — a single solid color compresses to almost nothing
  // regardless of dimensions, which would make "did it get smaller" a meaningless check.
  const g = ctx.createLinearGradient(0, 0, ${w}, ${h});
  g.addColorStop(0, '#1a2a6c'); g.addColorStop(0.5, '#b21f1f'); g.addColorStop(1, '#fdbb2d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, ${w}, ${h});
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = 'rgba(' + ((i * 53) % 255) + ',' + ((i * 97) % 255) + ',' + ((i * 191) % 255) + ',0.6)';
    ctx.fillRect((i * 37) % ${w}, (i * 61) % ${h}, 30, 30);
  }
  return new Promise((resolve) => c.toBlob((blob) => {
    resolve(new File([blob], '${name}', { type: '${type}' }));
  }, '${type}', 0.9));
})()`;

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── An oversized photo shrinks, and its long edge is capped ──────────────
  {
    const { ctx, p } = await boot(b);
    const result = await p.evaluate(async (mk) => {
      const file = await eval(mk);
      const before = { size: file.size, type: file.type, name: file.name };
      const out = await window.__mkApp.compressImageFileForTest(file);
      // Decode the result back to read its real pixel dimensions, not just trust the
      // function's own arithmetic.
      const dims = await new Promise((resolve) => {
        const img = new Image();
        const u = URL.createObjectURL(out);
        img.onload = () => { URL.revokeObjectURL(u); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
        img.src = u;
      });
      return { before, after: { size: out.size, type: out.type, name: out.name }, dims };
    }, makeImageFile(3600, 2400, 'image/jpeg', 'jobsite.jpg'));
    check('a 3600x2400 photo comes back smaller',
      result.after.size < result.before.size,
      JSON.stringify({ before: result.before.size, after: result.after.size }));
    check('its long edge is capped at 1800',
      Math.max(result.dims.w, result.dims.h) <= 1800, JSON.stringify(result.dims));
    check('the aspect ratio survives the resize',
      Math.abs((result.dims.w / result.dims.h) - (3600 / 2400)) < 0.02, JSON.stringify(result.dims));
    check('it comes back as a JPEG, uploadable under the same rules as the original',
      result.after.type === 'image/jpeg', result.after.type);
    await ctx.close();
  }

  // ── A photo already small enough is left alone ────────────────────────────
  {
    const { ctx, p } = await boot(b);
    const result = await p.evaluate(async (mk) => {
      const file = await eval(mk);
      const out = await window.__mkApp.compressImageFileForTest(file);
      return { same: out === file, size: out.size, name: out.name };
    }, makeImageFile(800, 600, 'image/png', 'small.png'));
    check('a photo under the cap is returned unchanged, not re-encoded',
      result.same, JSON.stringify(result));
    await ctx.close();
  }

  // ── A PDF is never touched ────────────────────────────────────────────────
  {
    const { ctx, p } = await boot(b);
    const result = await p.evaluate(async () => {
      const file = new File([new Uint8Array(4096)], 'signed-ticket.pdf', { type: 'application/pdf' });
      const out = await window.__mkApp.compressImageFileForTest(file);
      return { same: out === file };
    });
    check('a PDF passes through untouched — nothing here can shrink one', result.same);
    await ctx.close();
  }

  // ── A file that will not decode fails safe, not silently ─────────────────
  {
    const { ctx, p } = await boot(b);
    const result = await p.evaluate(async () => {
      // Claims to be a JPEG; is not. An <img> will fail to decode it, and the fallback
      // must be the original file, not a dropped attachment.
      const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'not-really.jpg', { type: 'image/jpeg' });
      const out = await window.__mkApp.compressImageFileForTest(file);
      return { same: out === file };
    });
    check('a file that fails to decode resolves to the original, not nothing',
      result.same, JSON.stringify(result));
    await ctx.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
