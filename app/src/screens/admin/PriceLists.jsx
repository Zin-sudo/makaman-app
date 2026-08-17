import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import TopBar from '../TopBar'

export default function PriceLists() {
  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [items, setItems] = useState([])
  const [newClientName, setNewClientName] = useState('')

  useEffect(() => {
    supabase.from('clients').select('*').order('name').then(({ data }) => {
      setClients(data || [])
      if (data?.length && !clientId) setClientId(data[0].id)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!clientId) { setItems([]); return }
    supabase.from('price_list_items').select('*').eq('client_id', clientId).order('item_number').then(({ data }) => setItems(data || []))
  }, [clientId])

  async function addClient() {
    if (!newClientName.trim()) return
    const { data } = await supabase.from('clients').insert({ name: newClientName.trim() }).select().single()
    if (data) {
      setClients((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setClientId(data.id)
      setNewClientName('')
    }
  }

  function addRow() {
    setItems((prev) => [...prev, { client_id: clientId, item_number: '', description: '', uom: '', unit_cost: 0, unit_cost_additional: null, currency: 'USD', _new: true }])
  }

  async function persistRow(idx) {
    const row = items[idx]
    const payload = {
      client_id: clientId, item_number: row.item_number, description: row.description, uom: row.uom,
      unit_cost: row.unit_cost, unit_cost_additional: row.unit_cost_additional || null, currency: row.currency || 'USD',
    }
    if (row.id) {
      await supabase.from('price_list_items').update(payload).eq('id', row.id)
    } else if (row.item_number) {
      const { data } = await supabase.from('price_list_items').insert(payload).select().single()
      if (data) setItems((prev) => prev.map((it, i) => (i === idx ? data : it)))
    }
  }

  function updateField(idx, field, value) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
  }

  async function removeRow(idx) {
    const row = items[idx]
    if (row.id) await supabase.from('price_list_items').delete().eq('id', row.id)
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  return (
    <div>
      <TopBar title="Price Lists" />
      <div className="page page-wide stack">
        <div className="card row wrap" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Client</label>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Add new client</label>
            <div className="row">
              <input value={newClientName} onChange={(e) => setNewClientName(e.target.value)} placeholder="Client name…" />
              <button className="secondary" onClick={addClient}>Add</button>
            </div>
          </div>
        </div>

        <div className="card stack">
          <p className="small muted" style={{ marginTop: -8 }}>
            Some items charge a different rate after the first day — enter that in "Add'l Day" and leave it blank for flat-rate items.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Item #</th><th>Description</th><th>UoM</th><th>Currency</th><th>Unit Cost</th><th>Add'l Day</th><th /></tr></thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={it.id || idx}>
                    <td><input style={{ width: 110 }} value={it.item_number} onChange={(e) => updateField(idx, 'item_number', e.target.value)} onBlur={() => persistRow(idx)} /></td>
                    <td><input style={{ minWidth: 220 }} value={it.description} onChange={(e) => updateField(idx, 'description', e.target.value)} onBlur={() => persistRow(idx)} /></td>
                    <td><input style={{ width: 70 }} value={it.uom} onChange={(e) => updateField(idx, 'uom', e.target.value)} onBlur={() => persistRow(idx)} /></td>
                    <td>
                      <select style={{ width: 80 }} value={it.currency || 'USD'} onChange={(e) => { updateField(idx, 'currency', e.target.value); }} onBlur={() => persistRow(idx)}>
                        <option value="USD">USD</option>
                        <option value="LYD">LYD</option>
                      </select>
                    </td>
                    <td><input type="number" style={{ width: 90 }} value={it.unit_cost} onChange={(e) => updateField(idx, 'unit_cost', e.target.value)} onBlur={() => persistRow(idx)} /></td>
                    <td><input type="number" style={{ width: 90 }} value={it.unit_cost_additional ?? ''} placeholder="—" onChange={(e) => updateField(idx, 'unit_cost_additional', e.target.value === '' ? null : e.target.value)} onBlur={() => persistRow(idx)} /></td>
                    <td><button className="ghost" onClick={() => removeRow(idx)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="secondary" onClick={addRow} disabled={!clientId}>+ Add Item</button>
        </div>
      </div>
    </div>
  )
}
