import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ExerciseDraftList, type ExerciseDraft } from '../components/ExerciseDraftList'
import { PageLoading } from '../components/PageLoading'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

type ProgramPayload = {
  id: string
  title: string
  description: string | null
  exercises: { title: string; description: string | null; target_duration_sec: number | null; sort_order: number }[]
}

function exercisesToDrafts(
  exercises: { title: string; description: string | null; target_duration_sec: number | null }[],
): ExerciseDraft[] {
  return exercises.map((ex) => ({
    title: ex.title,
    description: ex.description ?? '',
    target_duration_sec: ex.target_duration_sec != null ? String(ex.target_duration_sec) : '',
  }))
}

export function ProgramRoutineEditPage() {
  const { programId } = useParams()
  const isNew = programId === undefined
  const navigate = useNavigate()
  const { profile, loading, profileLoading } = useAuth()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [exercises, setExercises] = useState<ExerciseDraft[]>([
    { title: 'Warm-up touches', description: 'Controlled wall or pairs', target_duration_sec: '600' },
    { title: 'Bandeja reps', description: 'Feed from basket', target_duration_sec: '900' },
  ])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [routineLoading, setRoutineLoading] = useState(() => programId !== undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (isNew || !programId) {
      setRoutineLoading(false)
      return
    }
    let cancelled = false
    setRoutineLoading(true)
    setLoadError(null)
    ;(async () => {
      try {
        const row = await apiFetch<ProgramPayload>(`/programs/${programId}`)
        if (cancelled) return
        setTitle(row.title)
        setDescription(row.description ?? '')
        const sorted = [...row.exercises].sort((a, b) => a.sort_order - b.sort_order)
        setExercises(
          sorted.length ? exercisesToDrafts(sorted) : [{ title: '', description: '', target_duration_sec: '' }],
        )
      } catch (e: unknown) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load routine')
      } finally {
        if (!cancelled) setRoutineLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isNew, programId])

  const canSubmit = useMemo(() => title.trim().length > 0 && exercises.every((e) => e.title.trim()), [title, exercises])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      exercises: exercises.map((ex) => ({
        title: ex.title.trim(),
        description: ex.description.trim() || null,
        target_duration_sec: ex.target_duration_sec ? Number(ex.target_duration_sec) : null,
      })),
    }
    try {
      if (isNew) {
        await apiFetch('/programs', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      } else if (programId) {
        await apiFetch(`/programs/${programId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      }
      navigate('/coach/programs')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading || profileLoading) {
    return (
      <div className="page">
        <PageLoading />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="page narrow">
        <p className="banner error">Could not load profile.</p>
      </div>
    )
  }

  if (profile.role !== 'coach' && profile.role !== 'admin') {
    return <Navigate to="/player/dashboard" replace />
  }

  if (routineLoading) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <p className="eyebrow">Coach</p>
            <h1>Edit routine</h1>
          </div>
        </header>
        <PageLoading label="Loading routine…" />
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Coach</p>
          <h1>{isNew ? 'New training routine' : 'Edit routine'}</h1>
        </div>
      </header>

      {loadError ? <p className="banner error">{loadError}</p> : null}

      {!loadError ? (
        <form className="card form wide" onSubmit={onSubmit}>
          <label>
            Title
            <input required value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>

          <label>
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </label>

          <ExerciseDraftList exercises={exercises} setExercises={setExercises} />

          {error ? <p className="banner error">{error}</p> : null}

          <button type="submit" disabled={!canSubmit || busy}>
            {busy ? 'Saving…' : isNew ? 'Create routine' : 'Save changes'}
          </button>
        </form>
      ) : null}
    </div>
  )
}
