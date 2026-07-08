import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PageLoading } from '../components/PageLoading'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { datetimeLocalToIsoOrNull, toDatetimeLocalValue } from '../lib/datetimeLocal'
import { formatAthens } from '../lib/timezone'
import { supabase } from '../lib/supabase'

type Recording = {
  id: string
  storage_object_path: string
  duration_ms: number | null
  mime_type: string | null
  created_at: string
}

type Score = {
  id: string
  coach_id: string
  score: number
  notes: string | null
  created_at: string
}

type SessionExerciseRow = {
  id: string
  sort_order: number
  title: string
  description: string | null
  target_duration_sec: number | null
  recordings: Recording[]
  scores: Score[]
}

type SessionDetail = {
  id: string
  coach_id: string
  player_id: string
  program_id: string
  title: string | null
  status: string
  scheduled_at: string | null
  ends_at: string | null
  venue_place: string | null
  program_adhoc?: boolean | null
  exercises: SessionExerciseRow[]
}

/** Max upload size. Phone-captured video is already H.264-compressed; this keeps storage sane. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB

function humanMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}

function extForVideo(file: File): string {
  const fromName = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  if (fromName) return fromName
  const map: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
  }
  return map[file.type] ?? 'mp4'
}

/** Best-effort clip duration (ms) from file metadata; null if the browser can't read it. */
function readVideoDurationMs(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      const ms = Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null
      URL.revokeObjectURL(url)
      resolve(ms)
    }
    v.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    v.src = url
  })
}

