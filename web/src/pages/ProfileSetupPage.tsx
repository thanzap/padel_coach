import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageLoading } from '../components/PageLoading'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { dashboardPath, profileSetupPath } from '../lib/paths'

type Props = { expectedCoachRoute: boolean }

export function ProfileSetupPage({ expectedCoachRoute }: Props) {
  const navigate = useNavigate()
  const { profile, loading, profileLoading, refreshProfile } = useAuth()
  const [fullName, setFullName] = useState('')
  const [primaryPlace, setPrimaryPlace] = useState('')
  const [trainingClub, setTrainingClub] = useState('')
  const [bio, setBio] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!profile) return
    const coachLike = profile.role === 'coach' || profile.role === 'admin'
    if (expectedCoachRoute !== coachLike) {
      navigate(profileSetupPath(profile.role), { replace: true })
      return
    }
    setFullName(profile.full_name ?? '')
    setPrimaryPlace(profile.primary_place ?? '')
    setTrainingClub(profile.training_club ?? '')
    setBio(profile.bio ?? '')
  }, [profile, expectedCoachRoute, navigate])

  async function saveDraft() {
    if (!profile) return
    setBusy(true)
    setMessage(null)
    try {
      await apiFetch('/me', {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: fullName.trim() || null,
          primary_place: primaryPlace.trim() || null,
          training_club: trainingClub.trim() || null,
          bio: bio.trim() || null,
        }),
      })
      await refreshProfile()
      setMessage('Saved.')
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  async function finishSetup() {
    if (!profile) return
    if (!fullName.trim() || !primaryPlace.trim()) {
      setMessage('Full name and primary place are required to finish setup.')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await apiFetch('/me', {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: fullName.trim(),
          primary_place: primaryPlace.trim(),
          training_club: trainingClub.trim() || null,
          bio: bio.trim() || null,
          profile_completed: true,
        }),
      })
      await refreshProfile()
      navigate(dashboardPath(profile.role), { replace: true })
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Could not complete profile')
    } finally {
      setBusy(false)
    }
  }

  if (loading || profileLoading) {
    return (
      <div className="page narrow">
        <PageLoading />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="page narrow">
        <p className="banner error">Could not load your profile.</p>
      </div>
    )
  }

  const coachLike = profile.role === 'coach' || profile.role === 'admin'
  const headline = coachLike ? 'Coach profile' : 'Player profile'

  return (
    <div className="page narrow">
      <header className="page-header">
        <div className="stack">
          <p className="eyebrow">Profile</p>
          <h1>{headline}</h1>
          <p className="muted">Update your details any time — other screens use Profile in the sidebar.</p>
        </div>
      </header>

      <div className="card form stack">
        <label>
          Full name *
          <input required value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
        </label>
        <label>
          Primary place (city / area / venue zone) *
          <input
            required
            value={primaryPlace}
            onChange={(e) => setPrimaryPlace(e.target.value)}
            placeholder="Shown on sessions and used when players search coaches"
          />
        </label>
        {coachLike ? (
          <label>
            Training club (optional)
            <input
              value={trainingClub}
              onChange={(e) => setTrainingClub(e.target.value)}
              placeholder="Club / academy you coach at — shown under your name in search"
            />
          </label>
        ) : null}
        <label>
          Bio (optional)
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} placeholder="Playing background or coaching approach…" />
        </label>

        {message ? <p className="banner">{message}</p> : null}

        <div className="row wrap gap">
          <button type="button" className="ghost" disabled={busy} onClick={() => void saveDraft()}>
            Save draft
          </button>
          <button type="button" disabled={busy} onClick={() => void finishSetup()}>
            Finish setup
          </button>
        </div>
      </div>

      <p className="muted">
        <Link to={dashboardPath(profile.role)}>Back to dashboard</Link>
      </p>
    </div>
  )
}
