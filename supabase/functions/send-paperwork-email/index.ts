// The signed service ticket and job log, emailed with both attached, the moment the
// second one lands. Triggered by tg_maybe_send_paperwork_email() (0051/0052) on every
// ticket_attachments insert — this function is what decides whether that insert was the
// one that completed the pair, and does the actual sending.
//
// Auth follows the same shape master-export settled on (0023): a single-use nonce this
// database minted for itself, not a copy of any credential to keep in step. verify_jwt is
// off at the platform level for exactly that reason — there is no Authorization header to
// check, only the nonce.
//
// The Resend key never appears in this file. There is no tool in this project's toolchain
// that can set an Edge Function's own secrets the way SUPABASE_SERVICE_ROLE_KEY is
// auto-injected, so it stays in the Vault (0053) and this function reads it out through
// get_paperwork_resend_key(), a service-role-only RPC — the same "never in source, never
// in the client" rule every other credential here follows, just routed through the one
// door available.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const NONCE_MAX_AGE_MS = 2 * 60 * 1000
const RESEND_FROM = 'tickets@makaman.ly'

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-paperwork-nonce',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function callerIsAllowed(req: Request): Promise<{ ok: boolean; why: string }> {
  const nonce = req.headers.get('x-paperwork-nonce')
  if (!nonce) return { ok: false, why: 'Missing nonce.' }

  const { data: row } = await db
    .from('paperwork_email_nonces').select('nonce, created_at').eq('nonce', nonce).maybeSingle()
  if (!row) return { ok: false, why: 'That request was not recognised.' }

  // Consumed whether or not it turns out to be fresh, so a leaked nonce is worth one
  // attempt at most.
  await db.from('paperwork_email_nonces').delete().eq('nonce', nonce)

  const age = Date.now() - new Date(row.created_at as string).getTime()
  if (age > NONCE_MAX_AGE_MS) return { ok: false, why: 'That request expired.' }
  return { ok: true, why: 'trigger' }
}

const stamp = (iso: string | null) => {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: 'Africa/Tripoli', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }) + ' (Libya time)'
  } catch { return iso }
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

