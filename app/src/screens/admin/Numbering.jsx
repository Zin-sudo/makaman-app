import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import TopBar from '../TopBar'

// Reference numbering series shown to the Ops Manager during review — NOT an
// auto-assigner. Ops still types the ticket number by hand; the app checks it
// for uniqueness at entry. See HANDOFF.md §4.
export default function Numbering() {
  const [series, setSeries] = useState([])
  const [prefix, setPrefix] = useState('')
  const [next, setNext] = useState('')
  const [note, setNote] = useState('')

  function load() {
    supabase.from('ticket_numbering').select('*').order('prefix').then(({ data }) => setSeries(data || []))
  }
  useEffect(load, [])

  async function add() {
    if (!prefix.trim()) return
    await supabase.from('ticket_numbering').insert({ prefix: prefix.trim(), next_number: Number(next) || 1, note })
    setPrefix(''); setNext(''); setNote('')
    load()
  }

  async function remove(id) {
    await supabase.from('ticket_numbering').delete().eq('id', id)
    load()
  }

  return (
    <div>
      <TopBar title="Ticket Numbering" />
      <div className="page stack">
        <p className="muted small">
          This is a reference series shown to the Ops Manager while reviewing a ticket. It does not assign numbers automatically —
          the Ops Manager still enters the ticket number by hand, and the app checks it for uniqueness.
        </p>
        <div className="card row wrap">
          <input placeholder="Prefix (e.g. MK-)" value={prefix} onChange={(e) => setPrefix(e.target.value)} style={{ flex: 1 }} />
          <input placeholder="Next number" type="number" value={next} onChange={(e) => setNext(e.target.value)} style={{ flex: 1 }} />
          <input placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 2 }} />
          <button onClick={add}>Add series</button>
        </div>
        <div className="card stack">
          {series.map((s) => (
            <div key={s.id} className="row-between">
              <span>{s.prefix} — next: {s.next_number} {s.note && <span className="muted small">({s.note})</span>}</span>
              <button className="ghost" onClick={() => remove(s.id)}>✕</button>
            </div>
          ))}
          {series.length === 0 && <p className="muted">No numbering series yet.</p>}
        </div>
      </div>
    </div>
  )
}
