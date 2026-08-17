import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function TopBar({ title }) {
  const { profile, role } = useAuth()
  const homeHref = role === 'technician' ? '/technician' : role === 'founder' ? '/founder' : '/ops'

  return (
    <div className="topbar">
      <Link to={homeHref} className="row" style={{ textDecoration: 'none', color: 'var(--text)' }}>
        <img src="/mark.png" alt="Makaman" style={{ width: 28, height: 28 }} />
        <strong>{title}</strong>
      </Link>
      <div className="row">
        {role === 'admin' && (
          <>
            <Link to="/ops" className="small muted">Ops</Link>
            <Link to="/admin" className="small muted">Admin</Link>
          </>
        )}
        <Link to="/settings" className="small muted">{profile?.full_name || 'Settings'}</Link>
      </div>
    </div>
  )
}
