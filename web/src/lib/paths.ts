/** Role-aware dashboard & onboarding URLs */

export function dashboardPath(role: string | undefined | null): string {
  if (role === 'coach' || role === 'admin') return '/coach/dashboard'
  return '/player/dashboard'
}

export function profileSetupPath(role: string | undefined | null): string {
  if (role === 'coach' || role === 'admin') return '/coach/profile/setup'
  return '/player/profile/setup'
}
