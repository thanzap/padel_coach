import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { PageLoading } from '../components/PageLoading'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

type ProgramRow = {
  id: string
  title: string
  description: string | null
  exercises: { id: string; title: string; sort_order: number }[]
}

export function ProgramsListPage() {
  const { profile, loading, profileLoading } = useAuth()
  const [programs, setPrograms] = useState<ProgramRow[]>([])
  const [programsLoading, setProgramsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!profile || (profile.role !== 'coach' && profile.role !== 'admin')) {
      setProgramsLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setProgramsLoading(true)
      setError(null)
      try {
        const rows = await apiFetch<ProgramRow[]>('/programs')
        if (!cancelled) setPrograms(rows)
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load routines')
      } finally {
        if (!cancelled) setProgramsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [profile])

  async function removeProgram(id: string) {
    if (!window.confirm('Delete this training routine? Sessions that already used it will keep history; delete fails if the DB blocks it.')) {
      return
    }
    setBusyId(id)
    setError(null)
    try {
      await apiFetch(`/programs/${id}`, { method: 'DELETE' })
      setPrograms((xs) => xs.filter((p) => p.id !== id))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  if (loading || profileLoading) {
    return (
      <div className="page">
        <PageLoading />
      </div>
    )
  }

  if (!profile || (profile.role !== 'coach' && profile.role !== 'admin')) {
    return <Navigate to="/player/dashboard" replace />
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="row spread align-center wrap gap">
          <div>
            <p className="eyebrow">Coach</p>
            <h1>Training routines</h1>
            <p className="muted">Create reusable templates or schedule them into sessions.</p>
          </div>
          <Link to="/coach/programs/new" className="cta">
            Create new
          </Link>
        </div>
      </header>

      {error ? <p className="banner error">{error}</p> : null}

      {programsLoading ? <PageLoading label="Loading routines…" /> : null}

      {!programsLoading && !programs.length && !error ? (
        <p className="muted">
          No routines yet.{' '}
          <Link to="/coach/programs/new">Create your first</Link>.
        </p>
      ) : null}

      <div className="grid">
        {!programsLoading &&
          programs.map((p) => (
          <article key={p.id} className="card">
            <div className="row spread">
              <p className="eyebrow">Library routine</p>
              <span className="muted small">{p.exercises.length} exercises</span>
            </div>
            <h2>{p.title}</h2>
            {p.description ? <p className="muted">{p.description}</p> : null}
            <ol className="timeline-preview">
              {[...p.exercises]
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((ex, idx) => (
                  <li key={ex.id}>
                    <span className="muted">{idx + 1}.</span> {ex.title}
                  </li>
                ))}
            </ol>
            <div className="row wrap gap routine-actions">
              <Link to={`/coach/programs/${p.id}/edit`}>Edit</Link>
              <Link to={`/sessions/new?program=${p.id}`}>Schedule session</Link>
              <button type="button" className="link-danger" disabled={busyId === p.id} onClick={() => void removeProgram(p.id)}>
                {busyId === p.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
