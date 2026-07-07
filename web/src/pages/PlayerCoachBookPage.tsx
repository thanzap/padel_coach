import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { IncompleteProfileBanner } from '../components/IncompleteProfileBanner'
import { PageLoading } from '../components/PageLoading'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

type CoachHit = {
  id: string
  full_name: string | null
  primary_place: string | null
}

type WeeklySlotApi = {
  weekday: number
  start_time: string
  end_time: string
}

type FreeSlotsApi = {
  coach_id: string
  start_date: string
  end_date: string
  slots: { start: string; end: string }[]
}

function startOfWeekMondayUTC(d: Date): Date {
  const wd = d.getUTCDay()
  const py = (wd + 6) % 7
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
  start.setUTCDate(start.getUTCDate() - py)
  return start
}

function addDaysUTC(d: Date, days: number): Date {
  const n = new Date(d.getTime())
  n.setUTCDate(n.getUTCDate() + days)
  return n
}

function utcDateLabel(d: Date): string {
  return d.toISOString().slice(0, 10)
}

const SLOT_GRID_MS = 15 * 60_000
const MIN_SESSION_MS = 15 * 60_000

function utcMidnightFor(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
}

function intervalsOverlap(a0: Date, a1: Date, b0: Date, b1: Date): boolean {
  return a0.getTime() < b1.getTime() && b0.getTime() < a1.getTime()
}

function clipGapToUtcDay(
  gapStart: Date,
  gapEnd: Date,
  dayStart: Date,
  dayEnd: Date,
): { start: Date; end: Date } | null {
  const s = new Date(Math.max(gapStart.getTime(), dayStart.getTime()))
  const e = new Date(Math.min(gapEnd.getTime(), dayEnd.getTime()))
  if (e.getTime() - s.getTime() < MIN_SESSION_MS) return null
  return { start: s, end: e }
}

function gridStartsInClip(clip: { start: Date; end: Date }): Date[] {
  const gridMs = SLOT_GRID_MS
  const minDur = MIN_SESSION_MS
  let t = Math.ceil(clip.start.getTime() / gridMs) * gridMs
  const lastStart = clip.end.getTime() - minDur
  const out: Date[] = []
  while (t <= lastStart + 0.5) {
    if (t + 1 >= clip.start.getTime()) out.push(new Date(t))
    t += gridMs
  }
  return out
}

function gridEndsForStart(start: Date, clip: { start: Date; end: Date }): Date[] {
  const gridMs = SLOT_GRID_MS
  const minDur = MIN_SESSION_MS
  let t = Math.ceil((start.getTime() + minDur) / gridMs) * gridMs
  const out: Date[] = []
  while (t <= clip.end.getTime() + 0.5) {
    out.push(new Date(t))
    t += gridMs
  }
  return out
}

