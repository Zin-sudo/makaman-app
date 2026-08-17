import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../context/SettingsContext'
import { formatDateTime } from '../../lib/format'
import EditableStamp from './EditableStamp'
import TopBar from '../TopBar'

export default function TicketReview() {
  const { ticketId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { settings } = useSettings()

  const [ticket, setTicket] = useState(null)
  const [lines, setLines] = useState([])
  const [items, setItems] = useState([])
  const [clients, setClients] = useState([])
  const [jobTypes, setJobTypes] = useState([])
  const [priceList, setPriceList] = useState([])
  const [numberError, setNumberError] = useState('')
  const [newItemNumber, setNewItemNumber] = useState('')

  const load = useCallback(async () => {
    const [{ data: t }, { data: l }, { data: it }, { data: cl }, { data: jt }] = await Promise.all([
      supabase.from('tickets').select('*, profiles:technician_id(full_name)').eq('id', ticketId).single(),
      supabase.from('ticket_lines').select('*').eq('ticket_id', ticketId).order('logged_at', { ascending: true }),
      supabase.from('ticket_items').select('*').eq('ticket_id', ticketId).order('sort_order', { ascending: true }),
      supabase.from('clients').select('*').order('name'),
      supabase.from('job_types').select('*').order('name'),
    ])
    setTicket(t)
    setLines(l || [])
    setItems(it || [])
    setClients(cl || [])
    setJobTypes(jt || [])
  }, [ticketId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!ticket?.client_id) { setPriceList([]); return }
    supabase.from('price_list_items').select('*').eq('client_id', ticket.client_id).then(({ data }) => setPriceList(data || []))
  }, [ticket?.client_id])

  async function logAudit(field, oldValue, newValue, note = null) {
    await supabase.from('audit_log').insert({
      ticket_id: ticketId,
      field,
      old_value: oldValue != null ? String(oldValue) : null,
      new_value: newValue != null ? String(newValue) : null,
      changed_by: user.id,
      note,
    })
  }

  async function updateTicketField(field, value) {
    const oldValue = ticket[field]
    const { error } = await supabase.from('tickets').update({ [field]: value }).eq('id', ticketId)
    if (error) return
    await logAudit(field, oldValue, value)
    setTicket((prev) => ({ ...prev, [field]: value }))
  }

  async function onTicketNumberBlur(value) {
    if (!value) return
    const { data } = await supabase.from('tickets').select('id').eq('ticket_number', value).neq('id', ticketId).maybeSingle()
    setNumberError(data ? 'This ticket number is already in use.' : '')
  }

  // Ticket-level stamps: Arrival / Start Job / End Job.
  async function saveTicketStamp(field, newIso) {
    await updateTicketField(field, newIso)
  }

  // Job-log line stamps: the individual timestamp on each logged event line.
  // Confirmed in scope alongside the ticket-level stamps — same audit trail.
  async function saveLineStamp(line, newIso) {
    const { error } = await supabase
      .from('ticket_lines')
      .update({ logged_at: newIso, edited_by: user.id, edited_at: new Date().toISOString() })
      .eq('id', line.id)
    if (error) return
    await logAudit('ticket_line.logged_at', line.logged_at, newIso, `line: "${line.text.slice(0, 60)}"`)
    setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, logged_at: newIso, edited_by: user.id } : l)))
  }

  function onAddItemLookup() {
    const found = priceList.find((p) => p.item_number === newItemNumber.trim())
    const draft = found
      ? {
          item_number: found.item_number,
          description: found.description,
          uom: found.uom,
          unit_cost: found.unit_cost,
          qty: 1,
          _additionalDayCost: found.unit_cost_additional,
          _currency: found.currency,
        }
      : { item_number: newItemNumber.trim(), description: '', uom: '', unit_cost: 0, qty: 1 }
    setItems((prev) => [...prev, { ...draft, _new: true, sort_order: prev.length }])
    setNewItemNumber('')
  }

  async function persistItem(idx) {
    const item = items[idx]
    const total_cost = Number(item.qty || 0) * Number(item.unit_cost || 0)
    const payload = {
      ticket_id: ticketId,
      item_number: item.item_number,
      description: item.description,
      qty: item.qty,
      uom: item.uom,
      unit_cost: item.unit_cost,
      total_cost,
      sort_order: idx,
    }
    if (item.id) {
      await supabase.from('ticket_items').update(payload).eq('id', item.id)
    } else {
      const { data } = await supabase.from('ticket_items').insert(payload).select().single()
      setItems((prev) => prev.map((it, i) => (i === idx ? { ...data } : it)))
      return
    }
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, total_cost } : it)))
  }

  function updateItemField(idx, field, value) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
  }

  async function removeItem(idx) {
    const item = items[idx]
    if (item.id) await supabase.from('ticket_items').delete().eq('id', item.id)
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  if (!ticket) return null

  const checks = {
    numberSet: !!ticket.ticket_number && !numberError,
    mileageSet: ticket.mileage_one_way != null && ticket.mileage_one_way > 0,
    jobTypeSet: !!ticket.job_type_id,
    hasItems: items.length > 0,
  }
  const allChecksPass = Object.values(checks).every(Boolean)
  const roundTripMileage = ticket.mileage_one_way ? Number(ticket.mileage_one_way) * 2 : 0

  async function onApprove() {
    if (!allChecksPass) return
    const { error } = await supabase
      .from('tickets')
      .update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() })
      .eq('id', ticketId)
    if (!error) {
      await logAudit('status', ticket.status, 'approved')
      navigate(`/ops/ticket/${ticketId}/print`)
    }
  }

  return (
    <div>
      <TopBar title="Ticket Review" />
      <div className="page page-wide stack">
        <div className="row-between">
          <h2 style={{ margin: 0 }}>{ticket.customer || 'Untitled ticket'}</h2>
          <span className="badge accent">{ticket.status}</span>
        </div>
        <div className="small muted">Technician: {ticket.profiles?.full_name}</div>

        <div className="row wrap" style={{ gap: '2rem' }}>
          {/* Left: header, stamps, job log */}
          <div className="stack" style={{ flex: 2, minWidth: 320 }}>
            <div className="card stack">
              <strong>Details</strong>
              <div className="small muted">Field: {ticket.field_name} · Well: {ticket.well_no} · Rig: {ticket.rig_name}</div>
              {ticket.ops_location_note && <div className="small muted">Location note: {ticket.ops_location_note}</div>}
              <div className="stack">
                <EditableStamp label="Arrival" value={ticket.arrival_at} onSave={(iso) => saveTicketStamp('arrival_at', iso)} />
                <EditableStamp label="Start Job" value={ticket.start_job_at} onSave={(iso) => saveTicketStamp('start_job_at', iso)} />
                <EditableStamp label="End Job" value={ticket.end_job_at} onSave={(iso) => saveTicketStamp('end_job_at', iso)} />
              </div>
            </div>

            <div className="card stack">
              <strong>Job Log</strong>
              <p className="small muted" style={{ marginTop: -8 }}>
                Every line's timestamp can be corrected here, same as the ticket-level stamps — each edit is recorded in the audit trail.
              </p>
              {lines.length === 0 && <p className="muted small">No log lines.</p>}
              {lines.map((l) => (
                <div className="log-line" key={l.id}>
                  <EditableStamp value={l.logged_at} onSave={(iso) => saveLineStamp(l, iso)} />
                  <span>{l.text}</span>
                  <span>{l.edited_by && <span className="badge warning small">edited</span>}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: assignment + items + checklist */}
          <div className="stack" style={{ flex: 1, minWidth: 300 }}>
            <div className="card stack">
              <strong>Assignment</strong>
              <div className="field">
                <label>Ticket Number</label>
                <input
                  value={ticket.ticket_number || ''}
                  onChange={(e) => setTicket((prev) => ({ ...prev, ticket_number: e.target.value }))}
                  onBlur={(e) => { updateTicketField('ticket_number', e.target.value); onTicketNumberBlur(e.target.value) }}
                />
                {numberError && <div className="error-text">{numberError}</div>}
              </div>
              <div className="field">
                <label>Client (for price list)</label>
                <select value={ticket.client_id || ''} onChange={(e) => updateTicketField('client_id', e.target.value || null)}>
                  <option value="">—</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Job Type</label>
                <select value={ticket.job_type_id || ''} onChange={(e) => updateTicketField('job_type_id', e.target.value || null)}>
                  <option value="">—</option>
                  {jobTypes.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Mileage — one way (charged round trip)</label>
                <input
                  type="number" min="0" step="0.1"
                  value={ticket.mileage_one_way || ''}
                  onChange={(e) => setTicket((prev) => ({ ...prev, mileage_one_way: e.target.value }))}
                  onBlur={(e) => updateTicketField('mileage_one_way', Number(e.target.value) || null)}
                />
                <div className="small muted">Round trip: {roundTripMileage} mi/km</div>
              </div>
            </div>

            <div className="card stack">
              <strong>Charged Items</strong>
              <table>
                <thead><tr><th>#</th><th>Desc</th><th>Qty</th><th>UoM</th><th>Cost</th><th>Total</th><th /></tr></thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={it.id || idx}>
                      <td><input style={{ width: 70 }} value={it.item_number} onChange={(e) => updateItemField(idx, 'item_number', e.target.value)} onBlur={() => persistItem(idx)} /></td>
                      <td>
                        <input value={it.description} onChange={(e) => updateItemField(idx, 'description', e.target.value)} onBlur={() => persistItem(idx)} />
                        {it._additionalDayCost != null && (
                          <div className="small muted">
                            {it._currency || 'USD'} {it._additionalDayCost} after first day — add a 2nd line if this ran longer
                          </div>
                        )}
                      </td>
                      <td><input type="number" style={{ width: 60 }} value={it.qty} onChange={(e) => updateItemField(idx, 'qty', e.target.value)} onBlur={() => persistItem(idx)} /></td>
                      <td><input style={{ width: 60 }} value={it.uom} onChange={(e) => updateItemField(idx, 'uom', e.target.value)} onBlur={() => persistItem(idx)} /></td>
                      <td><input type="number" style={{ width: 70 }} value={it.unit_cost} onChange={(e) => updateItemField(idx, 'unit_cost', e.target.value)} onBlur={() => persistItem(idx)} /></td>
                      <td className="mono">{(Number(it.qty || 0) * Number(it.unit_cost || 0)).toFixed(2)}</td>
                      <td><button className="ghost" onClick={() => removeItem(idx)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row">
                <input placeholder="Item number…" value={newItemNumber} onChange={(e) => setNewItemNumber(e.target.value)} />
                <button className="secondary" onClick={onAddItemLookup} style={{ whiteSpace: 'nowrap' }}>Add Item</button>
              </div>
            </div>

            <div className="card stack">
              <strong>Before Approve</strong>
              <div className={`checklist-item ${checks.numberSet ? 'ok' : 'pending'}`}>{checks.numberSet ? '✓' : '○'} Ticket number assigned &amp; unique</div>
              <div className={`checklist-item ${checks.mileageSet ? 'ok' : 'pending'}`}>{checks.mileageSet ? '✓' : '○'} Mileage entered</div>
              <div className={`checklist-item ${checks.jobTypeSet ? 'ok' : 'pending'}`}>{checks.jobTypeSet ? '✓' : '○'} Job type selected</div>
              <div className={`checklist-item ${checks.hasItems ? 'ok' : 'pending'}`}>{checks.hasItems ? '✓' : '○'} At least one charged item</div>
              <button disabled={!allChecksPass || ticket.status === 'approved'} onClick={onApprove}>
                {ticket.status === 'approved' ? 'Approved' : 'Approve'}
              </button>
              {ticket.status === 'approved' && (
                <button className="secondary" onClick={() => navigate(`/ops/ticket/${ticketId}/print`)}>View Print Sheets</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
