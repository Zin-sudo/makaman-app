import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useSettings } from '../../context/SettingsContext'
import { formatDate } from '../../lib/format'
import TopBar from '../TopBar'

// Observer (internal role key stays "founder" -- DB enum / RLS policies unchanged, this
// is a display-label-only rename to match the prototype's edit #1): read-only report
// across all approved tickets. No edit affordances anywhere on this screen.
export default function FounderReport() {
  const { settings } = useSettings()
  const [tickets, setTickets] = useState([])

  useEffect(() => {
    supabase
      .from('tickets')
      .select('id, ticket_number, customer, field_name, well_no, end_job_at, mileage_one_way, status, profiles:technician_id(full_name), ticket_items(total_cost)')
      .eq('status', 'approved')
      .order('end_job_at', { ascending: false })
      .then(({ data }) => setTickets(data || []))
  }, [])

  const totalRevenue = tickets.reduce((sum, t) => sum + (t.ticket_items || []).reduce((s, i) => s + Number(i.total_cost || 0), 0), 0)

  return (
    <div>
      <TopBar title="Observer Report" />
      <div className="page page-wide stack">
        <div className="row wrap" style={{ gap: '1rem' }}>
          <div className="card" style={{ flex: 1, minWidth: 160 }}>
            <div className="small muted">Approved tickets</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{tickets.length}</div>
          </div>
          <div className="card" style={{ flex: 1, minWidth: 160 }}>
            <div className="small muted">Total charged</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{totalRevenue.toFixed(2)}</div>
          </div>
        </div>

        <div className="card">
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>#</th><th>Customer</th><th>Field / Well</th><th>Technician</th><th>Done</th><th>Total</th></tr></thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id}>
                    <td>{t.ticket_number}</td>
                    <td>{t.customer}</td>
                    <td>{t.field_name} {t.well_no}</td>
                    <td>{t.profiles?.full_name}</td>
                    <td>{formatDate(t.end_job_at, settings)}</td>
                    <td className="mono">{(t.ticket_items || []).reduce((s, i) => s + Number(i.total_cost || 0), 0).toFixed(2)}</td>
                  </tr>
                ))}
                {tickets.length === 0 && <tr><td colSpan={6} className="muted">No approved tickets yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
