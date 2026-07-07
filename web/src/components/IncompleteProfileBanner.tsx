import { Link } from 'react-router-dom'
import type { Profile } from '../context/AuthContext'
import { profileSetupPath } from '../lib/paths'

export function IncompleteProfileBanner({ profile }: { profile: Profile }) {
  if (profile.profile_completed) return null

  const setup = profileSetupPath(profile.role)

  return (
    <div className="banner warning" role="status">
      <p>
        <strong>Finish your profile.</strong> Add your name and primary location so we can match coaches and players and so the app stays useful for everyone.
      </p>
      <p className="banner-actions">
        <Link className="cta-inline" to={setup}>
          Complete profile
        </Link>
      </p>
    </div>
  )
}
