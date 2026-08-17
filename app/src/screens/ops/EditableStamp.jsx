import { useState } from 'react'
import { useSettings } from '../../context/SettingsContext'
import { formatDateTime, isoToLocalInput, localInputToIso } from '../../lib/format'

// Small inline editor for any timestamp Ops/Admin are allowed to correct —
// used for both the ticket-level Arrival/Start/End stamps and the individual
// job-log line timestamps. Every save calls onSave(newIso) which the caller
// is responsible for persisting and audit-logging.
export default function EditableStamp({ value, onSave, label }) {
  const { settings } = useSettings()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setDraft(isoToLocalInput(value, settings.timezone))
    setEditing(true)
  }

  async function save() {
    const iso = localInputToIso(draft, settings.timezone)
    setSaving(true)
    await onSave(iso)
    setSaving(false)
    setEditing(false)
  }

  if (editing) {
    return (
      <span className="editable-stamp">
        <input
          type="datetime-local"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ width: 'auto', padding: '0.25rem 0.4rem' }}
        />
        <button className="ghost" onClick={save} disabled={saving}>{saving ? '…' : '✓'}</button>
        <button className="ghost" onClick={() => setEditing(false)} disabled={saving}>✕</button>
      </span>
    )
  }

  return (
    <span className="editable-stamp mono">
      {label && <span className="small muted">{label}:</span>} {formatDateTime(value, settings)}
      <button className="ghost" onClick={startEdit} title="Edit timestamp">✎</button>
    </span>
  )
}
