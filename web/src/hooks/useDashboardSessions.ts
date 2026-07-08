import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

export type DashboardSessionFilter =
  | 'all'
  | 'pending_confirmation'
  | 'planned'
  | 'completed'
  | 'in_progress'
  | 'cancelled'

export type DashboardSessionRow = {
  session_id: string
  coach_id: string
  player_id: string
  coach_name: string | null
  player_name: string | null
  session_date: string | null
  place: string | null
  status: string
  average_score: number | null
}

export function useDashboardSessions(statusFilter: DashboardSessionFilter) {
  const [rows, setRows] = useState<DashboardSessionRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const qs = statusFilter === 'all' ? '' : `?status=${encodeURIComponent(statusFilter)}`
        const data = await apiFetch<DashboardSessionRow[]>(`/dashboard/sessions${qs}`)
        if (!cancelled) {
          setRows(data)
          setError(null)
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setRows([])
          setError(e instanceof Error ? e.message : 'Failed to load sessions')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [statusFilter])

  return { rows, error, loading }
}
