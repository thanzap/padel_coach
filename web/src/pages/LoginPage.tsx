import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export function LoginPage() {
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<'player' | 'coach'>('player')
  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_in')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    setBusy(true)
    try {
      if (mode === 'sign_up') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, role },
          },
        })
        if (error) throw error
        setMessage('Check your email to confirm, then sign in.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        await refreshProfile()
        navigate('/dashboard', { replace: true })
      }
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page narrow">
      <h1>Padel coaching</h1>
      <p className="muted">Sign in with Supabase email authentication.</p>

      <div className="tabs">
        <button type="button" className={mode === 'sign_in' ? 'active' : ''} onClick={() => setMode('sign_in')}>
          Sign in
        </button>
        <button type="button" className={mode === 'sign_up' ? 'active' : ''} onClick={() => setMode('sign_up')}>
          Create account
        </button>
      </div>

      <form className="card form" onSubmit={onSubmit}>
        {mode === 'sign_up' ? (
          <label>
            Full name
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
          </label>
        ) : null}

        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>

        <label>
          Password
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'sign_up' ? 'new-password' : 'current-password'}
          />
        </label>

        {mode === 'sign_up' ? (
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as 'player' | 'coach')}>
              <option value="player">Player</option>
              <option value="coach">Coach</option>
            </select>
          </label>
        ) : null}

        <button type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'sign_up' ? 'Sign up' : 'Sign in'}
        </button>
      </form>

      {message ? <p className="banner">{message}</p> : null}

      <p className="muted">
        <Link to="/">Back home</Link>
      </p>
    </div>
  )
}
