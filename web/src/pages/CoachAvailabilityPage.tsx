import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Navigate } from 'react-router-dom'
import { IncompleteProfileBanner } from '../components/IncompleteProfileBanner'
import { PageLoading } from '../components/PageLoading'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

type WeeklySlotRow = { weekday: number; start_local: string; end_local: string }

type WeeklySlotApi = {
  id: string
  weekday: number
  start_time: string
  end_time: string
}

type BlockApi = {
  id: string
  starts_at: string
  ends_at: string
  reason: string | null
}

type CalendarBusyApi = {
  start: string
  end: string
  kind: 'session' | 'pending_request'
}

function compactTime(isoOrHm: string): string {
  const m = isoOrHm.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return isoOrHm
  const h = m[1].padStart(2, '0')
  return `${h}:${m[2]}`
}

/** Python weekday: Mon=0 … Sun=6 */
function pythonWeekdayUTC(d: Date): number {
  const wd = d.getUTCDay()
  return (wd + 6) % 7
}

function startOfWeekMondayUTC(d: Date): Date {
  const py = pythonWeekdayUTC(d)
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

function parseUtcHmOnDay(day: Date, hm: string): Date | null {
  const m = hm.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  const sec = m[3] ? Number(m[3]) : 0
  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, min, sec, 0),
  )
}

const DAY_START_H = 6
const DAY_END_H = 22
const DAY_SPAN_H = DAY_END_H - DAY_START_H

function bandStyle(start: Date, end: Date, day: Date): CSSProperties | null {
  const dayStart = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), DAY_START_H, 0, 0, 0),
  )
  const dayEnd = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), DAY_END_H, 0, 0, 0),
  )
  const clipStart = Math.max(start.getTime(), dayStart.getTime())
  const clipEnd = Math.min(end.getTime(), dayEnd.getTime())
  if (clipEnd <= clipStart) return null
  const topPct = ((clipStart - dayStart.getTime()) / (DAY_SPAN_H * 3600_000)) * 100
  const heightPct = ((clipEnd - clipStart) / (DAY_SPAN_H * 3600_000)) * 100
  return {
    top: `${topPct}%`,
    height: `${Math.max(heightPct, 1.2)}%`,
  }
}

function emptyDraft(): WeeklySlotRow[][] {
  return Array.from({ length: 7 }, () => [])
}

