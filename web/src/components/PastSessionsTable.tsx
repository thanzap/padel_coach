import { Link } from 'react-router-dom'
import { PageLoading } from './PageLoading'
import type { DashboardSessionFilter, DashboardSessionRow } from '../hooks/useDashboardSessions'

function formatSessionDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function statusLabel(status: string): string {
  if (status === 'in_progress') return 'In progress'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

const EMPTY_COPY: Record<DashboardSessionFilter, string> = {
  all: 'No sessions yet.',
  planned: 'No planned sessions.',
  completed: 'No completed sessions.',
  in_progress: 'No sessions in progress.',
  cancelled: 'No cancelled sessions.',
}

export function PastSessionsTable({
  rows,
  error,
  loading,
  statusFilter,
}: {
  rows: DashboardSessionRow[]
  error: string | null
  loading: boolean
  statusFilter: DashboardSessionFilter
}) {
  if (error) {
    return <p className="banner error">{error}</p>
  }

  if (loading) {
    return <PageLoading label="Loading sessions…" />
  }

  if (!rows.length) {
    return <p className="muted">{EMPTY_COPY[statusFilter]}</p>
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>Coach</th>
            <th>Player</th>
            <th>Date</th>
            <th>Place</th>
            <th>Average score</th>
            <th>Session</th>
            <th>Program</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.session_id}>
              <td>
                <span className={`pill pill--${r.status}`}>{statusLabel(r.status)}</span>
              </td>
              <td>{r.coach_name ?? '—'}</td>
              <td>{r.player_name ?? '—'}</td>
              <td>{formatSessionDate(r.session_date)}</td>
              <td>{r.place?.trim() || '—'}</td>
              <td>{r.average_score != null ? r.average_score.toFixed(1) : '—'}</td>
              <td>
                <Link to={`/sessions/${r.session_id}`}>Open</Link>
              </td>
              <td>
                <Link to={`/sessions/${r.session_id}/program`}>View</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
