import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (signInErr) {
      setError(signInErr.message)
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <div className="center-screen">
      <div className="card" style={{ width: '100%', maxWidth: 380 }}>
        <div className="stack" style={{ alignItems: 'center', marginBottom: '1.5rem' }}>
          <img src="/logo.png" alt="Makaman Libya" className="logo-lg" />
          <h2 style={{ margin: 0 }}>Makaman Job Tickets</h2>
        </div>
        <form onSubmit={onSubmit} className="stack">
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Log In'}</button>
        </form>
        <p className="small muted" style={{ textAlign: 'center', marginTop: '1rem' }}>
          New technician? <Link to="/signup">Request an account</Link>
        </p>
      </div>
    </div>
  )
}
