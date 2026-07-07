import { useState } from 'react'
import {
  type DashboardSessionFilter,
  useDashboardSessions,
} from '../hooks/useDashboardSessions'
import { PastSessionsTable } from './PastSessionsTable'

const FILTERS: { key: DashboardSessionFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'planned', label: 'Planned' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
]

export function DashboardSessionsSection() {
  const [filter, setFilter] = useState<DashboardSessionFilter>('all')
  const { rows, error, loading } = useDashboardSessions(filter)

  return (
    <section className="stack wide dashboard-sessions">
      <div className="row wrap gap spread dashboard-sessions-heading">
        <h2>Sessions</h2>
        <div className="tabs session-filter-tabs" role="tablist" aria-label="Filter by session status">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={filter === key ? 'active' : ''}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <PastSessionsTable rows={rows} error={error} loading={loading} statusFilter={filter} />
    </section>
  )
}
