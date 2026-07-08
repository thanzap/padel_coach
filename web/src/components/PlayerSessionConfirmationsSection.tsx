import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { formatAthens } from '../lib/timezone'
import { PageLoading } from './PageLoading'

type PendingSessionRow = {
  session_id: string
  coach_name: string | null
  session_date: string | null
  place: string | null
  status: string
}

export function PlayerSessionConfirmationsSection() {
  const [rows, setRows] = useState<PendingSessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await apiFetch<PendingSessionRow[]>('/dashboard/sessions?status=pending_confirmation')
        if (!cancelled) setRows(data)
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load pending sessions')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function respond(id: string, action: 'confirm' | 'decline') {
    setBusyId(id)
    setError(null)
    try {
      await apiFetch(`/sessions/${id}/${action}`, { method: 'POST' })
      setRows((xs) => xs.filter((r) => r.session_id !== id))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not update session')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <section className="card muted-border stack wide">
        <h2>Sessions to confirm</h2>
        <PageLoading label="Loading sessions to confirm…" />
      </section>
    )
  }

  // Nothing to confirm: stay out of the way unless there was an error.
  if (!rows.length && !error) return null

  return (
    <section className="card muted-border stack wide">
      <h2>Sessions to confirm</h2>
      <p className="muted small">
        Your coach proposed these sessions. Confirm to add them to your schedule, or decline to cancel.
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      {rows.length ? (
        <ul className="coach-session-requests">
          {rows.map((r) => (
            <li key={r.session_id} className="card muted-border stack">
              <div>
                <p>
                  <strong>{formatAthens(r.session_date)}</strong>
                </p>
                <p className="muted small">Coach: {r.coach_name?.trim() || 'Unnamed coach'}</p>
                <p className="muted small">Place: {r.place?.trim() || '—'}</p>
                <p className="muted small">
                  <Link to={`/sessions/${r.session_id}/program`}>View training plan</Link>
                </p>
              </div>
              <div className="actions-inline">
                <button type="button" disabled={busyId === r.session_id} onClick={() => void respond(r.session_id, 'confirm')}>
                  Confirm
                </button>
                <button
                  type="button"
                  className="button ghost"
                  disabled={busyId === r.session_id}
                  onClick={() => void respond(r.session_id, 'decline')}
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
