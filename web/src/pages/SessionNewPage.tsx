import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ExerciseDraftList, type ExerciseDraft } from '../components/ExerciseDraftList'
import { PageLoading } from '../components/PageLoading'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { datetimeLocalToIsoOrNull } from '../lib/datetimeLocal'
import { dashboardPath } from '../lib/paths'

type ProgramRow = {
  id: string
  title: string
  exercises: { id: string; title: string; sort_order: number }[]
}

type ProgramSource = 'saved' | 'adhoc'

type PlayerSearchHit = {
  id: string
  full_name: string | null
  email: string | null
  primary_place: string | null
}

export function SessionNewPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const presetProgram = params.get('program')

  const [programs, setPrograms] = useState<ProgramRow[]>([])
  const [programSource, setProgramSource] = useState<ProgramSource>('saved')
  const [programId, setProgramId] = useState(presetProgram ?? '')
  const [routineTitle, setRoutineTitle] = useState('Session routine')
  const [routineDescription, setRoutineDescription] = useState('')
  const [adhocExercises, setAdhocExercises] = useState<ExerciseDraft[]>([
    { title: '', description: '', target_duration_sec: '' },
  ])

  const [playerSearchText, setPlayerSearchText] = useState('')
  const [debouncedPlayerQuery, setDebouncedPlayerQuery] = useState('')
  const [playerHits, setPlayerHits] = useState<PlayerSearchHit[]>([])
  const [playerSearchLoading, setPlayerSearchLoading] = useState(false)
  const [playerSearchError, setPlayerSearchError] = useState<string | null>(null)
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSearchHit | null>(null)

  const [title, setTitle] = useState('')
  const [venuePlace, setVenuePlace] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [programsBootstrapping, setProgramsBootstrapping] = useState(true)

  const dash = profile ? dashboardPath(profile.role) : '/dashboard'

  useEffect(() => {
    let cancelled = false
    setProgramsBootstrapping(true)
    ;(async () => {
      try {
        const rows = await apiFetch<ProgramRow[]>('/programs')
        if (cancelled) return
        setPrograms(rows)
        if (presetProgram && rows.some((r) => r.id === presetProgram)) {
          setProgramId(presetProgram)
          setProgramSource('saved')
        } else if (!programId && rows[0]) {
          setProgramId(rows[0].id)
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load programs')
      } finally {
        if (!cancelled) setProgramsBootstrapping(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap program list once
  }, [])

  useEffect(() => {
    if (presetProgram) {
      setProgramId(presetProgram)
      setProgramSource('saved')
    }
  }, [presetProgram])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedPlayerQuery(playerSearchText.trim()), 320)
    return () => window.clearTimeout(t)
  }, [playerSearchText])

  useEffect(() => {
    if (debouncedPlayerQuery.length < 2) {
      setPlayerHits([])
      setPlayerSearchError(null)
      setPlayerSearchLoading(false)
      return
    }
    let cancelled = false
    setPlayerSearchLoading(true)
    setPlayerSearchError(null)
    const enc = encodeURIComponent(debouncedPlayerQuery)
    apiFetch<PlayerSearchHit[]>(`/players/search?q=${enc}`)
      .then((rows) => {
        if (!cancelled) setPlayerHits(rows)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPlayerHits([])
          setPlayerSearchError(e instanceof Error ? e.message : 'Player search failed')
        }
      })
      .finally(() => {
        if (!cancelled) setPlayerSearchLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedPlayerQuery])

  const selected = useMemo(() => programs.find((p) => p.id === programId), [programs, programId])

  const adhocValid =
    routineTitle.trim().length > 0 && adhocExercises.length > 0 && adhocExercises.every((e) => e.title.trim())

  const canSubmit =
    Boolean(selectedPlayer) &&
    (programSource === 'saved' ? Boolean(programId) : adhocValid) &&
    !(startTime.trim() && endTime.trim() && new Date(endTime).getTime() <= new Date(startTime).getTime())

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    if (startTime.trim() && endTime.trim() && new Date(endTime) <= new Date(startTime)) {
      setError('End time must be after start time.')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const scheduled_at = datetimeLocalToIsoOrNull(startTime)
      const ends_at = datetimeLocalToIsoOrNull(endTime)

      const base = {
        player_id: selectedPlayer!.id,
        title: title.trim() || null,
        venue_place: venuePlace.trim() || null,
        scheduled_at,
        ends_at,
      }

      const created = await apiFetch<{ id: string }>(
        '/sessions',
        {
          method: 'POST',
          body: JSON.stringify(
            programSource === 'saved'
              ? {
                  program_id: programId,
                  ...base,
                }
              : {
                  inline_program: {
                    title: routineTitle.trim(),
                    description: routineDescription.trim() || null,
                    exercises: adhocExercises.map((ex) => ({
                      title: ex.title.trim(),
                      description: ex.description.trim() || null,
                      target_duration_sec: ex.target_duration_sec ? Number(ex.target_duration_sec) : null,
                    })),
                  },
                  ...base,
                },
          ),
        },
      )
      navigate(`/sessions/${created.id}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not create session')
    } finally {
      setBusy(false)
    }
  }

  if (profile?.role !== 'coach' && profile?.role !== 'admin') {
    return (
      <div className="page narrow">
        <p className="banner error">Only coaches can schedule sessions.</p>
        <Link to={dash}>Dashboard</Link>
      </div>
    )
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Coach</p>
          <h1>New session</h1>
          <p className="muted">
            Pick a saved routine from the library or define a one-off for this session only. Set optional start/end times for the block.
          </p>
        </div>
        <nav className="page-context-nav" aria-label="Routine library">
          <Link to="/coach/programs">Browse training routines</Link>
        </nav>
      </header>

      {programsBootstrapping ? <PageLoading label="Loading your saved routines…" /> : null}

      {!programsBootstrapping ? (
      <form className="card form wide" onSubmit={onSubmit}>
        <fieldset className="program-source-fieldset">
          <legend className="eyebrow">Training template</legend>
          <label className="row gap align-center">
            <input
              type="radio"
              name="programSource"
              checked={programSource === 'saved'}
              onChange={() => setProgramSource('saved')}
            />
            Use saved routine
          </label>
          <label className="row gap align-center">
            <input
              type="radio"
              name="programSource"
              checked={programSource === 'adhoc'}
              onChange={() => setProgramSource('adhoc')}
            />
            One-off routine for this session only
          </label>
        </fieldset>

        {programSource === 'saved' ? (
          <>
            <label>
              Routine from library
              <select value={programId} onChange={(e) => setProgramId(e.target.value)} required={programSource === 'saved'}>
                {programs.length === 0 ? (
                  <option value="">No routines yet</option>
                ) : (
                  programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.exercises.length} exercises)
                    </option>
                  ))
                )}
              </select>
            </label>
            {!programs.length ? (
              <p className="muted">
                Create routines in the{' '}
                <Link to="/coach/programs">training builder</Link> first, or switch to a one-off routine above.
              </p>
            ) : null}
            {selected ? (
              <div className="card muted-border">
                <p className="eyebrow">Timeline preview</p>
                <ol className="timeline-preview">
                  {[...selected.exercises]
                    .sort((a, b) => a.sort_order - b.sort_order)
                    .map((ex, idx) => (
                      <li key={ex.id}>
                        <span className="muted">{idx + 1}.</span> {ex.title}
                      </li>
                    ))}
                </ol>
              </div>
            ) : null}
          </>
        ) : (
          <div className="stack wide">
            <label>
              Routine title *
              <input required value={routineTitle} onChange={(e) => setRoutineTitle(e.target.value)} placeholder="e.g. Focus — defensive wall" />
            </label>
            <label>
              Routine description
              <textarea value={routineDescription} onChange={(e) => setRoutineDescription(e.target.value)} rows={2} />
            </label>
            <ExerciseDraftList exercises={adhocExercises} setExercises={setAdhocExercises} />
          </div>
        )}

        <div className="stack">
          <span className="eyebrow">Player</span>
          {selectedPlayer ? (
            <div className="player-selected-bar card muted-border">
              <div>
                <strong>{selectedPlayer.full_name?.trim() || 'Unnamed player'}</strong>
                {selectedPlayer.email ? (
                  <span className="muted">
                    {' '}
                    · {selectedPlayer.email}
                  </span>
                ) : null}
              </div>
              <button type="button" className="ghost" onClick={() => setSelectedPlayer(null)}>
                Change player
              </button>
            </div>
          ) : (
            <label className="player-search-wrap">
              Search players by name, email, or place
              <input
                autoComplete="off"
                placeholder="Type at least 2 characters…"
                value={playerSearchText}
                onChange={(e) => setPlayerSearchText(e.target.value)}
              />
              {playerSearchLoading ? <p className="muted small">Searching…</p> : null}
              {playerSearchError ? <p className="banner error">{playerSearchError}</p> : null}
              {debouncedPlayerQuery.length >= 2 && !playerSearchLoading && !playerHits.length && !playerSearchError ? (
                <p className="muted small">No matching players. They need an account and a player profile.</p>
              ) : null}
              {playerHits.length > 0 ? (
                <ul className="player-hit-list" role="listbox" aria-label="Player matches">
                  {playerHits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        className="player-hit-row"
                        role="option"
                        onClick={() => {
                          setSelectedPlayer(hit)
                          setPlayerSearchText('')
                          setDebouncedPlayerQuery('')
                          setPlayerHits([])
                          setPlayerSearchError(null)
                        }}
                      >
                        <span>{hit.full_name?.trim() || 'Unnamed player'}</span>
                        <p className="muted">
                          {[hit.email, hit.primary_place].filter(Boolean).join(' · ') || hit.id}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </label>
          )}
        </div>

        <label>
          Session title (optional)
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label>
          Venue / place (optional)
          <input value={venuePlace} onChange={(e) => setVenuePlace(e.target.value)} placeholder="Court name or city" />
        </label>

        <div className="row wrap gap session-times">
          <label className="grow">
            Start time (optional)
            <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <label className="grow">
            End time (optional)
            <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </label>
        </div>
        <p className="muted small">Stored as session start (<code>scheduled_at</code>) and end (<code>ends_at</code>).</p>

        {error ? <p className="banner error">{error}</p> : null}

        <button type="submit" disabled={busy || !canSubmit}>
          {busy ? 'Creating…' : 'Create session'}
        </button>
      </form>
      ) : null}
    </div>
  )
}
