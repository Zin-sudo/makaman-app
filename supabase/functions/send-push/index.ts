// Delivers a push notification for one of the small, high-signal set of events the owner
// chose (0058): a ticket approved or sent back for changes, a job ready for the office to
// review, a note raised on a job someone is on or answered on a note they raised. Every
// other in-app event stays an in-app toast — this function only ever fires for those five.
//
// Auth follows the same shape send-paperwork-email settled on (0051/0052): a single-use
// nonce this database minted for itself, not a copy of any credential to keep in step.
// verify_jwt is off at the platform level for exactly that reason — there is no
// Authorization header to check, only the nonce.
//
// The actual Web Push send (RFC 8291 message encryption, RFC 8292 VAPID auth) is
// @negrel/webpush's job, not this file's — it is a Deno-native, Web Crypto implementation
// with no Node-compat shim to go wrong, unlike importing the npm `web-push` package
// through esm.sh would be. The VAPID key pair it needs is JWK, not the raw base64url pair
// the `web-push` CLI would have produced — see get_push_vapid_private_key()'s own secret,
// which was generated with this library's own generateVapidKeys()/exportVapidKeys() for
// exactly that reason.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import * as webpush from 'jsr:@negrel/webpush@0.5.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const NONCE_MAX_AGE_MS = 2 * 60 * 1000
const CONTACT_EMAIL = 'mailto:tickets@makaman.ly'

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-push-nonce',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function callerIsAllowed(req: Request): Promise<{ ok: boolean; why: string }> {
  const nonce = req.headers.get('x-push-nonce')
  if (!nonce) return { ok: false, why: 'Missing nonce.' }

  const { data: row } = await db
    .from('push_notification_nonces').select('nonce, created_at').eq('nonce', nonce).maybeSingle()
  if (!row) return { ok: false, why: 'That request was not recognised.' }

  // Consumed whether or not it turns out to be fresh, so a leaked nonce is worth one
  // attempt at most.
  await db.from('push_notification_nonces').delete().eq('nonce', nonce)

  const age = Date.now() - new Date(row.created_at as string).getTime()
  if (age > NONCE_MAX_AGE_MS) return { ok: false, why: 'That request expired.' }
  return { ok: true, why: 'trigger' }
}

// Built once per warm isolate, not once per request — the key pair the Vault holds does
// not change between calls, and importVapidKeys() is the one part of this function too
// expensive to redo for every subscription on every send.
let appServerPromise: Promise<webpush.ApplicationServer> | null = null
function getAppServer(): Promise<webpush.ApplicationServer> {
  if (!appServerPromise) {
    appServerPromise = (async () => {
      const { data: raw, error } = await db.rpc('get_push_vapid_private_key')
      if (error || !raw) throw new Error(`Could not read the VAPID key pair from the Vault: ${error?.message ?? 'not set'}`)
      const exported = JSON.parse(raw as string) as webpush.ExportedVapidKeys
      const vapidKeys = await webpush.importVapidKeys(exported, { extractable: false })
      return webpush.ApplicationServer.new({ contactInformation: CONTACT_EMAIL, vapidKeys })
    })()
  }
  return appServerPromise
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const who = await callerIsAllowed(req)
  if (!who.ok) return json({ error: who.why }, 401)

  let userId: string, title: string, body: string, url: string
  try {
    const b = await req.json()
    userId = b.user_id
    title = b.title
    body = b.body
    url = b.url ?? '/'
    if (!userId || !title) throw new Error('missing user_id or title')
  } catch {
    return json({ error: 'Bad request body.' }, 400)
  }

  const { data: subs, error: subsErr } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)
  if (subsErr) return json({ error: subsErr.message }, 500)
  if (!subs || !subs.length) return json({ ok: true, skipped: 'no subscriptions for this user' })

  let appServer: webpush.ApplicationServer
  try {
    appServer = await getAppServer()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.log(JSON.stringify({ fn: 'send-push', outcome: 'failed', stage: 'vapid', error: message }))
    return json({ error: message }, 500)
  }

  const payload = JSON.stringify({ title, body, url })
  const gone: string[] = []
  let sent = 0
  const failures: string[] = []

  await Promise.all(subs.map(async (s) => {
    const subscriber = appServer.subscribe({
      endpoint: s.endpoint,
      keys: { p256dh: s.p256dh, auth: s.auth },
    })
    try {
      await subscriber.pushTextMessage(payload, { urgency: webpush.Urgency.Normal, ttl: 24 * 60 * 60 })
      sent++
    } catch (err) {
      // A push service saying the subscription is gone (410) or was never found (404,
      // used interchangeably with 410 by some services) means the browser dropped it —
      // the person unsubscribed, cleared site data, or uninstalled the PWA. Nothing will
      // ever revive that endpoint, so it is pruned rather than retried forever.
      if (err instanceof webpush.PushMessageError && (err.isGone() || err.response.status === 404)) {
        gone.push(s.id as string)
      } else {
        const message = err instanceof Error ? err.toString() : String(err)
        failures.push(message)
      }
    }
  }))

  if (gone.length) await db.from('push_subscriptions').delete().in('id', gone)

  console.log(JSON.stringify({
    fn: 'send-push', outcome: sent ? 'sent' : 'failed', user: userId,
    sent, pruned: gone.length, failed: failures.length,
  }))

  if (!sent && failures.length) return json({ error: failures.join('; ') }, 502)
  return json({ ok: true, sent, pruned: gone.length })
})
