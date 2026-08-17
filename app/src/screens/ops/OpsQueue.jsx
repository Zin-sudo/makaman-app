import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabaseClient'
import { useSettings } from '../../context/SettingsContext'
import { formatDateTime } from '../../lib/format'
import TopBar from '../TopBar'

const TABS = [
  { key: 'done', label: 'Awaiting Review' },
  { key: 'approved', label: 'Approved' },
]

export default function OpsQueue() {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const [tab, setTab] = useState('done')
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    supabase
      .from('tickets')
      .select('id, customer, field_name, well_no, rig_name, arrival_at, end_job_at, status, ticket_number, profiles:technician_id(full_name)')
      .eq('status', tab)
      .order('end_job_at', { ascending: false })
      .then(({ data }) => {
        setTickets(data || [])
        setLoading(false)
      })
  }, [tab])

  return (
    <div>
      <TopBar title="Ticket Review" />
      <div className="page page-wide stack">
        <div className="row">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? '' : 'secondary'} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {loading && <p className="muted">Loading…</p>}
        {!loading && tickets.length === 0 && <p className="muted">Nothing here.</p>}

        <div className="stack">
          {tickets.map((t) => (
            <div key={t.id} className="card" style={{ cursor: 'pointer' }} onClick={() => navigate(`/ops/ticket/${t.id}`)}>
              <div className="row-between">
                <strong>{t.customer || 'Untitled'} {t.ticket_number ? `· #${t.ticket_number}` : ''}</strong>
                <span className="badge">{t.profiles?.full_name}</span>
              </div>
              <div className="small muted">{t.field_name} {t.well_no ? `· Well ${t.well_no}` : ''} {t.rig_name ? `· ${t.rig_name}` : ''}</div>
              <div className="small muted">Done {formatDateTime(t.end_job_at, settings)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
