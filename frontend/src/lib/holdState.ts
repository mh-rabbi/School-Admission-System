import type { HoldStatus } from '../api/types'
import { msUntil } from './countdown'

/**
 * What the UI treats an application as RIGHT NOW. A HELD application whose deadline has passed on the server-corrected
 * clock is shown as EXPIRED immediately (Pay disabled) instead of waiting for the next poll. It is provisional: the
 * server's own status replaces it as soon as it is read, and the UI never shows an expired state as a final answer
 * to something the server still holds (see `isAwaitingServer`).
 */
export function effectiveStatus(status: HoldStatus, expiresAt: string, nowMs: number): HoldStatus {
  return status === 'HELD' && msUntil(expiresAt, nowMs) <= 0 ? 'EXPIRED' : status
}

/** The device says the hold is over but the server still reports HELD, so the answer is not final yet. */
export function isAwaitingServer(serverStatus: HoldStatus, shownStatus: HoldStatus): boolean {
  return serverStatus === 'HELD' && shownStatus === 'EXPIRED'
}

/** Keep a just-expired application in the "active" strip for this long so the user sees what happened. */
export const RECENTLY_EXPIRED_MS = 60_000

/** Active strip membership: still HELD, or expired less than a minute ago. */
export function isActiveOrJustExpired(status: HoldStatus, expiresAt: string, nowMs: number): boolean {
  if (status === 'HELD') return true
  return status === 'EXPIRED' && nowMs - Date.parse(expiresAt) < RECENTLY_EXPIRED_MS
}
