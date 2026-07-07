import { NavLink } from 'react-router-dom'
import type { Profile } from '../context/AuthContext'
import { profileSetupPath } from '../lib/paths'
import { LogoutButton } from './LogoutButton'

function navClass({ isActive }: { isActive: boolean }) {
  return `app-sidebar-link${isActive ? ' app-sidebar-link--active' : ''}`
}

export function AppSidebar({ profile }: { profile: Profile }) {
  const coachLike = profile.role === 'coach' || profile.role === 'admin'
  const setup = profileSetupPath(profile.role)

  return (
    <>
      <div className="app-sidebar-brand">
        <p className="eyebrow">{coachLike ? 'Coach' : 'Player'}</p>
      </div>
      <nav className="app-sidebar-nav" aria-label="Main">
        {coachLike ? (
          <>
            <NavLink to="/coach/dashboard" className={navClass} end>
              Dashboard
            </NavLink>
            <NavLink to="/coach/programs" className={navClass}>
              Training routines
            </NavLink>
            <NavLink to="/coach/availability" className={navClass}>
              Availability
            </NavLink>
            <NavLink to="/sessions/new" className={navClass}>
              New session
            </NavLink>
          </>
        ) : (
          <>
            <NavLink to="/player/dashboard" className={navClass} end>
              Dashboard
            </NavLink>
            <NavLink to="/player/coaches" className={navClass}>
              Find coaches
            </NavLink>
          </>
        )}
        <NavLink to={setup} className={navClass}>
          Profile
        </NavLink>
      </nav>
      <div className="app-sidebar-footer">
        <LogoutButton />
      </div>
    </>
  )
}
