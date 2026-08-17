import { useAuth } from '../context/AuthContext'

export default function PendingApproval() {
  const { signOut } = useAuth()
  return (
    <div className="center-screen">
      <div className="card" style={{ width: '100%', maxWidth: 420, textAlign: 'center' }}>
        <img src="/logo.png" alt="Makaman Libya" className="logo-lg" style={{ margin: '0 auto 1rem' }} />
        <h2>Account pending approval</h2>
        <p className="muted">
          Your sign-up request has been received. An Ops Manager needs to approve your account before you can log in.
          You'll be assigned the Technician role automatically once approved.
        </p>
        <button className="secondary" onClick={signOut}>Log out</button>
      </div>
    </div>
  )
}
