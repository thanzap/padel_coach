import { Navigate } from 'react-router-dom'
import { IncompleteProfileBanner } from '../components/IncompleteProfileBanner'
import { PageLoading } from '../components/PageLoading'
import { CoachSessionRequestsSection } from '../components/CoachSessionRequestsSection'
import { DashboardSessionsSection } from '../components/DashboardSessionsSection'
import { useAuth } from '../context/AuthContext'

export function CoachDashboardPage() {
  const { profile, loading, profileLoading } = useAuth()

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

  if (profile.role !== 'coach' && profile.role !== 'admin') {
    return <Navigate to="/player/dashboard" replace />
  }

  return (
    <div className="page">
      <IncompleteProfileBanner profile={profile} />

      <header className="page-header">
        <div>
          <p className="eyebrow">Coach dashboard</p>
          <h1>Your trainings</h1>
          <p className="muted">
            Signed in as {profile.email ?? '…'} · <strong>{profile.role}</strong>
          </p>
        </div>
      </header>

      <div className="dashboard-coach-sections">
        <CoachSessionRequestsSection />
        <DashboardSessionsSection />
      </div>
    </div>
  )
}
