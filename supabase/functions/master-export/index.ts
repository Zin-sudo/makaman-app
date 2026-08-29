// Builds the master workbook of every approved job and puts it in the exports bucket.
//
// Rebuilt from the database every time rather than appended to. Nobody edits this file by
// hand, so a rebuild is idempotent and self-healing: a ticket reopened and re-approved, a
// corrected price, a fixed customer name all simply come out right on the next run. An
// append-only design would carry every past mistake forever.
//
// The shape of a row is `public.master_export_rows`, not anything in this file. Changing
// what finance sees is a view change, not a redeploy.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Built once, at module scope. Deno Deploy keeps the isolate warm between invocations, so
// this survives to the next call along with its connection pool; rebuilding it per
// request threw both away. Nothing about it is per-caller — who is asking is established
// from their own token in callerIsAllowed().
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const OBJECT_PATH = 'master/makaman-approved-jobs.xlsx'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const NONCE_MAX_AGE_MS = 2 * 60 * 1000

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-export-nonce',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

// verify_jwt is off at the platform level because there are two legitimate callers and
// they prove themselves differently. Both are checked here; neither path lets an
// anonymous caller through.
async function callerIsAllowed(req: Request, db: ReturnType<typeof createClient>) {
  // 1. The scheduler, holding a single-use nonce only the database can mint.
  //
  //    Deliberately NOT a comparison against SUPABASE_SERVICE_ROLE_KEY. That is the
  //    legacy JWT spelling of the key, and a project configured with the newer
  //    `sb_secret_` format presents a different string for the same authority — the
  //    comparison then fails with 401 for a reason nothing in the logs explains.
  //    A nonce has no spelling to get wrong.
  const nonce = req.headers.get('x-export-nonce')
  if (nonce) {
    const { data: row } = await db
      .from('export_nonces').select('nonce, created_at').eq('nonce', nonce).maybeSingle()
    if (!row) return { ok: false, why: 'That request was not recognised.' }

    // Consumed whether or not it turns out to be fresh, so a leaked nonce is worth one
    // attempt at most.
    await db.from('export_nonces').delete().eq('nonce', nonce)

    const age = Date.now() - new Date(row.created_at as string).getTime()
    if (age > NONCE_MAX_AGE_MS) return { ok: false, why: 'That request expired.' }
    return { ok: true, why: 'scheduler' }
  }

  // 2. A person, pressing Rebuild now. Identity from their own token, role from the
  //    database — never from a claim inside the token, which can be stale after a role
  //    change.
  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
  if (!token) return { ok: false, why: 'Missing Authorization header.' }

  const { data: user, error } = await db.auth.getUser(token)
  if (error || !user?.user) return { ok: false, why: 'Invalid session.' }

  const { data: profile } = await db
    .from('profiles').select('role, status').eq('id', user.user.id).single()
  const allowed = !!profile && profile.status === 'active'
    && ['ops_manager', 'admin'].includes(profile.role)
  return allowed
    ? { ok: true, why: 'staff' }
    : { ok: false, why: 'Only the office can rebuild the master file.' }
}