export function CoachAvailabilityPage() {
  const { profile, loading, profileLoading } = useAuth()
  const [draft, setDraft] = useState<WeeklySlotRow[][]>(() => emptyDraft())
  const [weeklyLoading, setWeeklyLoading] = useState(true)
  const [weeklyErr, setWeeklyErr] = useState<string | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)

  const [blocks, setBlocks] = useState<BlockApi[]>([])
  const [blocksLoading, setBlocksLoading] = useState(true)
  const [blocksErr, setBlocksErr] = useState<string | null>(null)
  const [blockBusy, setBlockBusy] = useState(false)
  const [blockStartLocal, setBlockStartLocal] = useState('')
  const [blockEndLocal, setBlockEndLocal] = useState('')
  const [blockReason, setBlockReason] = useState('')

  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeekMondayUTC(new Date()))

  const [calendarBusy, setCalendarBusy] = useState<CalendarBusyApi[]>([])
  const [calendarBusyErr, setCalendarBusyErr] = useState<string | null>(null)

  const applyWeeklyApi = useCallback((rows: WeeklySlotApi[]) => {
    const next = emptyDraft()
    for (const r of rows) {
      if (r.weekday < 0 || r.weekday > 6) continue
      next[r.weekday].push({
        weekday: r.weekday,
        start_local: compactTime(r.start_time),
        end_local: compactTime(r.end_time),
      })
    }
    setDraft(next)
  }, [])

  useEffect(() => {
    if (!profile || (profile.role !== 'coach' && profile.role !== 'admin')) return
    let cancelled = false
    ;(async () => {
      setWeeklyErr(null)
      setWeeklyLoading(true)
      try {
        const rows = await apiFetch<WeeklySlotApi[]>('/availability/weekly')
        if (!cancelled) applyWeeklyApi(rows)
      } catch (e: unknown) {
        if (!cancelled) setWeeklyErr(e instanceof Error ? e.message : 'Failed to load weekly hours')
      } finally {
        if (!cancelled) setWeeklyLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [profile, applyWeeklyApi])

  useEffect(() => {
    if (!profile || (profile.role !== 'coach' && profile.role !== 'admin')) {
      setBlocksLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      setBlocksLoading(true)
      setBlocksErr(null)
      try {
        const rows = await apiFetch<BlockApi[]>('/availability/blocks')
        if (!cancelled) setBlocks(rows)
      } catch (e: unknown) {
        if (!cancelled) setBlocksErr(e instanceof Error ? e.message : 'Failed to load blocks')
      } finally {
        if (!cancelled) setBlocksLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [profile])

  useEffect(() => {
    if (!profile || (profile.role !== 'coach' && profile.role !== 'admin')) return
    let cancelled = false
    const ws = utcDateLabel(weekAnchor)
    const we = utcDateLabel(addDaysUTC(weekAnchor, 6))
    setCalendarBusyErr(null)
    ;(async () => {
      try {
        const rows = await apiFetch<CalendarBusyApi[]>(
          `/availability/calendar-busy?start_date=${ws}&end_date=${we}`,
        )
        if (!cancelled) setCalendarBusy(rows)
      } catch (e: unknown) {
        if (!cancelled) {
          setCalendarBusy([])
          setCalendarBusyErr(e instanceof Error ? e.message : 'Could not load booked times')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [profile, weekAnchor])

  function addSlotRow(weekday: number) {
    setDraft((prev) => {
      const copy = prev.map((xs) => [...xs])
      copy[weekday] = [...copy[weekday], { weekday, start_local: '09:00', end_local: '17:00' }]
      return copy
    })
  }

  function updateSlot(weekday: number, index: number, patch: Partial<WeeklySlotRow>) {
    setDraft((prev) => {
      const copy = prev.map((xs) => [...xs])
      const row = copy[weekday][index]
      if (!row) return prev
      copy[weekday][index] = { ...row, ...patch }
      return copy
    })
  }

  function removeSlot(weekday: number, index: number) {
    setDraft((prev) => {
      const copy = prev.map((xs) => [...xs])
      copy[weekday].splice(index, 1)
      return copy
    })
  }

  async function saveWeekly(e: FormEvent) {
    e.preventDefault()
    const slots: WeeklySlotRow[] = draft.flatMap((xs) =>
      xs.map((r) => ({
        weekday: r.weekday,
        start_local: compactTime(r.start_local),
        end_local: compactTime(r.end_local),
      })),
    )
    setSaveBusy(true)
    setWeeklyErr(null)
    try {
      const rows = await apiFetch<WeeklySlotApi[]>('/availability/weekly', {
        method: 'PUT',
        body: JSON.stringify({ slots }),
      })
      applyWeeklyApi(rows)
    } catch (err: unknown) {
      setWeeklyErr(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaveBusy(false)
    }
  }

  async function submitBlock(e: FormEvent) {
    e.preventDefault()
    if (!blockStartLocal || !blockEndLocal) return
    const starts_at = new Date(blockStartLocal).toISOString()
    const ends_at = new Date(blockEndLocal).toISOString()
    setBlockBusy(true)
    setBlocksErr(null)
    try {
      const created = await apiFetch<BlockApi>('/availability/blocks', {
        method: 'POST',
        body: JSON.stringify({
          starts_at,
          ends_at,
          reason: blockReason.trim() || null,
        }),
      })
      setBlocks((xs) => [created, ...xs])
      setBlockStartLocal('')
      setBlockEndLocal('')
      setBlockReason('')
    } catch (err: unknown) {
      setBlocksErr(err instanceof Error ? err.message : 'Could not add block')
    } finally {
      setBlockBusy(false)
    }
  }

  async function removeBlock(id: string) {
    if (!window.confirm('Remove this time block?')) return
    setBlocksErr(null)
    try {
      await apiFetch(`/availability/blocks/${id}`, { method: 'DELETE' })
      setBlocks((xs) => xs.filter((b) => b.id !== id))
    } catch (err: unknown) {
      setBlocksErr(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const weekDays = useMemo(() => {
    const xs: Date[] = []
    for (let i = 0; i < 7; i++) xs.push(addDaysUTC(weekAnchor, i))
    return xs
  }, [weekAnchor])

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
      <IncompleteProfileBanner profile={profile} />

      <header className="page-header">
        <div>
          <p className="eyebrow">Coach</p>
          <h1>Availability</h1>
          <p className="muted">
            Weekly hours use UTC wall-clock times (same basis as scheduled sessions). Blocks remove slices from those
            hours for vacations or focus time.
          </p>
        </div>
      </header>

      {weeklyLoading || blocksLoading ? (
        <PageLoading label="Loading availability…" />
      ) : (
      <div className="stack wide">
        <section className="card muted-border stack wide">
          <h2>Weekly hours</h2>
          <p className="muted small">
            Add one or more intervals per weekday. Players only see gaps that remain after sessions, pending requests,
            and blocks.
          </p>
          {weeklyErr ? <p className="banner error">{weeklyErr}</p> : null}
          <form className="stack wide" onSubmit={(ev) => void saveWeekly(ev)}>
            <div className="availability-week-editor">
              {WEEKDAY_LABELS.map((label, weekday) => (
                <div key={label} className="availability-day-editor card muted-border stack">
                  <div className="availability-day-head">
                    <h3>{label}</h3>
                    <button type="button" className="button ghost" onClick={() => addSlotRow(weekday)}>
                      Add interval
                    </button>
                  </div>
                  {!draft[weekday].length ? (
                    <p className="muted small">Unavailable this day.</p>
                  ) : (
                    <ul className="availability-interval-list">
                      {draft[weekday].map((row, idx) => (
                        <li key={`${weekday}-${idx}`}>
                          <label>
                            Start (UTC)
                            <input
                              type="time"
                              value={row.start_local}
                              onChange={(e) => updateSlot(weekday, idx, { start_local: e.target.value })}
                            />
                          </label>
                          <label>
                            End (UTC)
                            <input
                              type="time"
                              value={row.end_local}
                              onChange={(e) => updateSlot(weekday, idx, { end_local: e.target.value })}
                            />
                          </label>
                          <button type="button" className="button ghost" onClick={() => removeSlot(weekday, idx)}>
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
            <button type="submit" disabled={saveBusy || weeklyLoading}>
              {saveBusy ? 'Saving…' : 'Save weekly hours'}
            </button>
          </form>
        </section>

        <section className="card muted-border stack wide">
          <div className="availability-cal-toolbar">
            <h2>Week preview (UTC)</h2>
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
            Green: weekly hours. Amber: planned / in‑progress sessions. Violet: pending session requests. Rose: manual
            blocks.
          </p>
          {calendarBusyErr ? <p className="banner error">{calendarBusyErr}</p> : null}
          <div className="availability-cal-grid">
            <div className="availability-cal-hours" aria-hidden>
              {Array.from({ length: DAY_SPAN_H }, (_, i) => (
                <div key={i} className="availability-cal-hour-label">
                  {(DAY_START_H + i).toString().padStart(2, '0')}:00
                </div>
              ))}
            </div>
            {weekDays.map((day) => {
              const py = pythonWeekdayUTC(day)
              const rules = draft[py]
              return (
                <div key={utcDateLabel(day)} className="availability-cal-column">
                  <div className="availability-cal-col-head">
                    <strong>{WEEKDAY_LABELS[py]}</strong>
                    <span className="muted small">{utcDateLabel(day)}</span>
                  </div>
                  <div className="availability-cal-day-body">
                    {rules.map((r, i) => {
                      const st = parseUtcHmOnDay(day, r.start_local)
                      const en = parseUtcHmOnDay(day, r.end_local)
                      if (!st || !en || en <= st) return null
                      const stl = bandStyle(st, en, day)
                      if (!stl) return null
                      return (
                        <div
                          key={`r-${i}`}
                          className="availability-cal-band recurring"
                          style={stl}
                          title={`${r.start_local}–${r.end_local} UTC`}
                        />
                      )
                    })}
                    {calendarBusy.map((row) => {
                      const st = new Date(row.start)
                      const en = new Date(row.end)
                      const stl = bandStyle(st, en, day)
                      if (!stl) return null
                      const cls =
                        row.kind === 'pending_request'
                          ? 'availability-cal-band pending-request'
                          : 'availability-cal-band session-booked'
                      const title =
                        row.kind === 'pending_request' ? 'Pending session request' : 'Planned / in‑progress session'
                      return (
                        <div
                          key={`${utcDateLabel(day)}-${row.kind}-${row.start}-${row.end}`}
                          className={cls}
                          style={stl}
                          title={title}
                        />
                      )
                    })}
                    {blocks.map((b) => {
                      const st = new Date(b.starts_at)
                      const en = new Date(b.ends_at)
                      const stl = bandStyle(st, en, day)
                      if (!stl) return null
                      return (
                        <div
                          key={b.id}
                          className="availability-cal-band block"
                          style={stl}
                          title={`Block ${b.reason ?? ''}`}
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="card muted-border stack wide">
          <h2>Block time</h2>
          <p className="muted small">
            Use your local timezone here; it is converted to ISO timestamps for the server. Blocks hide those intervals
            from players even if weekly hours cover them.
          </p>
          {blocksErr ? <p className="banner error">{blocksErr}</p> : null}
          <form className="stack coach-search-form" onSubmit={(ev) => void submitBlock(ev)}>
            <label>
              Block starts
              <input
                type="datetime-local"
                value={blockStartLocal}
                onChange={(e) => setBlockStartLocal(e.target.value)}
                required
              />
            </label>
            <label>
              Block ends
              <input
                type="datetime-local"
                value={blockEndLocal}
                onChange={(e) => setBlockEndLocal(e.target.value)}
                required
              />
            </label>
            <label>
              Reason (optional)
              <input
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="Travel, tournament…"
              />
            </label>
            <button type="submit" disabled={blockBusy}>
              {blockBusy ? 'Adding…' : 'Add block'}
            </button>
          </form>

          {blocks.length ? (
            <ul className="availability-block-list">
              {blocks.map((b) => (
                <li key={b.id} className="card muted-border">
                  <div>
                    <strong>
                      {new Date(b.starts_at).toLocaleString()} → {new Date(b.ends_at).toLocaleString()}
                    </strong>
                    {b.reason ? <p className="muted small">{b.reason}</p> : null}
                  </div>
                  <button type="button" className="button ghost" onClick={() => void removeBlock(b.id)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">No blocks yet.</p>
          )}
        </section>
      </div>
      )}
    </div>
  )
}
