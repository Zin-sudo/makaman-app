// "Hand over this job?" — found completely broken while auditing the reliability of every
// user-triggered action in the PWA, 2026-09-05. Not a retry/timing bug: a first-attempt,
// unconditional, permanent refusal for every technician, since the RLS policy governing
// it was written (0008, 2026-08-20). No existing suite ever drove this action against a
// server that actually enforces its policies — cloudstub.js is a permissive fake with no
// RLS of its own — which is exactly how this went unnoticed for two weeks.
//
// Proven live, against the real database (see migrations 0059/0060/0061 for the full
// account): tickets_update_holder's WITH CHECK re-tested the NEW holder_id against
// auth.uid(), so a technician handing a job to someone else always failed that check —
// the one column this policy exists to let a holder change was the one column it could
// never become anything else. Separately, ticket_crew had no DELETE policy for a holder
// at all, and the INSERT policy's own subquery into `tickets` was circularly gated by
// ticket_crew's own visibility — so even after the header was fixed, the crew-list
// update was still refused, silently on delete (no error — RLS just hides rows with no
// policy to touch, which is not the same as an error) and loudly on the re-insert.
//
// What THIS file can prove, from here, without a real Postgres to enforce policies
// against: that diffOps sends the ops in the ORDER the live fix actually depends on —
// an EXISTING ticket's crew replace before its header (so a hand-over reaches the server
// while it still names the sender as holder, which is what 0059-0061 needed to be true
// for the crew write to have any chance of passing at all) and a BRAND NEW ticket's
// header before its children (nothing may reference tickets.id by foreign key before the
// row exists). The RLS policies themselves were proven directly against the live
// database instead — a fake server cannot stand in for a real one's own policy engine.
const { chromium } = require('playwright-core');
const URL = 'http://localhost:8934/index.html';
let pass = 0, fail = 0;
const check = (n, ok, extra) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '   ' + extra : ''}`); };

async function open(ctx) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1200, height: 900 });
  p.on('pageerror', e => console.log('  PAGEERROR:', e.message));
  await p.addInitScript(() => { window.MAKAMAN_CONFIG = { authMode: 'cloud', supabaseUrl: 'https://stub.test', supabaseKey: 'stub' }; });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  return p;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

  // ── An EXISTING ticket's crew reaches the queue before its own header ─────
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    // diffOps is exercised directly — no sign-in, no fake server needed for what this
    // checks, which is purely the ORDER ops land in the queue relative to each other.
    const r = await p.evaluate(() => {
      const src = document.querySelector('script[type="text/x-dc"]').textContent;
      const grab = (name) => {
        const at = src.indexOf('function ' + name + '(');
        if (at < 0) return null;
        let d = 0, i = src.indexOf('{', at);
        for (let j = i; j < src.length; j++) {
          if (src[j] === '{') d++;
          else if (src[j] === '}') { d--; if (!d) return src.slice(at, j + 1); }
        }
        return null;
      };
      const parts = ['diffOps', 'rowTicket', 'rowsChildren', 'buildUserIndex', 'clampLoc', 'tsOut', 'tsIn', 'numOut',
                     'sameVal', 'CHILD_TABLES', 'uuid']
        .map((n) => (n === 'CHILD_TABLES' ? "const CHILD_TABLES = ['ticket_items', 'ticket_assets', 'ticket_crew'];" : grab(n)))
        .filter(Boolean).join('\n');
      const LOCATION_CAPPED_DECL = "const LOCATION_CAPPED = { field: true, well: true, rig: true }; const LOCATION_MAX = 10; const DEFAULT_CURRENCY = 'USD'; const tsOut = (v) => (v ? new Date(v).toISOString() : null); const tsIn = (v) => (v ? new Date(v).toISOString() : ''); const numOut = (v) => (v === '' || v === null || v === undefined ? null : Number(v));";
      const CLOUD_IDS = { job: {}, me: 'holder-uuid' };
      const fn = new Function('CLOUD_IDS', `${LOCATION_CAPPED_DECL}\n${parts}\nreturn diffOps;`)(CLOUD_IDS);

      const before = { tickets: [{
        id: 'existing-ticket-1', tech: 'Yousef Al-Harbi', crew: [{ name: 'Yousef Al-Harbi', email: 'yousef@makaman.ly' }],
        holder: 'Yousef Al-Harbi', status: 'logging', customer: 'Kuwait Oil Group', field: 'Burgan North',
        well: '', rig: '', mileage: '', events: [], items: [], assets: [], notes: [],
      }], users: [{ id: 'yousef-uuid', name: 'Yousef Al-Harbi', email: 'yousef@makaman.ly' }, { id: 'omar-uuid', name: 'Omar Al-Saleh', email: 'omar@makaman.ly' }],
      clients: [{ id: 'client-uuid', name: 'Kuwait Oil Group' }], jobTypes: [] };
      const after = JSON.parse(JSON.stringify(before));
      // The hand-over itself: holder moves, crew gains the new holder — exactly what
      // the real handover dialog's confirm() does (see app/index.html).
      after.tickets[0].holder = 'Omar Al-Saleh';
      after.tickets[0].crew = [
        { name: 'Yousef Al-Harbi', email: 'yousef@makaman.ly' },
        { name: 'Omar Al-Saleh', email: 'omar@makaman.ly' },
      ];

      const ops = fn(before, after);
      return ops.map((o) => ({ key: o.key, table: o.table, action: o.action }));
    });
    const crewIdx = r.findIndex((o) => o.table === 'ticket_crew');
    const headerIdx = r.findIndex((o) => o.action === 'upsert_ticket');
    check('both a crew-replace and a header op were queued', crewIdx >= 0 && headerIdx >= 0, JSON.stringify(r));
    check('the crew replace comes BEFORE the header update on an existing ticket',
      crewIdx >= 0 && headerIdx >= 0 && crewIdx < headerIdx, JSON.stringify(r));
    await ctx.close();
  }

  // ── A BRAND NEW ticket's header still goes first — the FK the children depend on ──
  {
    const ctx = await b.newContext();
    const p = await open(ctx);
    const r = await p.evaluate(() => {
      const src = document.querySelector('script[type="text/x-dc"]').textContent;
      const grab = (name) => {
        const at = src.indexOf('function ' + name + '(');
        if (at < 0) return null;
        let d = 0, i = src.indexOf('{', at);
        for (let j = i; j < src.length; j++) {
          if (src[j] === '{') d++;
          else if (src[j] === '}') { d--; if (!d) return src.slice(at, j + 1); }
        }
        return null;
      };
      const parts = ['diffOps', 'rowTicket', 'rowsChildren', 'buildUserIndex', 'clampLoc', 'tsOut', 'tsIn', 'numOut', 'sameVal', 'uuid']
        .map(grab).filter(Boolean).join('\n');
      const CHILD_TABLES_DECL = "const CHILD_TABLES = ['ticket_items', 'ticket_assets', 'ticket_crew'];";
      const LOCATION_CAPPED_DECL = "const LOCATION_CAPPED = { field: true, well: true, rig: true }; const LOCATION_MAX = 10; const DEFAULT_CURRENCY = 'USD'; const tsOut = (v) => (v ? new Date(v).toISOString() : null); const tsIn = (v) => (v ? new Date(v).toISOString() : ''); const numOut = (v) => (v === '' || v === null || v === undefined ? null : Number(v));";
      const CLOUD_IDS = { job: {}, me: 'opener-uuid' };
      const fn = new Function('CLOUD_IDS', `${CHILD_TABLES_DECL}\n${LOCATION_CAPPED_DECL}\n${parts}\nreturn diffOps;`)(CLOUD_IDS);

      const before = { tickets: [], users: [{ id: 'yousef-uuid', name: 'Yousef Al-Harbi', email: 'yousef@makaman.ly' }],
        clients: [{ id: 'client-uuid', name: 'Kuwait Oil Group' }], jobTypes: [] };
      const after = { tickets: [{
        id: 'brand-new-ticket-1', tech: 'Yousef Al-Harbi', crew: [{ name: 'Yousef Al-Harbi', email: 'yousef@makaman.ly' }],
        holder: 'Yousef Al-Harbi', status: 'logging', customer: 'Kuwait Oil Group', field: 'Burgan North',
        well: '', rig: '', mileage: '', events: [], items: [], assets: [], notes: [],
      }], users: before.users, clients: before.clients, jobTypes: [] };

      const ops = fn(before, after);
      return ops.map((o) => ({ key: o.key, table: o.table, action: o.action }));
    });
    const crewIdx = r.findIndex((o) => o.table === 'ticket_crew');
    const headerIdx = r.findIndex((o) => o.action === 'upsert_ticket');
    check('both a crew-replace and a header op were queued for the new ticket',
      crewIdx >= 0 && headerIdx >= 0, JSON.stringify(r));
    check('the header comes BEFORE the crew replace on a brand-new ticket — nothing may reference its id first',
      crewIdx >= 0 && headerIdx >= 0 && headerIdx < crewIdx, JSON.stringify(r));
    await ctx.close();
  }

  await b.close();
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
