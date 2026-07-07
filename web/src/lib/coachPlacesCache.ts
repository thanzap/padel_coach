import { apiFetch } from './api'

const STORAGE_KEY = 'padel_platform_coach_places_v1'
/** Coach locations rarely change; avoids a round-trip on every “Find coaches” visit. */
const TTL_MS = 10 * 60 * 1000

type CachedPayload = { savedAt: number; places: string[] }

export function readCoachPlacesCacheSync(): string[] | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as CachedPayload
    if (!Array.isArray(c.places) || typeof c.savedAt !== 'number') return null
    if (Date.now() - c.savedAt >= TTL_MS) return null
    return c.places
  } catch {
    return null
  }
}

/** Loads coach places, using a fresh cache entry when needed. */
export async function fetchCoachPlacesCached(): Promise<string[]> {
  const fresh = readCoachPlacesCacheSync()
  if (fresh) return fresh

  const places = await apiFetch<string[]>('/coaches/places')
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), places } satisfies CachedPayload))
  } catch {
    /* ignore quota / private mode */
  }
  return places
}
