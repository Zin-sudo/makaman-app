// The master workbook of approved jobs.
//
// The chain is: approval → view → Edge Function → private bucket → signed link. Most of
// it lives in Postgres and Deno, so what this suite can honestly assert is the app's half
// plus the shape of the contract. The server half is verified against the live database
// separately — see HANDOFF §2h, including what could NOT be verified from here.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function open(ctx) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 1100 });
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

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  // ── Who is offered the file ──
  for (const [email, who, offered] of [
    ['lateri@makaman.ly', 'Admin', true],
    ['omar@makaman.ly', 'Ops Manager', true],
    ['founder@makaman.ly', 'Observer', true],
    ['yousef@makaman.ly', 'Technician', false],
  ]) {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, email);
    await p.getByText('Account', { exact: true }).first().click();
    await p.waitForTimeout(700);
    const seen = await p.evaluate(() => /master file — approved jobs/i.test(document.body.innerText));
    check(`${who} ${offered ? 'sees' : 'does not see'} the master file`, seen === offered);
    await ctx.close();
  }

  // ── What it says before anything has been built ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    await login(p, 'omar@makaman.ly');
    await p.getByText('Account', { exact: true }).first().click();
    await p.waitForTimeout(700);
    const t = await p.evaluate(() => document.body.innerText);
    check('an unbuilt file says so rather than looking broken',
      /no file built yet/i.test(t));
    check('download is disabled until there is something to download',
      await p.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(x => /^download$/i.test(x.textContent.trim()));
        return !!btn && btn.disabled;
      }));
    check('the freshness rule is stated on screen',
      /rebuilds it on its own within a minute/i.test(t));
    check('and so is the link expiring', /link expires/i.test(t));
    await ctx.close();
  }

  // ── The contract, read from the source ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    const src = await p.evaluate(() => document.querySelector('script[type="text/x-dc"]').textContent);

    check('the file is fetched by a signed link, never a public URL',
      /createSignedUrl\('?\w*'?/.test(src) && !/getPublicUrl/.test(src));
    check('the link is short-lived', /createSignedUrl\(m\.path, 60\)/.test(src));
    check('a rebuild goes through the Edge Function',
      /functions\.invoke\('master-export'/.test(src));
    check('the tile is gated on a capability',
      /showMasterExport: this\.hasPermission\('export\.master'\)/.test(src));
    check('a failed build is shown, not hidden',
      /Last build failed: /.test(src));
    check('freshness comes from the run record, not from a guess',
      /export_runs/.test(src) && /masterExport/.test(src));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