export function SessionDetailPage() {
  const { sessionId } = useParams()
  const { profile } = useAuth()
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyExercise, setBusyExercise] = useState<string | null>(null)
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({})
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, { score: string; notes: string }>>({})
  const [venueDraft, setVenueDraft] = useState('')
  const [startDraft, setStartDraft] = useState('')
  const [endDraft, setEndDraft] = useState('')
  const [promoteBusy, setPromoteBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!sessionId) return
    const row = await apiFetch<SessionDetail>(`/sessions/${sessionId}`)
    setDetail(row)
    const drafts: Record<string, { score: string; notes: string }> = {}
    for (const ex of row.exercises) {
      const latest = ex.scores.at(-1)
      drafts[ex.id] = {
        score: latest ? String(latest.score) : '',
        notes: latest?.notes ?? '',
      }
    }
    setScoreDrafts(drafts)
  }, [sessionId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await refresh()
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load session')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  useEffect(() => {
    if (!detail) return
    setVenueDraft(detail.venue_place ?? '')
    setStartDraft(toDatetimeLocalValue(detail.scheduled_at))
    setEndDraft(toDatetimeLocalValue(detail.ends_at))
  }, [detail?.id, detail?.venue_place, detail?.scheduled_at, detail?.ends_at])

  const isCoach = profile?.id === detail?.coach_id
  async function patchSession(body: Record<string, unknown>) {
    if (!sessionId) return
    await apiFetch(`/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    await refresh()
  }

  async function saveLogistics() {
    try {
      setError(null)
      const scheduled_at = datetimeLocalToIsoOrNull(startDraft)
      const ends_at = datetimeLocalToIsoOrNull(endDraft)
      if (scheduled_at && ends_at && new Date(ends_at) <= new Date(scheduled_at)) {
        setError('End time must be after start time.')
        return
      }
      await patchSession({
        venue_place: venueDraft.trim() || null,
        scheduled_at,
        ends_at,
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save logistics')
    }
  }

  async function promoteRoutineToLibrary() {
    if (!sessionId || !detail?.program_id) return
    setPromoteBusy(true)
    setError(null)
    try {
      await apiFetch(`/programs/${detail.program_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ adhoc: false }),
      })
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save routine to library')
    } finally {
      setPromoteBusy(false)
    }
  }

  async function markTrainingComplete() {
    try {
      setError(null)
      const scheduled_at = datetimeLocalToIsoOrNull(startDraft)
      const ends_at = datetimeLocalToIsoOrNull(endDraft)
      if (scheduled_at && ends_at && new Date(ends_at) <= new Date(scheduled_at)) {
        setError('End time must be after start time.')
        return
      }
      await patchSession({
        status: 'completed',
        venue_place: venueDraft.trim() || null,
        scheduled_at,
        ends_at,
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not complete session')
    }
  }

  const exercises = useMemo(() => {
    if (!detail) return []
    return [...detail.exercises].sort((a, b) => a.sort_order - b.sort_order)
  }, [detail])

  async function ensurePlaybackUrl(objectPath: string) {
    if (signedUrls[objectPath]) return signedUrls[objectPath]
    const { data, error: signErr } = await supabase.storage
      .from('exercise-recordings')
      .createSignedUrl(objectPath, 3600)
    if (signErr || !data?.signedUrl) {
      throw new Error(signErr?.message ?? 'Could not sign playback URL')
    }
    setSignedUrls((prev) => ({ ...prev, [objectPath]: data.signedUrl }))
    return data.signedUrl
  }

  async function preparePreview(recording: Recording) {
    try {
      await ensurePlaybackUrl(recording.storage_object_path)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Playback error')
    }
  }

  async function uploadClip(sessionExerciseId: string, file: File | null | undefined) {
    if (!file || !sessionId) return
    setError(null)
    if (!file.type.startsWith('video/')) {
      setError('Please choose a video file.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `That clip is ${humanMB(file.size)}. Please upload a video under ${humanMB(MAX_UPLOAD_BYTES)} ` +
          '(trim it, or record at a lower quality/resolution).',
      )
      return
    }
    setBusyExercise(sessionExerciseId)
    try {
      const objectPath = `${sessionId}/${sessionExerciseId}.${extForVideo(file)}`
      const duration_ms = await readVideoDurationMs(file)
      const { error: upErr } = await supabase.storage
        .from('exercise-recordings')
        .upload(objectPath, file, { upsert: true, contentType: file.type || 'video/mp4' })
      if (upErr) throw upErr

      await apiFetch(`/sessions/${sessionId}/exercises/${sessionExerciseId}/recording`, {
        method: 'POST',
        body: JSON.stringify({
          storage_object_path: objectPath,
          duration_ms,
          mime_type: file.type || null,
        }),
      })
      await refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setBusyExercise(null)
    }
  }

  async function submitScore(sessionExerciseId: string, e: FormEvent) {
    e.preventDefault()
    if (!sessionId || !isCoach) return
    const draft = scoreDrafts[sessionExerciseId]
    if (!draft?.score) return
    setError(null)
    try {
      await apiFetch(`/sessions/${sessionId}/exercises/${sessionExerciseId}/score`, {
        method: 'PUT',
        body: JSON.stringify({
          score: Number(draft.score),
          notes: draft.notes.trim() || null,
        }),
      })
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save score')
    }
  }

  if (!sessionId) {
    return <p className="muted">Missing session.</p>
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Session timeline</p>
          <h1>{detail?.title || 'Coaching session'}</h1>
        </div>
        <nav className="page-context-nav" aria-label="Session">
          <Link to={`/sessions/${sessionId}/program`}>Training program</Link>
        </nav>
      </header>

      {error ? <p className="banner error">{error}</p> : null}

      {!detail && !error ? <PageLoading label="Loading session…" /> : null}

      {detail ? (
        <section className="card muted-border session-meta-strip">
          <div className="row wrap gap">
            <p>
              <strong>Status:</strong>{' '}
              {detail.status === 'pending_confirmation' ? 'Awaiting player confirmation' : detail.status}
            </p>
            {detail.scheduled_at ? (
              <p>
                <strong>Start:</strong> {formatAthens(detail.scheduled_at)}
              </p>
            ) : (
              <p className="muted">No start time.</p>
            )}
            {detail.ends_at ? (
              <p>
                <strong>End:</strong> {formatAthens(detail.ends_at)}
              </p>
            ) : (
              <p className="muted">No end time.</p>
            )}
            <p>
              <strong>Place:</strong> {detail.venue_place?.trim() ? detail.venue_place : '—'}
            </p>
          </div>
        </section>
      ) : null}

      {detail && isCoach && detail.program_adhoc ? (
        <section className="card muted-border stack promote-routine">
          <p className="eyebrow">One-off routine</p>
          <p>
            This session uses a routine that isn&apos;t in your saved library yet. Save it if you want to reuse it for other sessions.
          </p>
          <button type="button" disabled={promoteBusy} onClick={() => void promoteRoutineToLibrary()}>
            {promoteBusy ? 'Saving…' : 'Save routine to library'}
          </button>
        </section>
      ) : null}

      {detail && isCoach ? (
        <section className="card muted-border stack session-logistics">
          <h3 className="eyebrow">Session logistics (coach)</h3>
          <label>
            Venue / place
            <input value={venueDraft} onChange={(e) => setVenueDraft(e.target.value)} placeholder="Court or city for dashboards" />
          </label>
          <div className="row wrap gap session-times">
            <label className="grow">
              Start time
              <input type="datetime-local" value={startDraft} onChange={(e) => setStartDraft(e.target.value)} />
            </label>
            <label className="grow">
              End time
              <input type="datetime-local" value={endDraft} onChange={(e) => setEndDraft(e.target.value)} />
            </label>
          </div>
          <div className="row wrap gap align-center">
            <button type="button" onClick={() => void saveLogistics()}>
              Save logistics
            </button>
            {detail.status !== 'completed' ? (
              <button type="button" className="ghost" onClick={() => void markTrainingComplete()}>
                Mark training complete
              </button>
            ) : (
              <span className="pill pill--completed">Completed</span>
            )}
          </div>
          <p className="muted small">Completed sessions appear on dashboards with average scores across exercises.</p>
        </section>
      ) : null}

      {detail ? (
      <div className="stack wide">
        {exercises.map((ex, idx) => {
          const recording = [...ex.recordings].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          )[0]
          const latestScore = [...ex.scores].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          )[0]

          return (
            <article key={ex.id} className="card exercise-card">
              <header className="row spread">
                <div>
                  <p className="eyebrow">
                    Exercise {idx + 1} · order {ex.sort_order}
                  </p>
                  <h2>{ex.title}</h2>
                  {ex.description ? <p className="muted">{ex.description}</p> : null}
                  {ex.target_duration_sec ? (
                    <p className="muted small">Target ~ {Math.round(ex.target_duration_sec / 60)} min</p>
                  ) : null}
                </div>
                <div className="column end">
                  <label className={`file-upload-btn${busyExercise !== null ? ' is-disabled' : ''}`}>
                    {busyExercise === ex.id ? 'Uploading…' : recording ? 'Replace clip' : 'Upload clip'}
                    <input
                      type="file"
                      accept="video/*"
                      hidden
                      disabled={busyExercise !== null}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        e.target.value = ''
                        void uploadClip(ex.id, f)
                      }}
                    />
                  </label>
                  <span className="muted small">Video up to {humanMB(MAX_UPLOAD_BYTES)}</span>
                </div>
              </header>

              <div className="row wrap gap">
                {recording ? (
                  <div className="playback">
                    <p className="eyebrow">Latest clip</p>
                    <button type="button" className="ghost" onClick={() => void preparePreview(recording)}>
                      Load preview
                    </button>
                    {signedUrls[recording.storage_object_path] ? (
                      <video
                        className="video"
                        controls
                        src={signedUrls[recording.storage_object_path]}
                      />
                    ) : null}
                    <p className="muted small mono">{recording.storage_object_path}</p>
                  </div>
                ) : (
                  <p className="muted">No recording yet for this exercise.</p>
                )}

                <div className="score-panel">
                  <p className="eyebrow">Coach score (0–10)</p>
                  {latestScore ? (
                    <p>
                      Latest: <strong>{latestScore.score}</strong>
                      {latestScore.notes ? <span className="muted"> — {latestScore.notes}</span> : null}
                    </p>
                  ) : (
                    <p className="muted">No score yet.</p>
                  )}

                  {isCoach ? (
                    <form
                      className="inline-score"
                      onSubmit={(e) => void submitScore(ex.id, e)}
                    >
                      <input
                        type="number"
                        step="0.1"
                        min={0}
                        max={10}
                        required
                        value={scoreDrafts[ex.id]?.score ?? ''}
                        onChange={(ev) =>
                          setScoreDrafts((prev) => ({
                            ...prev,
                            [ex.id]: { score: ev.target.value, notes: prev[ex.id]?.notes ?? '' },
                          }))
                        }
                      />
                      <input
                        type="text"
                        placeholder="Notes"
                        value={scoreDrafts[ex.id]?.notes ?? ''}
                        onChange={(ev) =>
                          setScoreDrafts((prev) => ({
                            ...prev,
                            [ex.id]: { score: prev[ex.id]?.score ?? '', notes: ev.target.value },
                          }))
                        }
                      />
                      <button type="submit">Save score</button>
                    </form>
                  ) : null}
                </div>
              </div>
            </article>
          )
        })}
      </div>
      ) : null}
    </div>
  )
}
