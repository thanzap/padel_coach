import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function LogoutButton() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  async function handleLogout() {
    setBusy(true)
    try {
      await signOut()
      navigate('/', { replace: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className="ghost" disabled={busy} onClick={() => void handleLogout()}>
      {busy ? 'Signing out…' : 'Log out'}
    </button>
  )
}
