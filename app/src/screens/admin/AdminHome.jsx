import { Link } from 'react-router-dom'
import TopBar from '../TopBar'

const LINKS = [
  { to: '/admin/users', label: 'Users & Approvals', desc: 'Approve signups, create technicians, promote roles' },
  { to: '/admin/price-lists', label: 'Price Lists', desc: 'Per-client item numbers, descriptions, UoM and rates' },
  { to: '/admin/job-types', label: 'Job Types', desc: 'Manage job type / objective options' },
  { to: '/admin/numbering', label: 'Ticket Numbering', desc: 'Reference numbering series shown to Ops Manager' },
]

export default function AdminHome() {
  return (
    <div>
      <TopBar title="Admin" />
      <div className="page stack">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="card" style={{ textDecoration: 'none', color: 'var(--text)' }}>
            <strong>{l.label}</strong>
            <div className="small muted">{l.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
