import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getLocalTicket, saveLocalTicket } from '../../lib/offlineQueue'
import { useSettings } from '../../context/SettingsContext'
import { formatDateTime } from '../../lib/format'
import TopBar from '../TopBar'

export default function TicketForm() {
  const { localId } = useParams()
  const navigate = useNavigate()
  const { settings } = useSettings()
  const [ticket, setTicket] = useState(null)
  const [lineText, setLineText] = useState('')

  useEffect(() => {
    const t = getLocalTicket(localId)
    if (!t) {
      navigate('/technician', { replace: true })
      return
    }
    setTicket(t)
  }, [localId, navigate])

  function persist(next) {
    const saved = saveLocalTicket(next)
    setTicket({ ...saved })
  }

  function onHeaderChange(field, value) {
    persist({ ...ticket, [field]: value })
  }

  function onAddLine() {
    if (!lineText.trim()) return
    const now = new Date().toISOString()
    const nextLines = [...(ticket.lines || []), { logged_at: now, text: lineText.trim() }]
    const next = { ...ticket, lines: nextLines }
    if (!ticket.start_job_at) next.start_job_at = now // first line sets Start Job date
    persist(next)
    setLineText('')
  }

  function onJobDone() {
    persist({ ...ticket, end_job_at: new Date().toISOString() })
  }

  if (!ticket) return null
  const isDone = !!ticket.end_job_at

  return (
    <div>
      <TopBar title="Job Ticket" />
      <div className="page stack">
        <div className="card stack">
          <div className="field">
            <label>Customer</label>
            <input value={ticket.customer} disabled={isDone} onChange={(e) => onHeaderChange('customer', e.target.value)} />
          </div>
          <div className="field">
            <label>Field Name</label>
            <input value={ticket.field_name} disabled={isDone} onChange={(e) => onHeaderChange('field_name', e.target.value)} />
          </div>
          <div className="row wrap">
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label>Well No.</label>
              <input value={ticket.well_no} disabled={isDone} onChange={(e) => onHeaderChange('well_no', e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label>Rig Name</label>
              <input value={ticket.rig_name} disabled={isDone} onChange={(e) => onHeaderChange('rig_name', e.target.value)} />
            </div>
          </div>
          <div className="row" style={{ gap: '1.5rem' }}>
            <div className="small muted">Arrival: <strong>{formatDateTime(ticket.arrival_at, settings)}</strong></div>
            <div className="small muted">Start Job: <strong>{formatDateTime(ticket.start_job_at, settings)}</strong></div>
            {isDone && <div className="small muted">End Job: <strong>{formatDateTime(ticket.end_job_at, settings)}</strong></div>}
          </div>
        </div>

        <div className="card stack">
          <strong>Job Log</strong>
          <div className="stack">
            {(ticket.lines || []).length === 0 && <p className="muted small">No log lines yet.</p>}
            {(ticket.lines || []).map((l, i) => (
              <div className="log-line" key={i}>
                <span className="small mono muted">{formatDateTime(l.logged_at, settings)}</span>
                <span>{l.text}</span>
                <span />
              </div>
            ))}
          </div>
          {!isDone && (
            <div className="row">
              <input
                placeholder="Log an event…"
                value={lineText}
                onChange={(e) => setLineText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onAddLine()}
              />
              <button onClick={onAddLine} style={{ whiteSpace: 'nowrap' }}>Add Line</button>
            </div>
          )}
        </div>

        {!isDone ? (
          <button className="danger" onClick={onJobDone}>Job Done</button>
        ) : (
          <div className="badge success" style={{ textAlign: 'center', padding: '0.6rem' }}>Job Done — ready to sync</div>
        )}
        <button className="secondary" onClick={() => navigate('/technician')}>Back</button>
      </div>
    </div>
  )
}
