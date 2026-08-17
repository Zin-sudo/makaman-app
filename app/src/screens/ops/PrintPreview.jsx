import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useSettings } from '../../context/SettingsContext'
import { formatDate, formatDateTime } from '../../lib/format'
import TopBar from '../TopBar'

const SHEETS = ['Service Ticket (Original)', 'Service Ticket (Copy)', 'Job Log (Original)', 'Job Log (Copy)']

// Layout preview only — no real .xlsx/PDF file is generated yet. Part B of the
// build (real template filling + download, per HANDOFF.md) needs the actual
// Service Ticket / Job Log workbook templates and price list before it can
// produce the four real sheets.
export default function PrintPreview() {
  const { ticketId } = useParams()
  const { settings } = useSettings()
  const [ticket, setTicket] = useState(null)
  const [lines, setLines] = useState([])
  const [items, setItems] = useState([])
  const [sheet, setSheet] = useState(SHEETS[0])

  useEffect(() => {
    Promise.all([
      supabase.from('tickets').select('*, profiles:technician_id(full_name), clients(name), job_types(name)').eq('id', ticketId).single(),
      supabase.from('ticket_lines').select('*').eq('ticket_id', ticketId).order('logged_at'),
      supabase.from('ticket_items').select('*').eq('ticket_id', ticketId).order('sort_order'),
    ]).then(([{ data: t }, { data: l }, { data: it }]) => {
      setTicket(t)
      setLines(l || [])
      setItems(it || [])
    })
  }, [ticketId])

  if (!ticket) return null
  const isServiceTicket = sheet.startsWith('Service Ticket')
  const total = items.reduce((sum, it) => sum + Number(it.total_cost || 0), 0)

  return (
    <div>
      <TopBar title="Print Preview" />
      <div className="page page-wide stack">
        <div className="row wrap">
          {SHEETS.map((s) => (
            <button key={s} className={sheet === s ? '' : 'secondary'} onClick={() => setSheet(s)}>{s}</button>
          ))}
        </div>
        <p className="small muted">
          Layout preview only — download of the real filled .xlsx/PDF template is not built yet (needs the template files, see HANDOFF.md Part B).
        </p>

        <div className="card" style={{ background: '#fff', color: '#111', maxWidth: 720, margin: '0 auto', padding: '2rem' }}>
          <div className="row-between" style={{ borderBottom: '2px solid #b91c1c', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
            <strong style={{ fontSize: '1.1rem' }}>{sheet}</strong>
            <span>Makaman Libya</span>
          </div>
          <table style={{ marginBottom: '1rem' }}>
            <tbody>
              <tr><td>Technician</td><td>{ticket.profiles?.full_name}</td><td>Customer</td><td>{ticket.customer}</td></tr>
              <tr><td>Field Name</td><td>{ticket.field_name}</td><td>Well No.</td><td>{ticket.well_no}</td></tr>
              <tr><td>Rig Name</td><td>{ticket.rig_name}</td><td>Ticket No.</td><td>{ticket.ticket_number}</td></tr>
              <tr><td>Start Job</td><td>{formatDate(ticket.start_job_at, settings)}</td><td>End Job</td><td>{formatDate(ticket.end_job_at, settings)}</td></tr>
              {!isServiceTicket && (
                <tr><td>Arrival</td><td>{formatDate(ticket.arrival_at, settings)}</td><td>Job Type</td><td>{ticket.job_types?.name || '—'}</td></tr>
              )}
            </tbody>
          </table>

          {isServiceTicket ? (
            <table>
              <thead><tr><th>Item #</th><th>Description</th><th>Qty</th><th>UoM</th><th>Unit Cost</th><th>Total</th></tr></thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}><td>{it.item_number}</td><td>{it.description}</td><td>{it.qty}</td><td>{it.uom}</td><td>{it.unit_cost}</td><td>{Number(it.total_cost).toFixed(2)}</td></tr>
                ))}
                <tr><td colSpan={4}></td><td><strong>Mileage (RT)</strong></td><td>{ticket.mileage_one_way ? Number(ticket.mileage_one_way) * 2 : 0}</td></tr>
                <tr><td colSpan={4}></td><td><strong>Total</strong></td><td><strong>{total.toFixed(2)}</strong></td></tr>
              </tbody>
            </table>
          ) : (
            <table>
              <thead><tr><th>Time</th><th>Event</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}><td className="mono">{formatDateTime(l.logged_at, settings)}</td><td>{l.text}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <button className="secondary" disabled title="Real file generation pending Part B template files">
          Download {sheet} (.xlsx) — pending templates
        </button>
      </div>
    </div>
  )
}
