// Privileged user-management actions: approve a pending signup, create a
// technician account directly, promote a user's role, withdraw access, set
// somebody's password, or delete an account that has never been used.
//
// Runs with the service-role key (bypasses RLS) — so it MUST re-derive the
// caller's identity from their own JWT and re-check their role on every
// action itself. Never trust a userId or role supplied in the request body
// for who is allowed to act; only for who is being acted upon.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Built once, at module scope, not per request.
//
// Deno Deploy keeps an isolate warm between invocations, so anything at module scope
// survives to the next call. Creating the client inside the handler rebuilt it — and the
// object it hands back is a stateless REST wrapper with a connection pool behind it, so
// rebuilding it threw away warm connections along with it. Nothing about it is per-caller:
// the caller's identity is derived from their own JWT below, never from this client.
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Identity, cached. Authority, never.
//
// Checking who is calling costs two round trips: one to the auth server to validate the
// token, one to Postgres for their role. Only the first of those is cacheable, and the
// distinction is the whole point of this being safe:
//
//   · WHO a token belongs to cannot change. A JWT is signed; the subject inside it is
//     fixed for the life of the token. Asking the auth server the same question about the
//     same string twice in one minute gets the same answer both times.
//   · WHAT they are allowed to do changes all the time — a promotion, a withdrawal, an
//     account disabled thirty seconds ago. That is read from `profiles` on EVERY request,
//     cache or no cache, because a stale answer there is a security hole rather than a
//     slow page.
//
// Keyed on a hash of the token, so the isolate is not left holding a pile of live
// credentials in memory. Entries expire at 60 seconds or at the token's own expiry,
// whichever comes first, and the map is swept rather than allowed to grow.
const IDENTITY_TTL_MS = 60_000
const identityCache = new Map<string, { id: string; email: string; until: number }>()

async function tokenKey(jwt: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(jwt))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// SHA-256 hex of a plain string — used for the purge confirmation code below. Same shape
// as tokenKey() just above, generalized to any input rather than only a JWT.
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
// Constant-time compare — a hash mismatch on the purge code must not be distinguishable
// by timing from a near-miss, the same reasoning any credential check follows.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
// The token's own expiry, read from the payload WITHOUT trusting it for anything else.
// It is only ever used to shorten the cache lifetime, never to lengthen it and never to
// decide who somebody is — the signature check that establishes that is done by the auth
// server on the first call, which is exactly the call being cached.
function tokenExpiryMs(jwt: string): number {
  try {
    const part = jwt.split('.')[1]
    if (!part) return 0
    const payload = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = JSON.parse(payload).exp
    return typeof exp === 'number' ? exp * 1000 : 0
  } catch { return 0 }
}
async function identify(jwt: string): Promise<{ id: string; email: string } | null> {
  const now = Date.now()
  const key = await tokenKey(jwt)
  const hit = identityCache.get(key)
  if (hit && hit.until > now) return { id: hit.id, email: hit.email }

  const { data, error } = await admin.auth.getUser(jwt)
  if (error || !data?.user) { identityCache.delete(key); return null }

  // Swept on write rather than on a timer: a timer keeps the isolate alive, and there is
  // never enough in here to be worth more than a linear pass.
  if (identityCache.size > 200) {
    for (const [k, v] of identityCache) if (v.until <= now) identityCache.delete(k)
  }
  const exp = tokenExpiryMs(jwt)
  const until = exp ? Math.min(now + IDENTITY_TTL_MS, exp) : now + IDENTITY_TTL_MS
  identityCache.set(key, { id: data.user.id, email: data.user.email ?? '', until })
  return { id: data.user.id, email: data.user.email ?? '' }
}

// The seeded first Admin. Permanently un-disableable, by design rather than by
// convention: it is the account that can rescue every other one, and an office
// that locks itself out has no way back in.
const MASTER_ADMIN_EMAIL = 'lateri@makaman.ly'

