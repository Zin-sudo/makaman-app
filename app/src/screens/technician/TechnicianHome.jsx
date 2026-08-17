import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { listLocalTickets, saveLocalTicket, newLocalId, syncAll } from '../../lib/offlineQueue'
import { captureLocationNote } from '../../lib/geolocation'
import { useSettings } from '../../context/SettingsContext'
import { formatDateTime } from '../../lib/format'
import TopBar from '../TopBar'

export default function TechnicianHome() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { settings } = useSettings()
  const [tickets, setTickets] = useState([])
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  useEffect(() => {
    setTickets(listLocalTickets())
  }, [])

  async function onNewTicket() {
    const localId = newLocalId()
    let locationNote = null
    if (settings.share_location) {
      locationNote = await captureLocationNote()
    }
    const ticket = saveLocalTicket({
      local_id: localId,
      customer: '',
      field_name: '',
      well_no: '',
      rig_name: '',
      arrival_at: new Date().toISOString(),
      start_job_at: null,
      end_job_at: null,
      ops_location_note: locationNote,
      lines: [],
    })
    setTickets(listLocalTickets())
    navigate(`/technician/ticket/${ticket.local_id}`)
  }

  async function onSync() {
    setSyncing(true)
    setSyncMsg('')
    const { synced, failed } = await syncAll(user.id)
    setTickets(listLocalTickets())
    setSyncing(false)
    setSyncMsg(failed.length ? `Synced ${synced}, ${failed.length} failed (will retry).` : `Synced ${synced} ticket(s).`)
  }

  const dirtyCount = tickets.filter((t) => t.dirty).length

  return (
    <div>
      <TopBar title="My Tickets" />
      <div className="page stack">
        <div className="row-between">
          <button onClick={onNewTicket}>+ New Ticket</button>
          <button className="secondary" onClick={onSync} disabled={syncing || dirtyCount === 0}>
            {syncing ? 'Syncing…' : `Sync${dirtyCount ? ` (${dirtyCount})` : ''}`}
          </button>
        </div>
        {syncMsg && <div className="small muted">{syncMsg}</div>}

        <div className="stack">
          {tickets.length === 0 && <p className="muted">No tickets yet. Press "New Ticket" to start one.</p>}
          {tickets.map((t) => (
            <div key={t.local_id} className="card" style={{ cursor: 'pointer' }} onClick={() => navigate(`/technician/ticket/${t.local_id}`)}>
              <div className="row-between">
                <strong>{t.customer || 'Untitled ticket'}</strong>
                <span className={`badge ${t.end_job_at ? 'success' : 'warning'}`}>{t.end_job_at ? 'Done' : 'Open'}</span>
              </div>
              <div className="small muted">{t.field_name} {t.well_no ? `· Well ${t.well_no}` : ''}</div>
              <div className="small muted">Arrived {formatDateTime(t.arrival_at, settings)}</div>
              {t.dirty && <span className="badge warning" style={{ marginTop: '0.4rem' }}>Not synced</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