type Attachment = { doc_kind: string; path: string; filename: string; mime: string; uploaded_by: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const who = await callerIsAllowed(req)
  if (!who.ok) return json({ error: who.why }, 401)

  let ticketId: string
  try {
    const body = await req.json()
    ticketId = body.ticket_id
    if (!ticketId) throw new Error('missing ticket_id')
  } catch {
    return json({ error: 'Bad request body.' }, 400)
  }

  // Completeness first, claim second — in that order, deliberately. The trigger fires on
  // EVERY attachment insert, including the first of the pair, long before there is
  // anything to send. Checking completeness before claiming means the first insert's
  // firing finds nothing to do and leaves the ticket unclaimed for the second insert's
  // firing to actually send.
  const { data: atts, error: attsErr } = await db
    .from('ticket_attachments')
    .select('doc_kind, path, filename, mime, uploaded_by')
    .eq('ticket_id', ticketId)
    .in('doc_kind', ['service_ticket', 'job_log'])
  if (attsErr) return json({ error: attsErr.message }, 500)

  const serviceTicket = (atts ?? []).find((a) => a.doc_kind === 'service_ticket') as Attachment | undefined
  const jobLogDoc = (atts ?? []).find((a) => a.doc_kind === 'job_log') as Attachment | undefined
  if (!serviceTicket || !jobLogDoc) {
    return json({ ok: true, skipped: 'not both attached yet' })
  }

  // The atomic claim. Two attachments landing in the same second fire this function
  // twice; only one of those calls can win this update, because paperwork_emailed_at is
  // only ever null until this line sets it. The other call's update touches zero rows and
  // returns null, and it stops here rather than sending a second copy.
  const { data: claimed, error: claimErr } = await db
    .from('tickets')
    .update({ paperwork_emailed_at: new Date().toISOString() })
    .eq('id', ticketId)
    .is('paperwork_emailed_at', null)
    .select('*')
    .maybeSingle()
  if (claimErr) return json({ error: claimErr.message }, 500)
  if (!claimed) return json({ ok: true, skipped: 'already sent' })

  // A failure past this point releases the claim, so a later manual retry (or a re-attach)
  // gets to try again rather than the ticket silently never sending.
  const releaseClaim = () => db.from('tickets').update({ paperwork_emailed_at: null }).eq('id', ticketId)

  try {
    const [{ data: recipients }, { data: lines }, technicianRes] = await Promise.all([
      db.from('paperwork_email_recipients').select('email').eq('enabled', true),
      db.from('ticket_lines').select('logged_at, text').eq('ticket_id', ticketId).order('logged_at', { ascending: true }),
      claimed.technician_id
        ? db.from('profiles').select('full_name').eq('id', claimed.technician_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    const technician = technicianRes.data as { full_name?: string } | null

    const to = (recipients ?? []).map((r) => r.email as string)
    if (!to.length) {
      await db.from('audit_log').insert({
        ticket_id: ticketId, changed_by: jobLogDoc.uploaded_by, kind: 'lifecycle',
        text: 'Signed paperwork was NOT emailed — the distribution list has no enabled recipients.',
      })
      // Not a failure of the send: there was nothing to send to. The claim stands so this
      // does not re-fire on some later, unrelated insert.
      return json({ ok: true, skipped: 'no enabled recipients' })
    }

    const subject = `Ticket #${claimed.ticket_number ?? '—'} — ${claimed.customer ?? '—'} — `
      + `${claimed.field_name ?? '—'} — ${claimed.well_no ?? '—'} — ${claimed.rig_name ?? '—'}`

    const metaRows: [string, string][] = [
      ['Ticket No.', claimed.ticket_number ?? '—'],
      ['Customer', claimed.customer ?? '—'],
      ['Field', claimed.field_name ?? '—'],
      ['Well No.', claimed.well_no ?? '—'],
      ['Rig', claimed.rig_name ?? '—'],
      ['Technician', technician?.full_name ?? '—'],
      ['Arrived to location', stamp(claimed.arrival_at)],
      ['Start job', stamp(claimed.start_job_at)],
      ['End job', stamp(claimed.end_job_at)],
      ['Mileage (one way)', claimed.mileage_one_way != null ? `${claimed.mileage_one_way} km` : '—'],
      ['Base location', claimed.base_location ?? '—'],
      ['Customer rep.', claimed.customer_rep ?? '—'],
      ['Approved', stamp(claimed.approved_at)],
    ]

    const metaHtml = metaRows.map(([k, v]) =>
      `<tr><td style="padding:3px 12px 3px 0;color:#666;white-space:nowrap">${escapeHtml(k)}</td>`
      + `<td style="padding:3px 0">${escapeHtml(v)}</td></tr>`).join('')

    const logHtml = (lines ?? []).length
      ? (lines ?? []).map((l) =>
          `<tr><td style="padding:2px 12px 2px 0;color:#666;white-space:nowrap;vertical-align:top">`
          + `${escapeHtml(stamp(l.logged_at as string))}</td>`
          + `<td style="padding:2px 0;vertical-align:top">${escapeHtml(l.text as string)}</td></tr>`).join('')
      : `<tr><td colspan="2" style="padding:6px 0;color:#666">No job log lines were recorded.</td></tr>`

    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;max-width:640px">
        <h2 style="margin:0 0 4px">${escapeHtml(subject)}</h2>
        <p style="margin:0 0 18px;color:#666">Both signed documents are attached to this email — the Service Ticket and the Job Log.</p>
        <table style="border-collapse:collapse;margin-bottom:20px">${metaHtml}</table>
        <h3 style="margin:0 0 8px">Job log</h3>
        <table style="border-collapse:collapse">${logHtml}</table>
        <p style="margin-top:24px;color:#999;font-size:12px">Sent automatically by Makaman Job Tickets when both signed documents were received.</p>
      </div>`.trim()

    const toAttachment = async (a: Attachment) => {
      const { data: blob, error } = await db.storage.from('attachments').download(a.path)
      if (error || !blob) throw new Error(`Could not read ${a.filename} from storage: ${error?.message ?? 'no data'}`)
      const buf = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
      return { filename: a.filename, content: btoa(bin) }
    }
    const [serviceTicketAttachment, jobLogAttachment] = await Promise.all([
      toAttachment(serviceTicket),
      toAttachment(jobLogDoc),
    ])

    const { data: resendKey, error: keyErr } = await db.rpc('get_paperwork_resend_key')
    if (keyErr || !resendKey) throw new Error(`Could not read the Resend key from the Vault: ${keyErr?.message ?? 'not set'}`)

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to,
        subject,
        html,
        attachments: [serviceTicketAttachment, jobLogAttachment],
      }),
    })
    const sendBody = await sendRes.json().catch(() => ({}))
    if (!sendRes.ok) throw new Error(`Resend refused the send: ${sendRes.status} ${JSON.stringify(sendBody)}`)

    await db.from('audit_log').insert({
      ticket_id: ticketId, changed_by: jobLogDoc.uploaded_by, kind: 'lifecycle',
      text: `Signed paperwork emailed to ${to.length} recipient(s): ${to.join(', ')}.`,
    })

    // Storage cleanup, only when the owner has turned it on and only after Resend has
    // confirmed the send. The ticket_attachments ROWS stay — they are the record that the
    // paperwork arrived, and the app's own "awaiting paperwork" logic reads their
    // existence, not the bytes behind them. Only the bytes leave, freeing the bucket.
    const { data: org } = await db.from('org_defaults').select('paperwork_delete_after_email').eq('id', true).maybeSingle()
    if (org?.paperwork_delete_after_email) {
      await db.storage.from('attachments').remove([serviceTicket.path, jobLogDoc.path])
    }

    console.log(JSON.stringify({ fn: 'send-paperwork-email', outcome: 'sent', ticket: ticketId, to: to.length }))
    return json({ ok: true, sent: to.length, resend_id: (sendBody as { id?: string }).id ?? null })
  } catch (err) {
    await releaseClaim()
    const message = err instanceof Error ? err.message : String(err)
    // supabase-js's query builder is thenable, not a real Promise — it has no .catch()
    // of its own, so chaining one throws instead of swallowing the failure it was meant
    // to swallow. A plain try/catch is the only safe way to make this best-effort.
    try {
      await db.from('audit_log').insert({
        ticket_id: ticketId, changed_by: jobLogDoc.uploaded_by, kind: 'lifecycle',
        text: `Signed paperwork email FAILED to send: ${message}`,
      })
    } catch { /* best-effort — the failure itself is still returned below */ }
    console.log(JSON.stringify({ fn: 'send-paperwork-email', outcome: 'failed', ticket: ticketId, error: message }))
    return json({ error: message }, 500)
  }
})
