import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import TopBar from '../TopBar'

export default function JobTypes() {
  const [jobTypes, setJobTypes] = useState([])
  const [newName, setNewName] = useState('')

  function load() {
    supabase.from('job_types').select('*').order('name').then(({ data }) => setJobTypes(data || []))
  }
  useEffect(load, [])

  async function add() {
    if (!newName.trim()) return
    await supabase.from('job_types').insert({ name: newName.trim() })
    setNewName('')
    load()
  }

  async function remove(id) {
    await supabase.from('job_types').delete().eq('id', id)
    load()
  }

  return (
    <div>
      <TopBar title="Job Types" />
      <div className="page stack">
        <div className="card row">
          <input placeholder="New job type…" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button onClick={add}>Add</button>
        </div>
        <div className="card stack">
          {jobTypes.map((j) => (
            <div key={j.id} className="row-between">
              <span>{j.name}</span>
              <button className="ghost" onClick={() => remove(j.id)}>✕</button>
            </div>
          ))}
          {jobTypes.length === 0 && <p className="muted">No job types yet.</p>}
        </div>
      </div>
    </div>
  )
}
