import { useNow } from '../hooks/useNow'
import { formatCountdown, msUntil, timerBucket, type TimerBucket } from '../lib/countdown'

const ANNOUNCEMENT: Record<TimerBucket, (label: string) => string> = {
  ok: () => '',
  minute: (l) => `One minute left to pay the fee for ${l}.`,
  ten: (l) => `Ten seconds left to pay the fee for ${l}.`,
  expired: (l) => `Time is up. Your seat hold for ${l} has expired.`,
}

interface HoldTimerProps {
  /** Server timestamp (UTC ISO-8601) at which the hold expires. */
  expiresAt: string
  /** Names the class in screen-reader announcements. */
  label: string
  /** Set false when the same hold's timer is already announced elsewhere on the page (avoids doubled announcements). */
  announce?: boolean
}

/**
 * Countdown to `expiresAt`, measured against the server-corrected clock. The visible digits are not announced every
 * second (aria-live off); screen readers hear a polite message only at 60 s, 10 s and on expiry.
 * Reaching zero here is provisional: the server decides, see ExpiryWatcher.
 */
export function HoldTimer({ expiresAt, label, announce = true }: HoldTimerProps) {
  const now = useNow()
  const remaining = msUntil(expiresAt, now)
  const bucket = timerBucket(remaining)
  return (
    <div className="holdtimer">
      <span className="muted">Your hold expires in</span>{' '}
      <span role="timer" aria-live="off" className="timer">
        {formatCountdown(remaining)}
      </span>
      {bucket === 'expired' && <span className="muted"> Time is up. Checking with the server…</span>}
      {announce && (
        <span className="sr-only" role="status" aria-live="polite">
          {ANNOUNCEMENT[bucket](label)}
        </span>
      )}
    </div>
  )
}
