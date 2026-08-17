import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import TopBar from '../TopBar'

export default function Users() {
  const { role } = useAuth()
  const [profiles, setProfiles] = useState([])
  const [msg, setMsg] = useState('')
  const [newTech, setNewTech] = useState({ full_name: '', email: '', password: '' })

  function load() {
    supabase.from('profiles').select('*').order('created_at', { ascending: false }).then(({ data }) => setProfiles(data || []))
  }
  useEffect(load, [])

  async function callAction(body) {
    setMsg('')
    const { data, error } = await supabase.functions.invoke('admin-actions', { body })
    if (error) {
      setMsg(error.message || 'Action failed.')
      return null
    }
    if (data?.error) {
      setMsg(data.error)
      return null
    }
    load()
    return data
  }

  async function approve(userId) {
    await callAction({ action: 'approve_signup', userId })
  }

  async function promote(userId, newRole) {
    await callAction({ action: 'promote_role', userId, role: newRole })
  }

  async function createTechnician(e) {
    e.preventDefault()
    const res = await callAction({ action: 'create_technician', ...newTech })
    if (res) {
      setMsg(`Technician account created for ${newTech.email}.`)
      setNewTech({ full_name: '', email: '', password: '' })
    }
  }

  const pending = profiles.filter((p) => p.status === 'pending')
  const active = profiles.filter((p) => p.status === 'active')

  return (
    <div>
      <TopBar title="Users" />
      <div className="page page-wide stack">
        {msg && <div className="card small">{msg}</div>}

        <div className="card stack">
          <strong>Pending Signups</strong>
          {pending.length === 0 && <p className="muted small">Nothing pending.</p>}
          {pending.map((p) => (
            <div key={p.id} className="row-between">
              <span>{p.full_name} <span className="muted small">{p.email}</span></span>
              <button onClick={() => approve(p.id)}>Approve → Technician</button>
            </div>
          ))}
        </div>

        <div className="card stack">
          <strong>Create Technician Account</strong>
          <form onSubmit={createTechnician} className="row wrap" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>Full name</label>
              <input required value={newTech.full_name} onChange={(e) => setNewTech((s) => ({ ...s, full_name: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>Email</label>
              <input type="email" required value={newTech.email} onChange={(e) => setNewTech((s) => ({ ...s, email: e.target.value }))} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 160 }}>
              <label>Password</label>
              <input type="text" required minLength={6} value={newTech.password} onChange={(e) => setNewTech((s) => ({ ...s, password: e.target.value }))} />
            </div>
            <button type="submit">Create</button>
          </form>
        </div>

        <div className="card stack">
          <strong>Active Users</strong>
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th>{role === 'admin' && <th>Change role</th>}</tr></thead>
            <tbody>
              {active.map((p) => (
                <tr key={p.id}>
                  <td>{p.full_name}</td>
                  <td className="small">{p.email}</td>
                  <td><span className="badge accent">{p.role?.replace('_', ' ')}</span></td>
                  {role === 'admin' && (
                    <td>
                      <select value={p.role} onChange={(e) => promote(p.id, e.target.value)}>
                        <option value="technician">Technician</option>
                        <option value="ops_manager">Ops Manager</option>
                        <option value="admin">Admin</option>
                        <option value="founder">Founder</option>
                      </select>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
