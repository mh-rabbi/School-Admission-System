import { onServerTime } from '../api/client'

/**
 * Clock-skew correction. Expiry is decided by the server's database clock, but a guardian's phone clock can be minutes
 * off, so a countdown from Date.now() would be wrong. Every API response carries an HTTP `Date` header (server time,
 * 1 s resolution, exposed to the browser through CORS); from it we estimate `skew = serverTime - clientTime`.
 *
 * - The header is truncated to whole seconds, so the true server time is within the following second → add 500 ms.
 * - A single sample is jittery (±0.5 s), which would make the displayed seconds flicker → use the median of the last few.
 * - No header (hidden by CORS / a proxy)? skew stays 0 and the server-authoritative polling still corrects the UI.
 */
const MAX_SAMPLES = 9
let samples: number[] = []

export function recordServerTime(serverDateMs: number, clientNowMs: number = Date.now()): void {
  samples.push(serverDateMs + 500 - clientNowMs)
  if (samples.length > MAX_SAMPLES) samples.shift()
}

export function getSkewMs(): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
}

/** Best estimate of the server's current time. */
export function serverNow(): number {
  return Date.now() + getSkewMs()
}

/** Starts listening to response Date headers. Returns the unsubscribe function. */
export function startClockSync(): () => void {
  return onServerTime((t) => recordServerTime(t))
}

export function resetClock(): void {
  samples = []
}
