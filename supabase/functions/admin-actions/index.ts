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

// The seeded first Admin. Permanently un-disableable, by design rather than by
// convention: it is the account that can rescue every other one, and an office
// that locks itself out has no way back in.
const MASTER_ADMIN_EMAIL = 'lateri@makaman.ly'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace('Bearer ', '')
  if (!jwt) return json({ error: 'Missing Authorization header.' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Re-derive the caller's identity from their own JWT — never trust the body.
  const { data: callerUser, error: callerErr } = await admin.auth.getUser(jwt)
  if (callerErr || !callerUser?.user) return json({ error: 'Invalid session.' }, 401)
  const callerId = callerUser.user.id

  const { data: callerProfile, error: profileErr } = await admin
    .from('profiles')
    .select('role, status')
    .eq('id', callerId)
    .single()
  if (profileErr || !callerProfile) return json({ error: 'Caller profile not found.' }, 403)

  const isStaff = ['ops_manager', 'admin'].includes(callerProfile.role) && callerProfile.status === 'active'
  const isAdmin = callerProfile.role === 'admin' && callerProfile.status === 'active'

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }
  const action = body.action as string

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

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (createErr) throw createErr

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
      const held: string[] = []
      const countIn = async (table: string, column: string, label: string) => {
        const { count } = await admin.from(table).select('*', { count: 'exact', head: true }).eq(column, userId)
        if (count && count > 0) held.push(`${count} ${label}`)
      }
      await countIn('tickets', 'technician_id', 'ticket(s) as the technician')
      await countIn('tickets', 'holder_id', 'ticket(s) they hold')
      await countIn('tickets', 'approved_by', 'ticket(s) they approved')
      await countIn('tickets', 'closed_by', 'ticket(s) they closed')
      await countIn('ticket_crew', 'profile_id', 'job(s) they were crewed on')
      await countIn('audit_log', 'changed_by', 'audit entries')
      await countIn('ticket_lines', 'edited_by', 'edited job-log line(s)')
      await countIn('ticket_notes', 'raised_by', 'note(s) raised')
      await countIn('ticket_attachments', 'uploaded_by', 'attachment(s)')

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
