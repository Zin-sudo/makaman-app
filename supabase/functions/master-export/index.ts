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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const who = await callerIsAllowed(req, db)
  if (!who.ok) return json({ error: who.why }, 401)

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

    // Widths from the content, so nothing opens as ####. Capped, because one long
    // customer name should not push Total off the screen.
    sheet['!cols'] = HEADERS.map((h) => {
      let widest = h.length
      for (const r of list) {
        const v = (r as Record<string, unknown>)[h]
        const n = v === null || v === undefined ? 0 : String(v).length
        if (n > widest) widest = n
      }
      return { wch: Math.min(Math.max(widest + 2, 10), 40) }
    })
    sheet['!freeze'] = { xSplit: 0, ySplit: 1 }

    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Approved Jobs')
    const buf = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer

    const { error: upErr } = await db.storage.from('exports').upload(
      OBJECT_PATH,
      new Blob([buf], { type: XLSX_MIME }),
      { contentType: XLSX_MIME, upsert: true },
    )
    if (upErr) return await fail(upErr.message)

    await db.from('export_runs').update({
      status: 'ok',
      finished_at: new Date().toISOString(),
      row_count: list.length,
      object_path: OBJECT_PATH,
    }).eq('id', run.id)

    return json({ ok: true, rows: list.length, path: OBJECT_PATH, by: who.why })
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err))
  }
})