// The purge tool below (request_purge_code / purge_test_tickets). Owner's own words,
// 2026-09-10: "make the purge a feature where the admin needs to input his password to
// activate it. And input a verification code that arrives to his email as a must. To
// activate again if necessary." A real step-up re-authentication, not a second checkbox —
// see migration 0073 for the table this reads and writes.
const PURGE_CONFIRM_PHRASE = 'DELETE ALL TICKETS'
const PURGE_CODE_TTL_MS = 10 * 60 * 1000
const RESEND_FROM = 'tickets@makaman.ly'
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // The preflight answers before anything else is touched — no client, no auth, no
  // database. A browser sends one of these ahead of every cross-origin POST, so it is
  // half of all traffic here and none of it needs to know who is asking.
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Timing, so a claim about this being fast can be checked rather than believed. The
  // header is for the browser (the app logs anything over a second); the log line is for
  // the Logs Explorer, as JSON so it can be queried rather than grepped.
  const t0 = performance.now()
  const at = (): number => Math.round(performance.now() - t0)
  let tAuth = 0, tRole = 0, action = ''
  // Every exit goes through here, so the timing line cannot be forgotten on the one path
  // that turns out to matter — and there are thirty-odd of them.
  const json = (body: unknown, status = 200) => {
    const total = at()
    console.log(JSON.stringify({
      fn: 'admin-actions', action: action || '(none)', status,
      total_ms: total, auth_ms: tAuth, role_ms: tRole,
      // A warm isolate answers identity from memory; a cold one pays the auth round trip.
      // Which of the two happened is the single most useful thing in this line.
      identity: tAuth && tAuth < 5 ? 'cached' : 'fetched',
    }))
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Response-Time': total + 'ms' },
    })
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace('Bearer ', '')
  if (!jwt) return json({ error: 'Missing Authorization header.' }, 401)

  // Re-derive the caller's identity from their own JWT — never trust the body.
  const caller = await identify(jwt)
  tAuth = at()
  if (!caller) return json({ error: 'Invalid session.' }, 401)
  const callerId = caller.id

  // Read fresh every time. See identify(): identity is cached, authority is not.
  const { data: callerProfile, error: profileErr } = await admin
    .from('profiles')
    .select('role, status')
    .eq('id', callerId)
    .single()
  tRole = at() - tAuth
  if (profileErr || !callerProfile) return json({ error: 'Caller profile not found.' }, 403)

  const isStaff = ['ops_manager', 'admin'].includes(callerProfile.role) && callerProfile.status === 'active'
  const isAdmin = callerProfile.role === 'admin' && callerProfile.status === 'active'

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }
  action = body.action as string

  try {
    if (action === 'approve_signup') {
      if (!isStaff) return json({ error: 'Only Ops Manager or Admin can approve signups.' }, 403)
      const userId = body.userId as string
      if (!userId) return json({ error: 'userId is required.' }, 400)
      const { error } = await admin.from('profiles').update({ role: 'technician', status: 'active' }).eq('id', userId)
      if (error) throw error
      return json({ ok: true })
    }

    if (action === 'create_technician') {
      if (!isStaff) return json({ error: 'Only Ops Manager or Admin can create technician accounts.' }, 403)
      const email = (body.email as string || '').trim()
      const password = body.password as string
      const fullName = body.full_name as string
      if (!email || !password) return json({ error: 'email and password are required.' }, 400)

      // The office announces who it is expecting BEFORE creating them.
      //
      // handle_new_user refuses any address outside @makaman.ly and caps unapproved
      // sign-ups at five; this is what exempts the office. It used to be the
      // `created_by_office` flag below on its own, and that flag is only read correctly if
      // GoTrue puts custom app_metadata in the INSERT the trigger fires on rather than in a
      // follow-up write. A probe against the live database proved the failure that
      // assumption allows: with five sign-ups pending and the flag not yet written, the
      // office's own account was refused — on trial morning, in the one path with no
      // workaround.
      //
      // So the exemption no longer depends on GoTrue's ordering. This row is written by us,
      // with the service-role key, in a request that has already re-derived the caller from
      // their own JWT and required ops_manager or admin. The trigger consumes it. A client
      // cannot forge one: office_invites has RLS on and no policies, so anon and
      // authenticated reach nothing, and only the service role can write.
      //
      // The app_metadata flag stays as a second path — free if GoTrue does write it in the
      // insert. Neither is load-bearing alone, which is the point.
      const { error: inviteErr } = await admin
        .from('office_invites')
        .upsert({ email: email.toLowerCase(), invited_by: callerId }, { onConflict: 'email' })
      if (inviteErr) throw inviteErr

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
        app_metadata: { created_by_office: true },
      })
      // A note left behind by a failed createUser is worthless — the trigger ignores
      // anything older than five minutes — but clearing it keeps the table empty rather
      // than relying on that.
      if (createErr) {
        // try/catch rather than .catch(): the query builder is PromiseLike, not a Promise,
        // so it has then() and may not have catch(), and a missing method here would
        // replace a useful createUser error with a TypeError about the cleanup.
        try {
          await admin.from('office_invites').delete().eq('email', email.toLowerCase())
        } catch { /* the trigger ignores a note older than five minutes anyway */ }
        throw createErr
      }

      // The on_auth_user_created trigger already inserted a pending technician
      // profile row — just activate it.
      const { error: activateErr } = await admin
        .from('profiles')
        .update({ role: 'technician', status: 'active', full_name: fullName })
        .eq('id', created.user.id)
      if (activateErr) throw activateErr

      return json({ ok: true, userId: created.user.id })
    }

    if (action === 'promote_role') {
      if (!isAdmin) return json({ error: 'Only Admin can change roles.' }, 403)
      const userId = body.userId as string
      const role = body.role as string
      if (!userId || !['technician', 'ops_manager', 'admin', 'founder'].includes(role)) {
        return json({ error: 'userId and a valid role are required.' }, 400)
      }
      const { error } = await admin.from('profiles').update({ role }).eq('id', userId)
      if (error) throw error
      return json({ ok: true })
    }

    // Withdrawing access, and restoring it. Deliberately NOT a delete: ticket and
    // audit foreign keys are NO ACTION and would refuse for anyone who has worked,
    // and ticket_crew is CASCADE and would erase who was on a job. The row stays;
    // only the ability to sign in changes.
    //
    // 2026-09-11, owner's request: "allow the ops to adopt the disable / reset password
    // same as the admin." isStaff (ops_manager or admin), not isAdmin — matching
    // migration 0076's widened user.disable default_roles. This is the check that
    // actually decides it; the client's own hasPermission('user.disable') only decides
    // whether the button is drawn (CLAUDE.md: "hiding a button is not a check").
    if (action === 'set_user_status') {
      if (!isStaff) return json({ error: 'Only Ops Manager or Admin can disable or restore an account.' }, 403)
      const userId = body.userId as string
      const status = body.status as string
      if (!userId || !['active', 'disabled'].includes(status)) {
        return json({ error: 'userId and a status of active or disabled are required.' }, 400)
      }

      // Both guards re-checked here rather than trusted from the UI. The client
      // hides these buttons; hiding a button is not a permission check.
      if (userId === callerId) {
        return json({ error: 'You cannot disable your own account.' }, 400)
      }

      const { data: target, error: targetErr } = await admin
        .from('profiles').select('email, status').eq('id', userId).single()
      if (targetErr || !target) return json({ error: 'That account does not exist.' }, 404)

      if (status === 'disabled'
        && (target.email || '').toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase()) {
        return json({ error: 'The master Admin account cannot be disabled.' }, 400)
      }

      const { error } = await admin.from('profiles').update({ status }).eq('id', userId)
      if (error) throw error

      // Signing out is not enough on its own — a disabled account is refused at
      // sign-in — but it ends any session they already hold rather than letting it
      // run until the token expires.
      if (status === 'disabled') {
        await admin.auth.admin.signOut(userId, 'global').catch(() => {})
      }

      return json({ ok: true })
    }

    // Setting somebody else's password.
    //
    // For the case the reset mail cannot cover: a technician whose company address does
    // not reach him at a wellhead, or who cannot get into the mailbox at all. The office
    // sets one and tells him. 2026-09-11, owner's request: Ops Manager or Admin now,
    // matching set_user_status above and migration 0076's widened user.disable — but
    // never for the master Admin account regardless of who is asking, because an
    // account that can be given a new password by anybody holding this endpoint is an
    // account with no owner; that one is recovered by mail or not at all.
    if (action === 'set_password') {
      if (!isStaff) return json({ error: 'Only Ops Manager or Admin can set another account\'s password.' }, 403)
      const userId = body.userId as string
      const password = body.password as string
      if (!userId || typeof password !== 'string' || password.length < 8) {
        return json({ error: 'userId and a password of at least 8 characters are required.' }, 400)
      }
      const { data: target, error: targetErr } = await admin
        .from('profiles').select('email').eq('id', userId).single()
      if (targetErr || !target) return json({ error: 'That account does not exist.' }, 404)
      if ((target.email || '').toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase()) {
        return json({ error: 'The master Admin password cannot be set from here.' }, 400)
      }
      const { error } = await admin.auth.admin.updateUserById(userId, { password })
      if (error) throw error
      // Any session they hold was opened with the old password.
      await admin.auth.admin.signOut(userId, 'global').catch(() => {})
      return json({ ok: true })
    }

    // Deleting an account outright.
    //
    // Only for an account that has never done anything — a typo, a duplicate, a test
    // login. Anyone who has worked is refused, and that is not caution: tickets,
    // audit_log, ticket_lines, ticket_notes and ticket_attachments all point at profiles
    // with NO ACTION, so the delete would be refused by the database anyway, while
    // ticket_crew is CASCADE and WOULD succeed — quietly erasing who was on a job. The
    // record of who did the work is the one thing this app exists to keep.
    //
    // So the check is done first, by name, and the refusal says what to do instead.
    if (action === 'delete_user') {
      if (!isAdmin) return json({ error: 'Only Admin can delete an account.' }, 403)
      const userId = body.userId as string
      if (!userId) return json({ error: 'userId is required.' }, 400)
      if (userId === callerId) return json({ error: 'You cannot delete your own account.' }, 400)

      const { data: target, error: targetErr } = await admin
        .from('profiles').select('email, full_name').eq('id', userId).single()
      if (targetErr || !target) return json({ error: 'That account does not exist.' }, 404)
      if ((target.email || '').toLowerCase() === MASTER_ADMIN_EMAIL.toLowerCase()) {
        return json({ error: 'The master Admin account cannot be deleted.' }, 400)
      }

      // Every place a person leaves a mark. Counted rather than assumed, so the message
      // can say which ones and the admin can go and look.
      //
      // All nine at once. They were nine sequential awaits — nine round trips before the
      // admin learned whether one button had worked, and not one of them depended on the
      // one before it. The order of the RESULTS still matters, because the refusal reads
      // as a sentence, so they are declared in order and gathered in order; only the
      // waiting is shared.
      const PLACES: Array<[string, string, string]> = [
        ['tickets', 'technician_id', 'ticket(s) as the technician'],
        ['tickets', 'holder_id', 'ticket(s) they hold'],
        ['tickets', 'approved_by', 'ticket(s) they approved'],
        ['tickets', 'closed_by', 'ticket(s) they closed'],
        ['ticket_crew', 'profile_id', 'job(s) they were crewed on'],
        ['audit_log', 'changed_by', 'audit entries'],
        ['ticket_lines', 'edited_by', 'edited job-log line(s)'],
        ['ticket_notes', 'raised_by', 'note(s) raised'],
        ['ticket_attachments', 'uploaded_by', 'attachment(s)'],
      ]
      const counted = await Promise.all(PLACES.map(([table, column, label]) =>
        admin.from(table).select('*', { count: 'exact', head: true }).eq(column, userId)
          .then(({ count }: { count: number | null }) =>
            (count && count > 0) ? `${count} ${label}` : '')))
      const held = counted.filter(Boolean)

      if (held.length) {
        return json({
          error: `${target.full_name || target.email} has work on the record — ${held.join(', ')}. `
            + 'Deleting the account would take that with it. Disable it instead: they can no longer '
            + 'sign in, and everything they did stays where it is.',
        }, 409)
      }

      // Nothing attached. Deleting the auth user removes the profile with it.
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) throw error
      return json({ ok: true })
    }

    // Step 1 of 2 for the purge tool: re-verify the admin's own password right now, and if
    // it's correct, email a one-time code to their own registered address.
    //
    // "Right now" is the whole point — a stolen or still-open browser tab already carries a
    // valid session, so the ordinary auth check above (which only proves the JWT is real)
    // proves nothing about who is at the keyboard this second. Re-running the actual
    // sign-in against Auth is what a step-up check means, so it is done with a throwaway
    // anon client rather than the service-role one already open above — the ANON_KEY client
    // asks GoTrue "is this the real password", the SERVICE_ROLE client could only ever
    // answer "does this user exist," which is not the question.
    if (action === 'request_purge_code') {
      if (!isAdmin) return json({ error: 'Only Admin can prepare a purge.' }, 403)
      const password = body.password as string
      if (typeof password !== 'string' || !password) {
        return json({ error: 'Your current password is required.' }, 400)
      }

      const stepUp = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { error: signInErr } = await stepUp.auth.signInWithPassword({
        email: caller.email, password,
      })
      // The session this just minted is never used for anything and never reaches the
      // client — signed straight back out so it doesn't sit as a live refresh token nobody
      // asked for.
      await stepUp.auth.signOut().catch(() => {})
      if (signInErr) return json({ error: 'That password is incorrect.' }, 401)

      // A random 6-digit code — crypto.getRandomValues, not Math.random, for the same
      // reason the numbering claim never trusts a client-supplied number: this one has to
      // actually be unguessable. Only its hash is ever stored; the code itself is never
      // written to the database and never returned in this response.
      const codeNum = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000
      const code = String(codeNum).padStart(6, '0')
      const codeHash = await sha256Hex(code)
      const now = Date.now()

      const { error: upsertErr } = await admin.from('purge_confirmation_codes').upsert({
        admin_id: callerId,
        code_hash: codeHash,
        requested_at: new Date(now).toISOString(),
        expires_at: new Date(now + PURGE_CODE_TTL_MS).toISOString(),
        used_at: null,
      }, { onConflict: 'admin_id' })
      if (upsertErr) throw upsertErr

      const { data: resendKey, error: keyErr } = await admin.rpc('get_paperwork_resend_key')
      if (keyErr || !resendKey) throw new Error(`Could not read the Resend key from the Vault: ${keyErr?.message ?? 'not set'}`)

      const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [caller.email],
          subject: 'Makaman: verification code to purge test tickets',
          html: `<p>A purge of every ticket on Makaman was just requested for this account.</p>`
            + `<p style="font-size:28px;font-weight:600;letter-spacing:0.08em">${code}</p>`
            + `<p>This code expires in 10 minutes and works once. If you did not request this, `
            + `sign in and change your password — someone else has it.</p>`,
        }),
      })
      const sendBody = await sendRes.json().catch(() => ({}))
      if (!sendRes.ok) throw new Error(`Resend refused the send: ${sendRes.status} ${JSON.stringify(sendBody)}`)

      return json({ ok: true })
    }

    // Step 2 of 2: the actual wipe. Requires everything request_purge_code minted, plus the
    // typed confirm phrase — three independent things (a live session, a password entered
    // seconds ago, a code that only reached one inbox) standing between this and every
    // ticket in the table.
    if (action === 'purge_test_tickets') {
      if (!isAdmin) return json({ error: 'Only Admin can purge test tickets.' }, 403)
      const confirm = body.confirm as string
      const code = (body.code as string || '').trim()
      if (confirm !== PURGE_CONFIRM_PHRASE) {
        return json({ error: `Type "${PURGE_CONFIRM_PHRASE}" exactly to confirm.` }, 400)
      }
      if (!/^\d{6}$/.test(code)) {
        return json({ error: 'Enter the 6-digit code that was emailed to you.' }, 400)
      }

      const { data: row, error: rowErr } = await admin
        .from('purge_confirmation_codes').select('code_hash, expires_at, used_at')
        .eq('admin_id', callerId).maybeSingle()
      if (rowErr) throw rowErr
      if (!row) {
        return json({ error: 'No verification code is on file. Request a new one first.' }, 400)
      }
      if (row.used_at) {
        return json({ error: 'That code has already been used. Request a new one.' }, 400)
      }
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return json({ error: 'That code has expired. Request a new one.' }, 400)
      }
      const codeHash = await sha256Hex(code)
      if (!timingSafeEqual(codeHash, row.code_hash)) {
        return json({ error: 'That code is incorrect.' }, 401)
      }

      // One use only, marked before the delete runs — matches "to activate again if
      // necessary": whether the delete below succeeds or fails, this exact code will not
      // work a second time, so the next attempt starts over from request_purge_code.
      const { error: usedErr } = await admin.from('purge_confirmation_codes')
        .update({ used_at: new Date().toISOString() }).eq('admin_id', callerId)
      if (usedErr) throw usedErr

      const { count, error: countErr } = await admin
        .from('tickets').select('*', { count: 'exact', head: true })
      if (countErr) throw countErr

      // Every ticket-child FK (ticket_lines, ticket_items, ticket_crew, ticket_assets,
      // ticket_attachments, ticket_notes, audit_log.ticket_id) is ON DELETE CASCADE from
      // tickets, confirmed live — this one delete cleans all of it. Neither this nor
      // anything above touches public.profiles, public.ticket_numbering, or any account;
      // deleting the now-unreferenced technician accounts is the existing delete_user
      // action, one press per account.
      const { error: deleteErr } = await admin
        .from('tickets').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      if (deleteErr) throw deleteErr

      return json({ ok: true, deletedCount: count ?? 0 })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
