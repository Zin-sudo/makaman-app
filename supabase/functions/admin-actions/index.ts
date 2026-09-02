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
    if (action === 'set_user_status') {
      if (!isAdmin) return json({ error: 'Only Admin can disable or restore an account.' }, 403)
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
    // sets one and tells him. Admin only, and never for the master Admin account — that
    // one is recovered by mail or not at all, because an account that can be given a new
    // password by anybody holding this endpoint is an account with no owner.
    if (action === 'set_password') {
      if (!isAdmin) return json({ error: 'Only Admin can set another account\'s password.' }, 403)
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

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
