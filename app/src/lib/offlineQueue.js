// Offline-first ticket storage. Tickets (and their job-log lines) live in
// localStorage first; the technician works fully offline and presses Sync
// to push anything dirty up to Supabase when signal returns.

import { supabase } from './supabaseClient'

const STORE_KEY = 'makaman.tickets.v1'

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function writeStore(store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store))
}

export function listLocalTickets() {
  const store = readStore()
  return Object.values(store).sort((a, b) => (b.updated_local_at || '').localeCompare(a.updated_local_at || ''))
}

export function getLocalTicket(localId) {
  return readStore()[localId] || null
}

export function saveLocalTicket(ticket) {
  const store = readStore()
  ticket.updated_local_at = new Date().toISOString()
  ticket.dirty = true
  store[ticket.local_id] = ticket
  writeStore(store)
  return ticket
}

export function markSynced(localId, remoteId) {
  const store = readStore()
  if (store[localId]) {
    store[localId].dirty = false
    store[localId].remote_id = remoteId
    writeStore(store)
  }
}

export function newLocalId() {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// Pushes every dirty local ticket to Supabase. Returns { synced, failed }.
export async function syncAll(userId) {
  const store = readStore()
  const dirty = Object.values(store).filter((t) => t.dirty)
  let synced = 0
  const failed = []

  for (const ticket of dirty) {
    try {
      const payload = {
        id: ticket.remote_id || undefined,
        technician_id: userId,
        customer: ticket.customer,
        field_name: ticket.field_name,
        well_no: ticket.well_no,
        rig_name: ticket.rig_name,
        arrival_at: ticket.arrival_at,
        start_job_at: ticket.start_job_at,
        end_job_at: ticket.end_job_at,
        status: ticket.end_job_at ? 'done' : 'open',
        ops_location_note: ticket.ops_location_note || null,
      }

      const { data: savedTicket, error: ticketErr } = await supabase
        .from('tickets')
        .upsert(payload, { onConflict: 'id' })
        .select()
        .single()
      if (ticketErr) throw ticketErr

      if (ticket.lines?.length) {
        const linePayload = ticket.lines.map((l) => ({
          id: l.remote_id || undefined,
          ticket_id: savedTicket.id,
          logged_at: l.logged_at,
          text: l.text,
        }))
        const { error: linesErr } = await supabase.from('ticket_lines').upsert(linePayload, { onConflict: 'id' })
        if (linesErr) throw linesErr
      }

      markSynced(ticket.local_id, savedTicket.id)
      synced += 1
    } catch (err) {
      failed.push({ ticket, error: err.message || String(err) })
    }
  }

  return { synced, failed }
}
