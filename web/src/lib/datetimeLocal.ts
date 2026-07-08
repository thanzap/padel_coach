import { athensParts, athensWallClockToInstant } from './timezone'

/** datetime-local input value from an ISO instant, shown in Athens wall-clock. */
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = athensParts(d)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/** Parse a datetime-local string (Athens wall-clock) to a UTC ISO instant, or null. */
export function datetimeLocalToIsoOrNull(local: string): string | null {
  const t = local.trim()
  if (!t) return null
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return null
  const inst = athensWallClockToInstant(+m[1], +m[2], +m[3], +m[4], +m[5], 0)
  if (Number.isNaN(inst.getTime())) return null
  return inst.toISOString()
}
