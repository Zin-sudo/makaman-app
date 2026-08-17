// Privileged user-management actions: approve a pending signup, create a
// technician account directly, or promote a user's role.
//
// Runs with the service-role key (bypasses RLS) — so it MUST re-derive the
// caller's identity from their own JWT and re-check their role on every
// action itself. Never trust a userId or role supplied in the request body
// for who is allowed to act; only for who is being acted upon.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})
