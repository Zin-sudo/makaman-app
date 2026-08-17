import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { TIMEZONES } from '../lib/format'
import TopBar from './TopBar'

const ACCENTS = [
  { key: 'red', label: 'Makaman Red', swatch: '#b91c1c' },
  { key: 'blue', label: 'Blue', swatch: '#1d4ed8' },
  { key: 'green', label: 'Green', swatch: '#15803d' },
  { key: 'amber', label: 'Amber', swatch: '#b45309' },
  { key: 'purple', label: 'Purple', swatch: '#6d28d9' },
]

export default function Settings() {
  const { profile, role, signOut } = useAuth()
  const { settings, updateSettings } = useSettings()

  return (
    <div>
      <TopBar title="Settings" />
      <div className="page stack">
        <div className="stack" style={{ alignItems: 'center', margin: '1rem 0' }}>
          <img src="/logo.png" alt="Makaman Libya" className="logo-md" />
        </div>

        <div className="card stack">
          <div className="row-between">
            <div>
              <strong>{profile?.full_name || 'Account'}</strong>
              <div className="small muted">{profile?.email}</div>
            </div>
            <span className="badge accent">{role?.replace('_', ' ')}</span>
          </div>
        </div>

        <div className="card stack">
          <div className="field">
            <label>Theme</label>
            <select value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value })}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div className="field">
            <label>Accent color</label>
            <div className="row wrap">
              {ACCENTS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  className={settings.accent === a.key ? '' : 'secondary'}
                  style={{ padding: '0.5rem 0.8rem' }}
                  onClick={() => updateSettings({ accent: a.key })}
                >
                  <span
                    style={{
                      display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                      background: a.swatch, marginRight: 6,
                    }}
                  />
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>Timezone</label>
            <select value={settings.timezone} onChange={(e) => updateSettings({ timezone: e.target.value })}>
              {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>

          <div className="field">
            <label>Time format</label>
            <select value={settings.hour12 ? '12' : '24'} onChange={(e) => updateSettings({ hour12: e.target.value === '12' })}>
              <option value="24">24-hour</option>
              <option value="12">12-hour</option>
            </select>
          </div>

          {role === 'technician' && (
            <div className="field">
              <label className="row" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={settings.share_location}
                  onChange={(e) => updateSettings({ share_location: e.target.checked })}
                />
                Share job-site location with Ops
              </label>
              <p className="small muted">
                When on, opening a ticket quietly captures your GPS coordinates for the Ops Manager. It is not shown to you.
              </p>
            </div>
          )}
        </div>

        <button className="danger" onClick={signOut}>Log Out</button>
      </div>
    </div>
  )
}
