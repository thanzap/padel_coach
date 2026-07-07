import { type FormEvent, useEffect, useLayoutEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { IncompleteProfileBanner } from '../components/IncompleteProfileBanner'
import { PageLoading } from '../components/PageLoading'
import { useAuth } from '../context/AuthContext'
import { apiFetch } from '../lib/api'
import { fetchCoachPlacesCached, readCoachPlacesCacheSync } from '../lib/coachPlacesCache'

type CoachHit = {
  id: string
  full_name: string | null
  primary_place: string | null
  training_club: string | null
  bio: string | null
}

function CoachHitCards({ hits }: { hits: CoachHit[] }) {
  if (!hits.length) return null
  return (
    <ul className="coach-hit-list">
      {hits.map((c) => (
        <li key={c.id} className="card muted-border">
          <p className="eyebrow">Coach</p>
          <h3>{c.full_name ?? 'Unnamed coach'}</h3>
          {c.training_club ? <p className="coach-hit-club">{c.training_club}</p> : null}
          <p className="muted">{c.primary_place ?? '—'}</p>
          {c.bio ? <p>{c.bio}</p> : null}
          <p className="coach-hit-actions">
            <Link to={`/player/coaches/${c.id}/book`} state={{ coach: c }}>
              View availability & request
            </Link>
          </p>
        </li>
      ))}
    </ul>
  )
}

export function PlayerFindCoachesPage() {
  const { profile, loading, profileLoading } = useAuth()
  const [placeQuery, setPlaceQuery] = useState('')
  const [coachPlaces, setCoachPlaces] = useState<string[]>(() => readCoachPlacesCacheSync() ?? [])
  /** Default false when sessionStorage already has places so we don’t flash “Loading…” before layout runs. */
  const [placesLoading, setPlacesLoading] = useState(() => readCoachPlacesCacheSync() === null)
  const [placesErr, setPlacesErr] = useState<string | null>(null)
  const [placeHits, setPlaceHits] = useState<CoachHit[]>([])
  const [placeErr, setPlaceErr] = useState<string | null>(null)
  const [placeSearchBusy, setPlaceSearchBusy] = useState(false)
  const [placeSearchAttempted, setPlaceSearchAttempted] = useState(false)

  const [nameSearchText, setNameSearchText] = useState('')
  const [debouncedNameQuery, setDebouncedNameQuery] = useState('')
  const [nameHits, setNameHits] = useState<CoachHit[]>([])
  const [nameSearchLoading, setNameSearchLoading] = useState(false)
  const [nameSearchErr, setNameSearchErr] = useState<string | null>(null)

  useLayoutEffect(() => {
    let cancelled = false
    const cached = readCoachPlacesCacheSync()
    if (cached !== null) {
      setCoachPlaces(cached)
      setPlacesLoading(false)
      setPlacesErr(null)
      return undefined
    }

    setPlacesErr(null)
    ;(async () => {
      try {
        const places = await fetchCoachPlacesCached()
        if (!cancelled) setCoachPlaces(places)
      } catch (e: unknown) {
        if (!cancelled) setPlacesErr(e instanceof Error ? e.message : 'Could not load cities')
      } finally {
        if (!cancelled) setPlacesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedNameQuery(nameSearchText.trim()), 320)
    return () => window.clearTimeout(t)
  }, [nameSearchText])

  useEffect(() => {
    if (debouncedNameQuery.length < 2) {
      setNameHits([])
      setNameSearchErr(null)
      setNameSearchLoading(false)
      return
    }
    let cancelled = false
    setNameSearchLoading(true)
    setNameSearchErr(null)
    const enc = encodeURIComponent(debouncedNameQuery)
    apiFetch<CoachHit[]>(`/coaches/search?name=${enc}`)
      .then((rows) => {
        if (!cancelled) setNameHits(rows)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setNameHits([])
          setNameSearchErr(err instanceof Error ? err.message : 'Name search failed')
        }
      })
      .finally(() => {
        if (!cancelled) setNameSearchLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debouncedNameQuery])

  async function searchCoachesByPlace(e: FormEvent) {
    e.preventDefault()
    const q = placeQuery.trim()
    if (!q) return
    setPlaceSearchBusy(true)
    setPlaceErr(null)
    try {
      const enc = encodeURIComponent(q)
      const hits = await apiFetch<CoachHit[]>(`/coaches/search?place=${enc}`)
      setPlaceHits(hits)
    } catch (err: unknown) {
      setPlaceErr(err instanceof Error ? err.message : 'Search failed')
      setPlaceHits([])
    } finally {
      setPlaceSearchBusy(false)
      setPlaceSearchAttempted(true)
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

  if (profile.role === 'coach' || profile.role === 'admin') {
    return <Navigate to="/coach/dashboard" replace />
  }

  return (
    <div className="page">
      <IncompleteProfileBanner profile={profile} />

      <header className="page-header">
        <div>
          <p className="eyebrow">Player</p>
          <h1>Find coaches</h1>
          <p className="muted">Search coaches by name (live) or by city / area.</p>
        </div>
      </header>

      <div className="stack wide">
        <section className="card muted-border coach-search stack wide">
          <h2>By name</h2>
          <p className="muted small">Results update as you type (after 2 or more characters).</p>
          <label>
            Coach name
            <input
              autoComplete="off"
              placeholder="e.g. Maria, Santos…"
              value={nameSearchText}
              onChange={(e) => setNameSearchText(e.target.value)}
              aria-busy={nameSearchLoading}
            />
          </label>
          <span className="sr-only">{nameSearchLoading ? 'Searching coaches by name.' : ''}</span>
          {nameSearchErr ? <p className="banner error">{nameSearchErr}</p> : null}
          {debouncedNameQuery.length > 0 && debouncedNameQuery.length < 2 ? (
            <p className="muted small">Type at least 2 characters to search by name.</p>
          ) : null}
          {!nameSearchLoading && debouncedNameQuery.length >= 2 && !nameSearchErr && !nameHits.length ? (
            <p className="muted small">No coaches match that name.</p>
          ) : null}
          <CoachHitCards hits={nameHits} />
        </section>

        <section className="card muted-border coach-search stack wide">
          <h2>By place</h2>
          <p className="muted small">Pick a city or area coaches have listed on their profile, then search.</p>
          {placesErr ? <p className="banner error">{placesErr}</p> : null}
          {!placesLoading && !placesErr && !coachPlaces.length ? (
            <p className="muted small">No coach locations yet. Coaches add a primary place on their profile.</p>
          ) : null}
          <form className="stack coach-search-form" onSubmit={(ev) => void searchCoachesByPlace(ev)}>
            <label>
              City / area
              <span className="sr-only">{placesLoading ? 'Loading places.' : ''}</span>
              <select
                aria-busy={placesLoading}
                value={placeQuery}
                onChange={(e) => setPlaceQuery(e.target.value)}
                disabled={placesLoading || !coachPlaces.length}
              >
                <option value="">Choose a place…</option>
                {coachPlaces.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={placeSearchBusy || !placeQuery.trim() || !coachPlaces.length}>
              {placeSearchBusy ? 'Searching…' : 'Search'}
            </button>
          </form>
          {placeErr ? <p className="banner error">{placeErr}</p> : null}
          {!placeSearchAttempted && !placeHits.length && !placeErr ? (
            <p className="muted small">Place search results appear here after you click Search.</p>
          ) : null}
          {placeSearchAttempted && !placeHits.length && !placeErr ? (
            <p className="muted small">No coaches listed for that place.</p>
          ) : null}
          <CoachHitCards hits={placeHits} />
        </section>
      </div>
    </div>
  )
}