Deno.serve(async (req) => {
  // Answered before anything else is touched: no client, no auth, no database.
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const t0 = performance.now()
  const at = (): number => Math.round(performance.now() - t0)

  const who = await callerIsAllowed(req, db)
  const tAuth = at()
  if (!who.ok) return json({ error: who.why }, 401)

  // Nothing has changed since the last good run — hand back the file that already exists.
  //
  // This function is on a schedule, and the schedule does not know whether anybody
  // approved anything. Most runs rebuild an identical workbook: read every row, lay out
  // a sheet, serialise it, and upload it over a byte-identical predecessor. The
  // expensive half of that is skipped when the newest approval is older than the last
  // successful run.
  //
  // Compared against approved_at rather than a row count, because a count is unchanged by
  // a ticket being re-approved after a correction — which is exactly the case this file
  // exists to pick up. Two cheap reads decide it, and either one being unavailable falls
  // through to a rebuild: the wrong answer here is a stale file finance is trusting, so
  // the doubt is always resolved by doing the work.
  const [{ data: lastRun }, { data: newest }] = await Promise.all([
    db.from('export_runs').select('finished_at, object_path, row_count')
      .eq('kind', 'master').eq('status', 'ok')
      .order('finished_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('tickets').select('approved_at')
      .not('approved_at', 'is', null)
      .order('approved_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  const force = new URL(req.url).searchParams.get('force') === '1'
  if (!force && lastRun?.finished_at && lastRun?.object_path) {
    const lastAt = new Date(lastRun.finished_at as string).getTime()
    const newestAt = newest?.approved_at ? new Date(newest.approved_at as string).getTime() : 0
    if (newestAt && newestAt < lastAt) {
      console.log(JSON.stringify({ fn: 'master-export', outcome: 'unchanged',
        total_ms: at(), auth_ms: tAuth, by: who.why }))
      return json({ ok: true, unchanged: true, rows: lastRun.row_count ?? null,
        path: lastRun.object_path, by: who.why })
    }
  }

  // Claim the run first, so a failure leaves a record saying why the file is stale
  // instead of leaving the last success looking current.
  const { data: run, error: runErr } = await db
    .from('export_runs')
    .insert({ kind: 'master', status: 'running' })
    .select('id')
    .single()
  if (runErr) return json({ error: runErr.message }, 500)

  const fail = async (message: string) => {
    await db.from('export_runs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), error: message })
      .eq('id', run.id)
    return json({ error: message }, 500)
  }

  try {
    const { data: rows, error: rowsErr } = await db.from('master_export_rows').select('*')
    if (rowsErr) return await fail(rowsErr.message)

    const list = rows ?? []
    const HEADERS = [
      'Ticket No', 'Approved', 'Job Ended', 'Payroll Month', 'Customer', 'Field',
      'Well No', 'Rig', 'Technician', 'Held By', 'Job Type', 'Arrival', 'Start Job',
      'End Job', 'Mileage (One Way) km', 'Base Location', 'Customer Rep', 'Currency',
      'Charged Items', 'Total', 'Approved By',
    ]

    // An empty sheet still needs its headings, or the first approved job of the month
    // lands in a file whose columns nobody has seen.
    const sheet = list.length
      ? XLSX.utils.json_to_sheet(list, { header: HEADERS })
      : XLSX.utils.aoa_to_sheet([HEADERS])

    // Widths in one pass over the rows rather than one pass PER COLUMN.
    //
    // This was HEADERS.map() with a loop over every row inside it — twenty-one full
    // sweeps of the export to measure twenty-one columns, when one sweep can measure all
    // of them. Same output, same cap: nothing opens as ####, and one long customer name
    // still cannot push Total off the screen.
    const widest = HEADERS.map((h) => h.length)
    for (const r of list) {
      const row = r as Record<string, unknown>
      for (let i = 0; i < HEADERS.length; i++) {
        const v = row[HEADERS[i]]
        const n = v === null || v === undefined ? 0 : String(v).length
        if (n > widest[i]) widest[i] = n
      }
    }
    sheet['!cols'] = widest.map((w) => ({ wch: Math.min(Math.max(w + 2, 10), 40) }))
    sheet['!freeze'] = { xSplit: 0, ySplit: 1 }

    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Approved Jobs')
    const buf = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer

    const { error: upErr } = await db.storage.from('exports').upload(
      OBJECT_PATH,
      new Blob([buf], { type: XLSX_MIME }),
      // A minute, explicitly, rather than Supabase Storage's hour-long default.
      //
      // The review that prompted this asked for a LONG cache so repeat downloads would
      // not hit the Edge Function. They never did — downloads go to Storage through a
      // signed URL and this function is not in that path at all. What the default hour
      // actually buys is finance opening a workbook that is up to an hour out of date
      // immediately after somebody pressed Rebuild to fix it, which is the one thing
      // this file must not do. Sixty seconds still absorbs a burst of downloads.
      { contentType: XLSX_MIME, upsert: true, cacheControl: '60' },
    )
    if (upErr) return await fail(upErr.message)

    await db.from('export_runs').update({
      status: 'ok',
      finished_at: new Date().toISOString(),
      row_count: list.length,
      object_path: OBJECT_PATH,
    }).eq('id', run.id)

    console.log(JSON.stringify({ fn: 'master-export', outcome: 'rebuilt',
      rows: list.length, total_ms: at(), auth_ms: tAuth, by: who.why }))
    return json({ ok: true, rows: list.length, path: OBJECT_PATH, by: who.why })
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err))
  }
})
