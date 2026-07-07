import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PageLoading } from '../components/PageLoading'
import { apiFetch } from '../lib/api'

type SessionTrainingProgram = {
  session_id: string
  session_title: string | null
  program_id: string
  program_title: string
  program_description: string | null
  exercises: {
    sort_order: number
    title: string
    description: string | null
    target_duration_sec: number | null
  }[]
}

export function SessionProgramPage() {
  const { sessionId } = useParams()
  const [data, setData] = useState<SessionTrainingProgram | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const exercises = useMemo(() => {
    if (!data) return []
    return [...data.exercises].sort((a, b) => a.sort_order - b.sort_order)
  }, [data])

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const row = await apiFetch<SessionTrainingProgram>(`/sessions/${sessionId}/program`)
        if (!cancelled) setData(row)
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load training program')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  if (!sessionId) {
    return <p className="muted">Missing session.</p>
  }

  const displayTitle = data?.session_title?.trim() || data?.program_title || 'Training program'

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Training program</p>
          <h1>{data ? displayTitle : 'Training program'}</h1>
          {sessionId ? <p className="muted mono">{sessionId}</p> : null}
        </div>
        <nav className="page-context-nav" aria-label="Session">
          <Link to={`/sessions/${sessionId}`}>Session details</Link>
        </nav>
      </header>

      {error ? <p className="banner error">{error}</p> : null}

      {loading ? <PageLoading label="Loading program…" /> : null}

      {!loading && data ? (
        <>
          <section className="card muted-border stack session-program-overview">
            <p className="muted small">
              Routine: <strong>{data.program_title}</strong>
            </p>
            {data.program_description?.trim() ? <p>{data.program_description}</p> : null}
            {!data.program_description?.trim() ? (
              <p className="muted small">No routine description.</p>
            ) : null}
          </section>

          <div className="stack wide">
            {exercises.map((ex, idx) => (
              <article key={`${ex.sort_order}-${idx}`} className="card muted-border exercise-card program-readonly">
                <header>
                  <p className="eyebrow">
                    Exercise {idx + 1} · order {ex.sort_order}
                  </p>
                  <h2>{ex.title}</h2>
                  {ex.description ? <p className="muted">{ex.description}</p> : null}
                  {ex.target_duration_sec ? (
                    <p className="muted small">Target ~ {Math.round(ex.target_duration_sec / 60)} min</p>
                  ) : null}
                </header>
              </article>
            ))}
          </div>

          {!exercises.length ? <p className="muted">This session has no exercises on file.</p> : null}
        </>
      ) : null}
    </div>
  )
}
