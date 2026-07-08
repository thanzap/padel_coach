/**
 * App-wide display timezone. All instants are stored in UTC on the server; the UI
 * shows and accepts wall-clock times in this zone. Weekly coach availability is also
 * interpreted in this zone (matching the backend).
 */
export const APP_TIME_ZONE = 'Europe/Athens'

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

type WallParts = {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
  second: number
}

/** Wall-clock components of an instant, as seen in APP_TIME_ZONE. */
export function athensParts(instant: Date): WallParts {
  const map: Record<string, string> = {}
  for (const p of partsFmt.formatToParts(instant)) map[p.type] = p.value
  let hour = Number(map.hour)
  if (hour === 24) hour = 0 // some engines emit '24' at midnight
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  }
}

/** Offset (ms) of APP_TIME_ZONE at a given instant: athensWallClock - utc. */
function zoneOffsetMs(instant: Date): number {
  const p = athensParts(instant)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/**
 * Convert Athens wall-clock components to the corresponding UTC instant.
 * DST-correct: resolves the offset at the target instant (not the local machine's).
 */
export function athensWallClockToInstant(
  year: number,
  month1to12: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  const guessUtc = Date.UTC(year, month1to12 - 1, day, hour, minute, second)
  // First approximation using the offset at the guessed instant, then refine once
  // in case the guess and the true instant straddle a DST change.
  const off1 = zoneOffsetMs(new Date(guessUtc))
  let instant = guessUtc - off1
  const off2 = zoneOffsetMs(new Date(instant))
  if (off2 !== off1) instant = guessUtc - off2
  return new Date(instant)
}

/** 'YYYY-MM-DD' calendar day of an instant in Athens. */
export function athensDayKey(instant: Date): string {
  const p = athensParts(instant)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** 'HH:MM' Athens clock of an instant. */
export function athensClock(instant: Date): string {
  const p = athensParts(instant)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(p.hour)}:${pad(p.minute)}`
}

/** Instant at Athens midnight (00:00) for a 'YYYY-MM-DD' day key. */
export function athensMidnightInstant(dayKey: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number)
  return athensWallClockToInstant(y, m, d, 0, 0, 0)
}

/** Instant at a given 'HH:MM' Athens wall-clock on a 'YYYY-MM-DD' day key. */
export function athensDayTimeInstant(dayKey: string, hm: string): Date {
  const [y, m, d] = dayKey.split('-').map(Number)
  const [h, min] = hm.split(':').map(Number)
  return athensWallClockToInstant(y, m, d, h, min, 0)
}

/** Python weekday (Mon=0 … Sun=6) of an instant in Athens. */
export function athensPythonWeekday(instant: Date): number {
  const p = athensParts(instant)
  const jsDow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() // 0=Sun
  return (jsDow + 6) % 7
}

/** Add whole days to a day key 'YYYY-MM-DD' (calendar arithmetic, DST-safe). */
export function addDaysToDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** Athens Monday (day key) of the week containing `instant`. */
export function startOfAthensWeekKey(instant: Date): string {
  const key = athensDayKey(instant)
  const py = athensPythonWeekday(athensMidnightInstant(key))
  return addDaysToDayKey(key, -py)
}

/** Readable Athens date + time, e.g. "6 Jul 2026, 17:00". */
export function formatAthens(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString(undefined, {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** Short Athens day label, e.g. "Mon, Jul 6". */
export function formatAthensDayLabel(dayKey: string): string {
  const noonUtc = new Date(`${dayKey}T12:00:00.000Z`)
  return noonUtc.toLocaleDateString(undefined, {
    timeZone: APP_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