function formatDayOption(dayStart: Date): string {
  return dayStart.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function formatUtcClock(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export function PlayerCoachBookPage() {
  const { coachId } = useParams<{ coachId: string }>()
  const location = useLocation()
  const coachFromNav = (location.state as { coach?: CoachHit } | undefined)?.coach

  const { profile, loading, profileLoading } = useAuth()
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeekMondayUTC(new Date()))
  const [weekly, setWeekly] = useState<WeeklySlotApi[]>([])
  const [free, setFree] = useState<FreeSlotsApi | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [slotsLoading, setSlotsLoading] = useState(true)
  const [note, setNote] = useState('')
  const [requestBusy, setRequestBusy] = useState(false)
  const [requestErr, setRequestErr] = useState<string | null>(null)
  const [requestOk, setRequestOk] = useState<string | null>(null)
  const [selectedDayKey, setSelectedDayKey] = useState('')
  const [selectedStartIso, setSelectedStartIso] = useState('')
  const [selectedEndIso, setSelectedEndIso] = useState('')

  const weekEnd = useMemo(() => addDaysUTC(weekAnchor, 6), [weekAnchor])

  useEffect(() => {
    if (!coachId || !profile || profile.role !== 'player') {
      setSlotsLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setSlotsLoading(true)
      setLoadErr(null)
      try {
        const [wRows, fRows] = await Promise.all([
          apiFetch<WeeklySlotApi[]>(`/coaches/${coachId}/weekly-slots`),
          apiFetch<FreeSlotsApi>(
            `/coaches/${coachId}/free-slots?start_date=${utcDateLabel(weekAnchor)}&end_date=${utcDateLabel(weekEnd)}`,
          ),
        ])
        if (!cancelled) {
          setWeekly(wRows)
          setFree(fRows)
        }
      } catch (e: unknown) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : 'Could not load availability')
      } finally {
        if (!cancelled) setSlotsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [coachId, profile, weekAnchor, weekEnd])

  const availableDays = useMemo(() => {
    if (!free?.slots.length) return []
    const keys = new Set<string>()
    for (let i = 0; i < 7; i++) {
      const calDay = addDaysUTC(weekAnchor, i)
      const dayStart = utcMidnightFor(calDay)
      const dayEnd = addDaysUTC(dayStart, 1)
      const key = utcDateLabel(dayStart)
      for (const s of free.slots) {
        const a = new Date(s.start)
        const b = new Date(s.end)
        if (!intervalsOverlap(a, b, dayStart, dayEnd)) continue
        const clip = clipGapToUtcDay(a, b, dayStart, dayEnd)
        if (clip) keys.add(key)
      }
    }
    return [...keys].sort()
  }, [free, weekAnchor])

  const resolvedDayKey = useMemo(() => {
    if (selectedDayKey && availableDays.includes(selectedDayKey)) return selectedDayKey
    return availableDays[0] ?? ''
  }, [selectedDayKey, availableDays])

  const clipsForSelectedDay = useMemo(() => {
    if (!resolvedDayKey || !free?.slots.length) return []
    const dayStart = new Date(`${resolvedDayKey}T00:00:00.000Z`)
    const dayEnd = addDaysUTC(dayStart, 1)
    const clips: { start: Date; end: Date }[] = []
    for (const s of free.slots) {
      const clip = clipGapToUtcDay(new Date(s.start), new Date(s.end), dayStart, dayEnd)
      if (clip) clips.push(clip)
    }
    return clips
  }, [free, resolvedDayKey])

  const startOptions = useMemo(() => {
    const seen = new Map<string, Date>()
    for (const clip of clipsForSelectedDay) {
      for (const st of gridStartsInClip(clip)) {
        seen.set(st.toISOString(), st)
      }
    }
    return [...seen.values()].sort((x, y) => x.getTime() - y.getTime())
  }, [clipsForSelectedDay])

  const endOptions = useMemo(() => {
    if (!selectedStartIso) return []
    const start = new Date(selectedStartIso)
    const seen = new Map<string, Date>()
    for (const clip of clipsForSelectedDay) {
      if (start.getTime() < clip.start.getTime() || start.getTime() >= clip.end.getTime()) continue
      for (const en of gridEndsForStart(start, clip)) {
        seen.set(en.toISOString(), en)
      }
    }
    return [...seen.values()].sort((x, y) => x.getTime() - y.getTime())
  }, [clipsForSelectedDay, selectedStartIso])

  useEffect(() => {
    setSelectedDayKey('')
  }, [weekAnchor])

  useEffect(() => {
    setSelectedStartIso('')
    setSelectedEndIso('')
  }, [resolvedDayKey])

  useEffect(() => {
    if (!selectedStartIso) {
      setSelectedEndIso('')
      return
    }
    setSelectedEndIso((prev) => {
      if (prev && endOptions.some((e) => e.toISOString() === prev)) return prev
      if (endOptions.length === 1) return endOptions[0].toISOString()
      return ''
    })
  }, [selectedStartIso, endOptions])

  useEffect(() => {
    if (!selectedStartIso) return
    if (!startOptions.some((s) => s.toISOString() === selectedStartIso)) {
      setSelectedStartIso('')
      setSelectedEndIso('')
    }
  }, [startOptions, selectedStartIso])

  useEffect(() => {
    if (!selectedEndIso || !selectedStartIso) return
    if (!endOptions.some((e) => e.toISOString() === selectedEndIso)) {
      setSelectedEndIso('')
    }
  }, [endOptions, selectedEndIso, selectedStartIso])

  async function requestSlot(start: Date, end: Date) {
    if (!coachId) return
    setRequestBusy(true)
    setRequestErr(null)
    setRequestOk(null)
    try {
      await apiFetch('/session-requests', {
        method: 'POST',
        body: JSON.stringify({
          coach_id: coachId,
          requested_start: start.toISOString(),
          requested_end: end.toISOString(),
          note: note.trim() || null,
        }),
      })
      setRequestOk('Request sent. The coach will confirm with a training routine.')
      const refreshed = await apiFetch<FreeSlotsApi>(
        `/coaches/${coachId}/free-slots?start_date=${utcDateLabel(weekAnchor)}&end_date=${utcDateLabel(weekEnd)}`,
      )
      setFree(refreshed)
    } catch (e: unknown) {
      setRequestErr(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setRequestBusy(false)
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
        <p className="banner error">Could not load your profile.</p>
      </div>
    )
  }

  if (profile.role !== 'player') {
    return <Navigate to="/coach/dashboard" replace />
  }

  if (!coachId) {
    return <Navigate to="/player/coaches" replace />
  }

  const coachTitle =
    coachFromNav?.id === coachId ? coachFromNav.full_name ?? 'Coach' : 'Coach'

  return (
    <div className="page">
      <IncompleteProfileBanner profile={profile} />

      <header className="page-header">
        <div>
          <p className="eyebrow">Player</p>
          <h1>Request a session</h1>
          <p className="muted">
            {coachTitle}
            {coachFromNav?.primary_place ? ` · ${coachFromNav.primary_place}` : ''}
          </p>
        </div>
        <nav className="page-context-nav" aria-label="Booking">
          <Link to="/player/coaches">Back to search</Link>
        </nav>
      </header>

      <div className="stack wide">
        {loadErr ? <p className="banner error">{loadErr}</p> : null}
        {requestErr ? <p className="banner error">{requestErr}</p> : null}
        {requestOk ? <p className="banner ok">{requestOk}</p> : null}

        {slotsLoading ? (
          <PageLoading label="Loading this coach’s availability…" />
        ) : (
          <>
        <section className="card muted-border stack wide">
          <h2>Typical weekly hours (UTC)</h2>
          <p className="muted small">
            Actual openings depend on existing sessions, pending requests, and coach blocks — see “Open slots” below.
          </p>
          {!weekly.length ? (
            <p className="muted small">This coach has not published weekly hours yet.</p>
          ) : (
            <ul className="player-weekly-summary">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label, wd) => {
                const rows = weekly.filter((r) => r.weekday === wd)
                if (!rows.length) return null
                return (
                  <li key={label}>
                    <strong>{label}</strong>{' '}
                    {rows
                      .map((r) => `${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}`)
                      .join(', ')}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="card muted-border stack wide">
          <div className="availability-cal-toolbar">
            <h2>Open slots</h2>
            <div className="availability-cal-nav">
              <button type="button" className="button ghost" onClick={() => setWeekAnchor((w) => addDaysUTC(w, -7))}>
                ← Prev week
              </button>
              <button type="button" className="button ghost" onClick={() => setWeekAnchor(startOfWeekMondayUTC(new Date()))}>
                This week
              </button>
              <button type="button" className="button ghost" onClick={() => setWeekAnchor((w) => addDaysUTC(w, 7))}>
                Next week →
              </button>
            </div>
          </div>

          <p className="muted small">
            Pick a day that has openings, then start and end (UTC, 15-minute steps).
          </p>

          <label className="stack wide">
            Note to coach (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Focus, level…" />
          </label>

          {!availableDays.length && !loadErr ? (
            <p className="muted small">No openings in this week.</p>
          ) : (
            <div className="player-book-slot-picker">
              <label>
                Day (UTC)
                <select
                  value={resolvedDayKey}
                  onChange={(e) => setSelectedDayKey(e.target.value)}
                  disabled={requestBusy || !availableDays.length}
                >
                  {availableDays.map((key) => (
                    <option key={key} value={key}>
                      {formatDayOption(new Date(`${key}T12:00:00.000Z`))}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start time
                <select
                  value={selectedStartIso}
                  onChange={(e) => setSelectedStartIso(e.target.value)}
                  disabled={requestBusy || !resolvedDayKey}
                >
                  <option value="">Choose…</option>
                  {startOptions.map((st) => (
                    <option key={st.toISOString()} value={st.toISOString()}>
                      {formatUtcClock(st)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                End time
                <select
                  value={selectedEndIso}
                  onChange={(e) => setSelectedEndIso(e.target.value)}
                  disabled={
                    requestBusy ||
                    !selectedStartIso ||
                    endOptions.length <= 1
                  }
                >
                  {endOptions.length === 0 ? (
                    <option value="">—</option>
                  ) : endOptions.length === 1 ? (
                    <option value={endOptions[0].toISOString()}>
                      {formatUtcClock(endOptions[0])}
                    </option>
                  ) : (
                    <>
                      <option value="">Choose…</option>
                      {endOptions.map((en) => (
                        <option key={en.toISOString()} value={en.toISOString()}>
                          {formatUtcClock(en)}
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </label>
              <div className="request-cell">
                <button
                  type="button"
                  className="button primary"
                  disabled={
                    requestBusy || !selectedStartIso || !selectedEndIso
                  }
                  onClick={() => {
                    const start = new Date(selectedStartIso)
                    const end = new Date(selectedEndIso)
                    void requestSlot(start, end)
                  }}
                >
                  {requestBusy ? 'Sending…' : 'Request'}
                </button>
              </div>
            </div>
          )}
        </section>
          </>
        )}
      </div>
    </div>
  )
}
