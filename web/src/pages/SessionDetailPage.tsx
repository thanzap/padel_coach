import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
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

function pickRecorderMime(): string | undefined {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) {
      return c
    }
  }
  return undefined
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

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const recordingExerciseRef = useRef<string | null>(null)
  const startedAtRef = useRef<number | null>(null)

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

  function cleanupStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
    chunksRef.current = []
    recordingExerciseRef.current = null
    startedAtRef.current = null
    setBusyExercise(null)
  }

  async function startRecording(sessionExerciseId: string) {
    if (!sessionId || !detail) return
    setError(null)

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not available in this browser context (use HTTPS or localhost).')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      streamRef.current = stream
      const mimeType = pickRecorderMime()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorderRef.current = recorder
      chunksRef.current = []
      recordingExerciseRef.current = sessionExerciseId
      startedAtRef.current = performance.now()

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onerror = () => {
        setError('Recording failed.')
        cleanupStream()
      }

      recorder.onstop = async () => {
        const exerciseId = recordingExerciseRef.current
        const mime = recorder.mimeType || mimeType || 'video/webm'
        try {
          if (!exerciseId || !sessionId) return
          const blob = new Blob(chunksRef.current, { type: mime })
          const ext = mime.includes('webm') ? 'webm' : 'bin'
          const objectPath = `${sessionId}/${exerciseId}.${ext}`
          const { error: upErr } = await supabase.storage
            .from('exercise-recordings')
            .upload(objectPath, blob, { upsert: true, contentType: mime })
          if (upErr) throw upErr

          const duration_ms =
            startedAtRef.current != null ? Math.round(performance.now() - startedAtRef.current) : null

          await apiFetch(`/sessions/${sessionId}/exercises/${exerciseId}/recording`, {
            method: 'POST',
            body: JSON.stringify({
              storage_object_path: objectPath,
              duration_ms,
              mime_type: mime,
            }),
          })
          await refresh()
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : 'Upload failed')
        } finally {
          cleanupStream()
        }
      }

      recorder.start()
      setBusyExercise(sessionExerciseId)
    } catch (e: unknown) {
      cleanupStream()
      setError(e instanceof Error ? e.message : 'Could not access camera/microphone')
    }
  }

  function stopRecording() {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      cleanupStream()
      return
    }
    recorder.stop()
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
              <strong>Status:</strong> {detail.status}
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
                  {busyExercise === ex.id ? (
                    <button type="button" className="danger" onClick={stopRecording}>
                      Stop & upload
                    </button>
                  ) : (
                    <button type="button" onClick={() => void startRecording(ex.id)} disabled={busyExercise !== null}>
                      Record this exercise
                    </button>
                  )}
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
