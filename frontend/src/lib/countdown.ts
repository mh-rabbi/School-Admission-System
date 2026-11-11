const pad = (n: number) => String(n).padStart(2, '0')

/** "mm:ss", or "h:mm:ss" from one hour up. Rounds UP to whole seconds (like the demo) and never goes below 00:00. */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Milliseconds from `nowMs` until an ISO-8601 timestamp (negative once passed; NaN-safe: unparseable counts as passed). */
export function msUntil(isoTimestamp: string, nowMs: number): number {
  const at = Date.parse(isoTimestamp)
  return Number.isNaN(at) ? -1 : at - nowMs
}

export type TimerBucket = 'ok' | 'minute' | 'ten' | 'expired'

/** Coarse stages at which screen readers are told about the deadline (not every second). */
export function timerBucket(remainingMs: number): TimerBucket {
  if (remainingMs <= 0) return 'expired'
  const seconds = Math.ceil(remainingMs / 1000)
  if (seconds <= 10) return 'ten'
  if (seconds <= 60) return 'minute'
  return 'ok'
}
