import { Navigate } from 'react-router-dom'
import { LogoutButton } from '../components/LogoutButton'
import { PageLoading } from '../components/PageLoading'
import { useAuth } from '../context/AuthContext'
import { dashboardPath } from '../lib/paths'

export function DashboardRedirectPage() {
  const { profile, loading, profileLoading } = useAuth()

  if (loading || profileLoading) {
    return (
      <div className="page">
        <PageLoading label="Opening your dashboard…" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="page narrow stack">
        <p className="banner error">We couldn&apos;t load your profile. Try signing out and back in.</p>
        <LogoutButton />
      </div>
    )
  }

  return <Navigate to={dashboardPath(profile.role)} replace />
}
