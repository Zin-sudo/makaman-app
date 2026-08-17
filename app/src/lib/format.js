// Timestamp formatting helpers, aware of the user's chosen timezone and 12h/24h preference.

export function formatDateTime(isoString, { timezone = 'UTC', hour12 = true } = {}) {
  if (!isoString) return '—'
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return '—'
  const datePart = d.toLocaleDateString('en-GB', { timeZone: timezone, day: '2-digit', month: 'short', year: 'numeric' })
  const timePart = d.toLocaleTimeString('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12 })
  return `${datePart}  ${timePart}`
}

export function formatDate(isoString, { timezone = 'UTC' } = {}) {
  if (!isoString) return '—'
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { timeZone: timezone, day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatTime(isoString, { timezone = 'UTC', hour12 = true } = {}) {
  if (!isoString) return '—'
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12 })
}

// Convert a local <input type="datetime-local"> value (in the user's chosen display
// timezone) back into a UTC ISO string for storage. Uses Intl to resolve the offset.
export function localInputToIso(localValue, timezone) {
  if (!localValue) return null
  // localValue like "2026-08-17T14:30". Interpret it as wall-clock time in `timezone`.
  const [datePart, timePart] = localValue.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  // Find the UTC instant whose representation in `timezone` matches the given wall clock.
  const guessUtc = Date.UTC(y, m - 1, d, hh, mm)
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const asIfUtc = new Date(guessUtc)
  const parts = Object.fromEntries(dtf.formatToParts(asIfUtc).map((p) => [p.type, p.value]))
  const reconstructed = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second)
  )
  const offset = reconstructed - guessUtc
  return new Date(guessUtc - offset).toISOString()
}

// Convert a stored ISO string to the value a <input type="datetime-local"> expects,
// expressed in the given display timezone.
export function isoToLocalInput(isoString, timezone) {
  if (!isoString) return ''
  const d = new Date(isoString)
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
  const parts = Object.fromEntries(dtf.formatToParts(d).map((p) => [p.type, p.value]))
  const hh = parts.hour === '24' ? '00' : parts.hour
  return `${parts.year}-${parts.month}-${parts.day}T${hh}:${parts.minute}`
}

export const TIMEZONES = [
  'UTC', 'Africa/Tripoli', 'Europe/London', 'Europe/Berlin', 'Asia/Dubai', 'America/New_York',
]
