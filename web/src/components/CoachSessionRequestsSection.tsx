import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { PageLoading } from './PageLoading'

type SessionRequestRow = {
  id: string
  coach_id: string
  player_id: string
  requested_start: string
  requested_end: string
  note: string | null
  status: string
  coaching_session_id: string | null
}

type ProgramOption = {
  id: string
  title: string
}

export function CoachSessionRequestsSection() {
  const [rows, setRows] = useState<SessionRequestRow[]>([])
  const [programs, setPrograms] = useState<ProgramOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [programChoice, setProgramChoice] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [reqs, progs] = await Promise.all([
          apiFetch<SessionRequestRow[]>('/session-requests'),
          apiFetch<{ id: string; title: string }[]>('/programs'),
        ])
        if (!cancelled) {
          setRows(reqs)
          setPrograms(progs.map((p) => ({ id: p.id, title: p.title })))
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load requests')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function respond(id: string, accept: boolean) {
    let program_id: string | undefined
    if (accept) {
      const pick = programChoice[id]
      if (!pick) {
        setError('Choose a training routine to attach when accepting.')
        return
      }
      program_id = pick
    }
    setBusyId(id)
    setError(null)
    try {
      const updated = await apiFetch<SessionRequestRow>(`/session-requests/${id}/respond`, {
        method: 'POST',
        body: JSON.stringify(
          accept ? { accept: true, program_id } : { accept: false },
        ),
      })
      setRows((xs) => xs.map((r) => (r.id === id ? updated : r)))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not update request')
    } finally {
      setBusyId(null)
    }
  }

  const pending = rows.filter((r) => r.status === 'pending')

  return (
    <section className="card muted-border stack wide">
      <h2>Session requests</h2>
      <p className="muted small">
        Accepting creates a planned session at the requested time and links it to the routine you pick.
      </p>
      {error ? <p className="banner error">{error}</p> : null}
      {loading && !error ? <PageLoading label="Loading session requests…" /> : null}
      {!loading && !pending.length ? (
        <p className="muted small">No pending requests.</p>
      ) : null}
      {!loading && pending.length ? (
        <ul className="coach-session-requests">
          {pending.map((r) => (
            <li key={r.id} className="card muted-border stack">
              <div>
                <p>
                  <strong>
                    {new Date(r.requested_start).toLocaleString()} → {new Date(r.requested_end).toLocaleString()}
                  </strong>
                </p>
                <p className="muted small">Player id: {r.player_id.slice(0, 8)}…</p>
                {r.note ? <p>{r.note}</p> : null}
              </div>
              <label>
                Routine (for accept)
                <select
                  value={programChoice[r.id] ?? ''}
                  onChange={(e) =>
                    setProgramChoice((prev) => ({ ...prev, [r.id]: e.target.value }))
                  }
                >
                  <option value="">Choose…</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
              {!programs.length ? (
                <p className="muted small">
                  Create a routine first under <Link to="/coach/programs">training routines</Link>.
                </p>
              ) : null}
              <div className="actions-inline">
                <button
                  type="button"
                  disabled={busyId === r.id}
                  onClick={() => void respond(r.id, true)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="button ghost"
                  disabled={busyId === r.id}
                  onClick={() => void respond(r.id, false)}
                >
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
