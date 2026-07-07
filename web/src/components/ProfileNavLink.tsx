import { Link } from 'react-router-dom'
import { profileSetupPath } from '../lib/paths'

export function ProfileNavLink({ role }: { role: string | undefined | null }) {
  if (!role) return null
  return <Link to={profileSetupPath(role)}>Profile</Link>
}
