import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { IncompleteProfileBanner } from '../components/IncompleteProfileBanner'
import { PageLoading } from '../components/PageLoading'
import { DashboardSessionsSection } from '../components/DashboardSessionsSection'
import { PlayerSessionConfirmationsSection } from '../components/PlayerSessionConfirmationsSection'
import { useAuth } from '../context/AuthContext'
import { fetchCoachPlacesCached } from '../lib/coachPlacesCache'

export function PlayerDashboardPage() {
  const { profile, loading, profileLoading } = useAuth()

  useEffect(() => {
    if (loading || profileLoading || !profile) return
    if (profile.role === 'coach' || profile.role === 'admin') return
    void fetchCoachPlacesCached().catch(() => {})
  }, [loading, profileLoading, profile])

  if (loading || profileLoading) {
    return (
      <div className="page">
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

  if (profile.role === 'coach' || profile.role === 'admin') {
    return <Navigate to="/coach/dashboard" replace />
  }

  return (
    <div className="page">
      <IncompleteProfileBanner profile={profile} />

      <header className="page-header">
        <div>
          <p className="eyebrow">Player dashboard</p>
          <h1>Your sessions</h1>
          <p className="muted">
            Signed in as {profile.email ?? '…'} · <strong>{profile.role}</strong>
          </p>
        </div>
      </header>

      <div className="stack wide">
        <PlayerSessionConfirmationsSection />
        <DashboardSessionsSection />
      </div>
    </div>
  )
}
