import { supabase } from './supabase'

// In dev, VITE_API_URL is unset and requests go through the Vite proxy under the
// `/api` prefix — this keeps API paths from colliding with SPA routes that share the
// same names (e.g. /sessions/:id), so a fresh browser tab loads the app, not the API.
// In production, set VITE_API_URL to the API origin and requests go there directly.
const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api'

/** Prefer stored access token; if absent (e.g. expired session object), try refresh. */
async function accessTokenWithRefreshFallback(): Promise<string | null> {
  const { data: first } = await supabase.auth.getSession()
  if (first.session?.access_token) return first.session.access_token

  const { data: refreshed, error } = await supabase.auth.refreshSession()
  if (error) return null
  return refreshed.session?.access_token ?? null
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessTokenWithRefreshFallback()
  if (!token) {
    throw new Error('Not signed in')
  }

  const url = `${apiBase}${path}`

  async function requestWithToken(accessToken: string): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${accessToken}`)
    if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json')
    }
    return fetch(url, { ...init, headers })
  }

  let res = await requestWithToken(token)

  // Access JWTs expire (~1h). If we still had a stale token or the server rejected auth, refresh once and retry.
  if (res.status === 401) {
    await supabase.auth.refreshSession()
    const token2 = await accessTokenWithRefreshFallback()
    if (token2) {
      res = await requestWithToken(token2)
    }
  }

  if (!res.ok) {
    const text = await res.text()
    let detail = text
    try {
      const j = JSON.parse(text) as { detail?: unknown }
      if (typeof j.detail === 'string') detail = j.detail
      else if (Array.isArray(j.detail)) detail = JSON.stringify(j.detail)
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Request failed (${res.status})`)
  }

  if (res.status === 204) {
    return undefined as T
  }

  return (await res.json()) as T
}
