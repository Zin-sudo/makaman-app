import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthContext'

const SettingsContext = createContext(null)

const DEFAULTS = {
  theme: 'system', // 'light' | 'dark' | 'system'
  accent: 'red', // 'red' | 'blue' | 'green' | 'amber' | 'purple'
  timezone: 'Africa/Tripoli',
  hour12: false,
  share_location: false,
}

const CACHE_KEY = 'makaman.settings.v1'

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

function writeCache(settings) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(settings))
}

export function SettingsProvider({ children }) {
  const { user } = useAuth()
  const [settings, setSettings] = useState(readCache)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme)
    document.documentElement.setAttribute('data-accent', settings.accent)
    writeCache(settings)
  }, [settings])

  useEffect(() => {
    if (!user) return
    supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setSettings((prev) => ({ ...prev, ...data }))
        }
      })
  }, [user])

  const updateSettings = useCallback(
    async (patch) => {
      setSettings((prev) => ({ ...prev, ...patch }))
      if (user) {
        await supabase.from('user_settings').upsert({ user_id: user.id, ...patch }, { onConflict: 'user_id' })
      }
    },
    [user]
  )

  return <SettingsContext.Provider value={{ settings, updateSettings }}>{children}</SettingsContext.Provider>
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
