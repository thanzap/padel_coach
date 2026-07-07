import type { Session, User } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../lib/api'
import { supabase } from '../lib/supabase'

export type Profile = {
  id: string
  email: string | null
  full_name: string | null
  role: string
  primary_place: string | null
  training_club: string | null
  bio: string | null
  profile_completed: boolean
}

type AuthState = {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  profileLoading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)

  const loadProfile = useCallback(async () => {
    setProfileLoading(true)
    try {
      const me = await apiFetch<Profile>('/me')
      setProfile(me)
    } catch {
      setProfile(null)
    } finally {
      setProfileLoading(false)
    }
  }, [])

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session ?? null)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })

    supabase.auth.startAutoRefresh()

    return () => {
      mounted = false
      subscription.unsubscribe()
      supabase.auth.stopAutoRefresh()
    }
  }, [])

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const bumpSessionAfterIdle = () => {
      if (document.visibilityState !== 'visible') return
      window.clearTimeout(t)
      t = window.setTimeout(() => {
        void (async () => {
          const { data: { session } } = await supabase.auth.getSession()
          if (!session?.refresh_token) return
          const exp = session.expires_at
          const stale =
            exp == null || Date.now() >= exp * 1000 - 120_000 /* refresh within 2 min of expiry */
          if (stale) {
            const { error } = await supabase.auth.refreshSession()
            if (error) {
              console.warn('Session refresh failed; clearing local auth.', error.message)
              await supabase.auth.signOut({ scope: 'local' })
              setSession(null)
              setProfile(null)
            }
          }
        })()
      }, 600)
    }
    document.addEventListener('visibilitychange', bumpSessionAfterIdle)
    window.addEventListener('focus', bumpSessionAfterIdle)
    return () => {
      document.removeEventListener('visibilitychange', bumpSessionAfterIdle)
      window.removeEventListener('focus', bumpSessionAfterIdle)
      window.clearTimeout(t)
    }
  }, [])

  useEffect(() => {
    const uid = session?.user?.id ?? null
    if (!uid) {
      setProfile(null)
      setProfileLoading(false)
      return
    }
    void loadProfile()
  }, [session?.user?.id, loadProfile])

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      profileLoading,
      signOut: async () => {
        const { error: globalErr } = await supabase.auth.signOut({ scope: 'global' })
        if (globalErr) {
          console.warn('signOut(global):', globalErr.message)
        }
        const { error: localErr } = await supabase.auth.signOut({ scope: 'local' })
        if (localErr) {
          console.warn('signOut(local):', localErr.message)
        }
        setSession(null)
        setProfile(null)
      },
      refreshProfile: loadProfile,
    }),
    [session, profile, loading, profileLoading, loadProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
