import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { PageLoading } from './components/PageLoading'
import { PrivateAppShell } from './components/PrivateAppShell'
import { useAuth } from './context/AuthContext'
import { CoachAvailabilityPage } from './pages/CoachAvailabilityPage'
import { CoachDashboardPage } from './pages/CoachDashboardPage'
import { DashboardRedirectPage } from './pages/DashboardRedirectPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { PlayerDashboardPage } from './pages/PlayerDashboardPage'
import { PlayerCoachBookPage } from './pages/PlayerCoachBookPage'
import { PlayerFindCoachesPage } from './pages/PlayerFindCoachesPage'
import { ProfileSetupPage } from './pages/ProfileSetupPage'
import { ProgramRoutineEditPage } from './pages/ProgramRoutineEditPage'
import { ProgramsListPage } from './pages/ProgramsListPage'
import { SessionDetailPage } from './pages/SessionDetailPage'
import { SessionNewPage } from './pages/SessionNewPage'
import { SessionProgramPage } from './pages/SessionProgramPage'

function PrivateRoute() {
  const { session, loading } = useAuth()
  if (loading) {
    return (
      <div className="page">
        <PageLoading />
      </div>
    )
  }
  if (!session) {
    return <Navigate to="/login" replace />
  }
  return (
    <PrivateAppShell>
      <Outlet />
    </PrivateAppShell>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />

      <Route element={<PrivateRoute />}>
        <Route path="/dashboard" element={<DashboardRedirectPage />} />
        <Route path="/coach/dashboard" element={<CoachDashboardPage />} />
        <Route path="/coach/availability" element={<CoachAvailabilityPage />} />
        <Route path="/player/dashboard" element={<PlayerDashboardPage />} />
        <Route path="/player/coaches" element={<PlayerFindCoachesPage />} />
        <Route path="/player/coaches/:coachId/book" element={<PlayerCoachBookPage />} />
        <Route path="/coach/profile/setup" element={<ProfileSetupPage expectedCoachRoute />} />
        <Route path="/player/profile/setup" element={<ProfileSetupPage expectedCoachRoute={false} />} />
        <Route path="/programs/new" element={<Navigate to="/coach/programs/new" replace />} />
        <Route path="/coach/programs" element={<ProgramsListPage />} />
        <Route path="/coach/programs/new" element={<ProgramRoutineEditPage />} />
        <Route path="/coach/programs/:programId/edit" element={<ProgramRoutineEditPage />} />
        <Route path="/sessions/new" element={<SessionNewPage />} />
        <Route path="/sessions/:sessionId/program" element={<SessionProgramPage />} />
        <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
