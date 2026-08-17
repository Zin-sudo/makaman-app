import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function Signup() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    setLoading(false)
    if (signUpErr) {
      setError(signUpErr.message)
      return
    }
    navigate('/pending', { replace: true })
  }

  return (
    <div className="center-screen">
      <div className="card" style={{ width: '100%', maxWidth: 380 }}>
        <div className="stack" style={{ alignItems: 'center', marginBottom: '1.5rem' }}>
          <img src="/logo.png" alt="Makaman Libya" className="logo-lg" />
          <h2 style={{ margin: 0 }}>Request an account</h2>
        </div>
        <form onSubmit={onSubmit} className="stack">
          <div className="field">
            <label>Full name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button type="submit" disabled={loading}>{loading ? 'Submitting…' : 'Sign Up'}</button>
        </form>
        <p className="small muted" style={{ textAlign: 'center', marginTop: '1rem' }}>
          An Ops Manager approves new accounts before you can log in. <Link to="/login">Back to login</Link>
        </p>
      </div>
    </div>
  )
}
