import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { AppSidebar } from './AppSidebar'
import { AppSidebarSkeleton } from './AppSidebarSkeleton'
import { PageLoading } from './PageLoading'

export function PrivateAppShell({ children }: { children: ReactNode }) {
  const { session, profile, loading, profileLoading } = useAuth()

  /** Signed-in but profile still fetching — keep shell + visible loader instead of a blank page. */
  if (session && (loading || profileLoading)) {
    return (
      <div className="app-shell">
        <aside className="app-sidebar" aria-label="App">
          <AppSidebarSkeleton />
        </aside>
        <div className="app-shell-main">
          <div className="page">
            <PageLoading label="Loading your workspace…" />
          </div>
        </div>
      </div>
    )
  }

  if (!session) {
    return <>{children}</>
  }

  if (!profile) {
    return (
      <div className="page narrow">
        <p className="banner error">Could not load your profile.</p>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="App">
        <AppSidebar profile={profile} />
      </aside>
      <div className="app-shell-main">{children}</div>
    </div>
  )
}
